// Polar (polar.sh) billing / premium status router.
//
// `status` exposes the derived `isPremium` entitlement flag (also used to show a
// "Premium" badge / manage-subscription link). `realtimeUsage` exposes the
// free-tier realtime play allowance for the current UTC day so the UI can render
// "X / N games remaining today".
//
// Premium IS enforced now: duels caps (`duels.sendDuel`) and the realtime play
// limit (game server) both branch on the same `isPremiumEntitlement` rule from
// the shared db package, so client and server never disagree.
import { and, eq } from "drizzle-orm";
import {
	isPremiumEntitlement,
	profiles,
	realtimeGameUsage,
	TIER_LIMITS,
	utcDayKey,
} from "@/db/schema";
import { env } from "@/env";
import { createTRPCRouter, guestProtectedProcedure } from "@/server/api/trpc";
import logger, { serializeError } from "@/server/logger";
import { polar } from "@/server/polar";

export type BillingStatus = {
	/** Derived entitlement flag. */
	isPremium: boolean;
	/** Raw Polar subscription status, or null if the user never subscribed. */
	status: string | null;
	/** When the current entitlement runs through, or null. */
	premiumUntil: Date | null;
};

export type RealtimeUsage = {
	/** Whether the user is premium (unlimited realtime play). */
	isPremium: boolean;
	/** Realtime games allowed per UTC day; null = unlimited (premium). */
	limit: number | null;
	/** Realtime games already started today (across all modes). */
	used: number;
	/** Games left today; null = unlimited (premium). Clamped at 0 for free. */
	remaining: number | null;
	/**
	 * ISO timestamp of the next UTC midnight (when a free user's allowance
	 * resets). The client renders a "resets in …" countdown from this.
	 */
	resetsAt: string;
};

export const billingRouter = createTRPCRouter({
	/**
	 * Current premium status for the signed-in (non-guest) user, computed from the
	 * `profiles` row the Polar webhook maintains. Guests are rejected by
	 * `guestProtectedProcedure` before this runs.
	 */
	status: guestProtectedProcedure.query(
		async ({ ctx }): Promise<BillingStatus> => {
			const [profile] = await ctx.db
				.select({
					premiumStatus: profiles.premiumStatus,
					premiumUntil: profiles.premiumUntil,
				})
				.from(profiles)
				.where(eq(profiles.id, ctx.user.id))
				.limit(1);

			const status = profile?.premiumStatus ?? null;
			const premiumUntil = profile?.premiumUntil ?? null;

			// Premium iff the latest status is an entitling one AND (if we have an
			// end date) it hasn't passed. Shared with the game server via
			// `isPremiumEntitlement` so client and server never disagree on what
			// counts as premium.
			const isPremium = isPremiumEntitlement(status, premiumUntil);

			return { isPremium, status, premiumUntil };
		},
	),

	/**
	 * The signed-in (non-guest) user's realtime play allowance for the current
	 * UTC day: how many of their free games remain, and when the allowance
	 * resets. Reads the same `realtime_game_usage` row the game server writes on
	 * match start, so the display and the server-side gate agree.
	 *
	 * Premium users are unlimited: `limit`/`remaining` are null. Guests are
	 * rejected by `guestProtectedProcedure` (they have the separate one-game-per-
	 * mode gate instead).
	 */
	realtimeUsage: guestProtectedProcedure.query(
		async ({ ctx }): Promise<RealtimeUsage> => {
			const now = new Date();
			const day = utcDayKey(now);

			// Next UTC midnight: start of tomorrow (UTC). Free allowance resets then.
			const resetsAt = new Date(
				Date.UTC(
					now.getUTCFullYear(),
					now.getUTCMonth(),
					now.getUTCDate() + 1,
				),
			).toISOString();

			const [profile] = await ctx.db
				.select({
					premiumStatus: profiles.premiumStatus,
					premiumUntil: profiles.premiumUntil,
				})
				.from(profiles)
				.where(eq(profiles.id, ctx.user.id))
				.limit(1);

			const isPremium = isPremiumEntitlement(
				profile?.premiumStatus ?? null,
				profile?.premiumUntil ?? null,
			);

			if (isPremium) {
				return { isPremium: true, limit: null, used: 0, remaining: null, resetsAt };
			}

			const limit = TIER_LIMITS.free.realtimeGamesPerDay ?? 0;

			const [usage] = await ctx.db
				.select({ count: realtimeGameUsage.count })
				.from(realtimeGameUsage)
				.where(
					and(
						eq(realtimeGameUsage.userId, ctx.user.id),
						eq(realtimeGameUsage.day, day),
					),
				)
				.limit(1);

			const used = usage?.count ?? 0;
			const remaining = Math.max(0, limit - used);

			return { isPremium: false, limit, used, remaining, resetsAt };
		},
	),

	/**
	 * Reconcile premium state directly from Polar, bypassing the webhook.
	 *
	 * The webhook (`/api/webhooks/polar`) is normally the single writer of
	 * premium state, but it's a single point of failure: a bad signing secret, a
	 * dropped event, or an unmatched customer leaves a PAYING user without
	 * premium and no automatic recovery (Polar does not retry 4xx). This mutation
	 * is the safety net — it reads the source of truth (the customer's live
	 * subscription state) via the Polar API, keyed by our Supabase user id, and
	 * writes the SAME premium fields the webhook would. Idempotent: safe to call
	 * repeatedly; it just re-asserts whatever Polar currently reports.
	 *
	 * Returns the reconciled `{ isPremium, status, premiumUntil }` so the caller
	 * (e.g. the profile page after checkout) can update the UI immediately.
	 */
	syncFromPolar: guestProtectedProcedure.mutation(
		async ({ ctx }): Promise<BillingStatus> => {
			const userId = ctx.user.id;

			let status: string | null = null;
			let premiumUntil: Date | null = null;
			let polarCustomerId: string | null = null;

			try {
				// Customer state keyed by the external id we set at checkout (our
				// Supabase user id). `activeSubscriptions` contains only entitling
				// (active/trialing) subscriptions.
				const state = await polar.customers.getStateExternal({
					externalId: userId,
				});

				polarCustomerId = state.id ?? null;

				const premiumProductId = env.NEXT_PUBLIC_POLAR_PREMIUM_PRODUCT_ID;
				// Prefer a subscription for OUR premium product; fall back to any
				// active subscription so a product-id mismatch doesn't strand a payer.
				const subscriptions = state.activeSubscriptions ?? [];
				const sub =
					subscriptions.find((s) => s.productId === premiumProductId) ??
					subscriptions[0] ??
					null;

				if (sub) {
					status = sub.status;
					premiumUntil = sub.currentPeriodEnd ?? null;
				}
			} catch (error) {
				// A 404 from getStateExternal means "no Polar customer for this user"
				// — i.e. they never checked out. That's a legitimate not-premium
				// result, not an error worth alerting on. Any OTHER failure (API
				// down, auth) we surface so the caller can show a retry/support path.
				const status404 =
					typeof error === "object" &&
					error !== null &&
					"statusCode" in error &&
					(error as { statusCode?: number }).statusCode === 404;

				if (!status404) {
					logger.error({
						event: "billing.reconcile.polar_error",
						msg: "Failed to read customer state from Polar during reconciliation",
						userId,
						...serializeError(error),
					});
					throw error;
				}
				// 404 → fall through with status/premiumUntil null (not premium).
				logger.info({
					event: "billing.reconcile.no_customer",
					msg: "No Polar customer for user during reconciliation; treating as not premium",
					userId,
				});
			}

			const isPremium = isPremiumEntitlement(status, premiumUntil);

			// Write the SAME fields the webhook maintains. Setting polarCustomerId
			// when known also repairs a profile that the webhook never linked.
			await ctx.db
				.update(profiles)
				.set({
					...(polarCustomerId ? { polarCustomerId } : {}),
					premiumStatus: status,
					premiumUntil,
				})
				.where(eq(profiles.id, userId));

			logger.info({
				event: "billing.reconcile.applied",
				msg: "Reconciled premium state from Polar",
				userId,
				isPremium,
				subscriptionStatus: status,
			});

			return { isPremium, status, premiumUntil };
		},
	),
});
