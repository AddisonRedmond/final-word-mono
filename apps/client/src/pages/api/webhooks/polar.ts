// Polar (polar.sh) webhook receiver — the single source of truth for premium
// state. Polar POSTs subscription/order lifecycle events here; we verify the
// signature, map the event onto a Supabase user, and record premium state on
// their `profiles` row.
//
// IMPORTANT: This only RECORDS state. Nothing in the game reads/enforces it yet
// — the whole app stays free. When we start paywalling, read the recorded state
// via the `billing` tRPC router and branch on `isPremium`.
//
// Pages Router specifics:
//  - We disable the body parser so we can read the RAW request bytes. Signature
//    verification must run over the exact bytes Polar signed; a parsed/
//    re-serialized body would not match.

import {
	validateEvent,
	WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { profiles } from "@/db/schema";
import { env } from "@/env";
import { db } from "@/server/db";
import logger, { serializeError } from "@/server/logger";

// Disable Next's body parser so `req` streams the raw, unmodified bytes.
export const config = {
	api: {
		bodyParser: false,
	},
};

/** Read the raw request body as a Buffer (needed for signature verification). */
function readRawBody(req: NextApiRequest): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

/**
 * Statuses Polar considers "entitled" — i.e. the user currently has access.
 * `trialing` is included so trials count as premium while active.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return res.status(405).end("Method Not Allowed");
	}

	const rawBody = await readRawBody(req);

	// Verify the signature against our webhook secret BEFORE trusting anything.
	let event: ReturnType<typeof validateEvent>;
	try {
		event = validateEvent(
			rawBody,
			// validateEvent reads webhook-id / webhook-timestamp / webhook-signature.
			req.headers as Record<string, string>,
			env.POLAR_WEBHOOK_SECRET,
		);
	} catch (error) {
		if (error instanceof WebhookVerificationError) {
			// Signature mismatch. Polar does NOT retry a 4xx, so every event is lost
			// until the secret is fixed — a misconfigured/rotated POLAR_WEBHOOK_SECRET
			// silently blocks ALL premium grants. Alert on this event.
			logger.error({
				event: "polar.webhook.signature_invalid",
				msg: "Polar webhook signature verification failed; event rejected (not retried by Polar)",
				...serializeError(error),
			});
			return res.status(403).json({ error: "Invalid signature" });
		}
		logger.error({
			event: "polar.webhook.bad_payload",
			msg: "Polar webhook payload could not be parsed; event rejected",
			...serializeError(error),
		});
		return res.status(400).json({ error: "Invalid payload" });
	}

	try {
		await handleEvent(event);
	} catch (error) {
		// Return 500 so Polar retries delivery (handlers are idempotent). A
		// persistent handler_error means retries are failing too — alert on it.
		logger.error({
			event: "polar.webhook.handler_error",
			msg: "Polar webhook handler threw; returning 500 so Polar retries",
			eventType: event.type,
			...serializeError(error),
		});
		return res.status(500).json({ error: "Handler error" });
	}

	return res.status(200).json({ received: true });
}

/**
 * Apply a verified event to our DB. Idempotent: every subscription event just
 * writes the current status + period end onto the matching profile.
 */
async function handleEvent(event: ReturnType<typeof validateEvent>) {
	switch (event.type) {
		case "subscription.created":
		case "subscription.active":
		case "subscription.updated":
		case "subscription.canceled":
		case "subscription.uncanceled":
		case "subscription.past_due":
		case "subscription.revoked": {
			const sub = event.data;

			// Prefer the customer external id (set to our Supabase user id at
			// checkout). Fall back to the `supabaseUserId` we stash in checkout
			// metadata, as a belt-and-suspenders for events that don't surface the
			// external id.
			const metadataUserId =
				typeof sub.metadata?.supabaseUserId === "string"
					? sub.metadata.supabaseUserId
					: null;
			const userId = sub.customer?.externalId ?? metadataUserId;

			if (!userId) {
				// We can't map this subscription to a user. This is a SILENT premium
				// black hole: the event is acknowledged (200, no Polar retry) but no
				// profile is updated — a paying customer may never get premium. Alert.
				logger.error({
					event: "polar.webhook.user_unmatched",
					msg: "Polar subscription event has no resolvable user (no customer.externalId or metadata.supabaseUserId); premium NOT applied",
					eventType: event.type,
					polarCustomerId: sub.customerId,
					subscriptionStatus: sub.status,
				});
				return;
			}

			const isActive = ACTIVE_STATUSES.has(sub.status);
			// When active, entitlement runs through the end of the current period.
			// When not active (canceled/revoked/past_due), clear the entitlement end.
			const premiumUntil = isActive ? sub.currentPeriodEnd : null;

			const updated = await db
				.update(profiles)
				.set({
					polarCustomerId: sub.customerId,
					premiumStatus: sub.status,
					premiumUntil,
				})
				.where(eq(profiles.id, userId))
				.returning({ id: profiles.id });

			if (updated.length === 0) {
				// The resolved user id matched no profile row. Another silent gap:
				// acknowledged but nothing written. Alert so it's visible.
				logger.error({
					event: "polar.webhook.profile_not_found",
					msg: "Polar subscription event resolved a user id that matched no profile row; premium NOT applied",
					eventType: event.type,
					userId,
					polarCustomerId: sub.customerId,
					subscriptionStatus: sub.status,
				});
				return;
			}

			logger.info({
				event: "polar.webhook.applied",
				msg: "Applied Polar subscription state to profile",
				eventType: event.type,
				userId,
				subscriptionStatus: sub.status,
				isActive,
			});
			return;
		}

		default:
			// Every other event type (orders, benefits, checkouts, etc.) is
			// acknowledged but ignored for now. Add handling here as needed.
			return;
	}
}
