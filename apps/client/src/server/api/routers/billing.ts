// Polar (polar.sh) billing / premium status router.
//
// IMPORTANT: This EXPOSES premium status but does NOT enforce it. The whole game
// is free right now. The `isPremium` boolean below is derived purely so the UI
// can start reading it (e.g. to show a "Premium" badge or a manage-subscription
// link). No procedure anywhere gates functionality on it yet. When we start
// paywalling, add checks in the relevant routers/pages that read `billing.status`
// or re-use the `isPremium` derivation.
import { eq } from "drizzle-orm";
import { profiles } from "@/db/schema";
import { createTRPCRouter, guestProtectedProcedure } from "@/server/api/trpc";

/** Subscription statuses that currently grant access. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export type BillingStatus = {
	/** Derived entitlement flag. Tracked only — not enforced anywhere yet. */
	isPremium: boolean;
	/** Raw Polar subscription status, or null if the user never subscribed. */
	status: string | null;
	/** When the current entitlement runs through, or null. */
	premiumUntil: Date | null;
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
			// end date) it hasn't passed. Belt-and-suspenders against a missed
			// "revoked" webhook.
			const notExpired = !premiumUntil || premiumUntil.getTime() > Date.now();
			const isPremium =
				status !== null && ACTIVE_STATUSES.has(status) && notExpired;

			return { isPremium, status, premiumUntil };
		},
	),
});
