import { useIsGuest } from "@/hooks/useIsGuest";
import { api } from "@/utils/api";

/**
 * Premium entitlement selector for the client.
 *
 * Centralizes the single read of the `billing.status` tRPC query so every
 * premium-gated piece of UI (duel caps, realtime play limit, upsells) depends
 * on one place. The derived `isPremium` boolean comes from the server, computed
 * by the shared `isPremiumEntitlement` rule, so client and server never
 * disagree on what counts as premium.
 *
 * `billing.status` is a `guestProtectedProcedure` and rejects anonymous users,
 * so we DISABLE the query for guests (via `useIsGuest`) to avoid a guaranteed
 * error round-trip. Guests are never premium, so they resolve to `false`.
 *
 * While loading, or on error, `isPremium` is `false` — the safe default that
 * applies free-tier limits. Consumers that want to defer UI until the real
 * value is known can read `isLoading`.
 */
export const usePremium = (): {
	isPremium: boolean;
	isLoading: boolean;
} => {
	const isGuest = useIsGuest();

	const { data, isLoading } = api.billing.status.useQuery(undefined, {
		// Guests can't be premium and the procedure rejects them; don't fire.
		enabled: !isGuest,
		// Premium status changes rarely (a webhook flips it); avoid refetch churn.
		staleTime: 60_000,
	});

	return {
		isPremium: data?.isPremium ?? false,
		// A disabled (guest) query never loads; report not-loading so guest UI
		// renders its free-tier state immediately.
		isLoading: isGuest ? false : isLoading,
	};
};
