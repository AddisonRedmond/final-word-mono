import { useAuthStore } from "@/state/auth-store";

/**
 * Guest (anonymous-session) selector.
 *
 * Centralizes the single read of `useAuthStore().user?.is_anonymous` so the
 * guest UI gating (hiding duels/friends entry points) depends on one place.
 * Keeping this in a single, greppable `useIsGuest` hook means the whole guest
 * feature can be removed in one edit (R9).
 *
 * Returns `true` only when the current Supabase user is explicitly anonymous
 * (`is_anonymous === true`); any other state (registered user, no user, or an
 * absent flag) resolves to `false`.
 *
 * _Requirements: 7.3, 7.4_
 */
export const useIsGuest = (): boolean =>
	useAuthStore((state) => state.user?.is_anonymous === true);
