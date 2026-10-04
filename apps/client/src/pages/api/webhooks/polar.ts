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
			return res.status(403).json({ error: "Invalid signature" });
		}
		if (env.NODE_ENV === "development") {
			console.error("[polar] webhook parse error:", error);
		}
		return res.status(400).json({ error: "Invalid payload" });
	}

	try {
		await handleEvent(event);
	} catch (error) {
		// Return 500 so Polar retries delivery (handlers should be idempotent).
		if (env.NODE_ENV === "development") {
			console.error(`[polar] handler failed for ${event.type}:`, error);
		}
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
			const userId = sub.customer?.externalId ?? null;
			if (!userId) {
				// No external id means we can't map this to a user; nothing to do.
				return;
			}

			const isActive = ACTIVE_STATUSES.has(sub.status);
			// When active, entitlement runs through the end of the current period.
			// When not active (canceled/revoked/past_due), clear the entitlement end.
			const premiumUntil = isActive ? sub.currentPeriodEnd : null;

			await db
				.update(profiles)
				.set({
					polarCustomerId: sub.customerId,
					premiumStatus: sub.status,
					premiumUntil,
				})
				.where(eq(profiles.id, userId));
			return;
		}

		default:
			// Every other event type (orders, benefits, checkouts, etc.) is
			// acknowledged but ignored for now. Add handling here as needed.
			return;
	}
}
