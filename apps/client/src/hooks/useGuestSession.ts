// Feature: anonymous-sign-in
// Client "Play as guest" session hook — a named seam so the whole feature stays
// greppable and removable in one pass (R9). Wraps the `guest.signIn` tRPC
// mutation and the hand-off into the existing `index.tsx` play flow: on success
// it seeds the browser Supabase session with the minted access token, so the
// unchanged `supabase.auth.getSession()` path in `index.tsx` connects the socket
// via the existing auth contract (R1.4). On timeout/failure it connects nothing.
import { useRouter } from "next/router";
import { useCallback, useRef, useState } from "react";

import { api } from "@/utils/api";
import { createClient } from "@/utils/supabase/client";

/**
 * How long the client waits for `guest.signIn` to resolve before giving up
 * (R1.7). On timeout we surface an error and crucially do NOT connect the socket
 * — the session is only handed off after a genuinely successful sign-in.
 */
export const GUEST_SIGN_IN_TIMEOUT_MS = 5000;

/**
 * Error kinds surfaced to the UI (R2.5, R2.6):
 * - `null`  — no error / cleared on a fresh activation
 * - `"cap"` — the concurrent-guest cap was reached (CAP_REACHED)
 * - `"other"` — any other failure (count failure, provider failure, timeout)
 */
export type GuestSessionError = null | "cap" | "other";

export type UseGuestSession = {
	/**
	 * Start anonymous sign-in. Repeat activations while a request is in flight are
	 * ignored (R1.6). Resolves once the attempt settles; never rejects.
	 *
	 * `captchaToken` is the Cloudflare Turnstile token solved on the sign-in page.
	 * It is forwarded to the server, which verifies it before minting a guest
	 * account, so the button must only call this once a token is available.
	 */
	signInAsGuest: (captchaToken: string) => Promise<void>;
	/** True while a sign-in attempt is in flight (drives the disabled/spinner UI). */
	isPending: boolean;
	/** The last attempt's error, or `null`. */
	error: GuestSessionError;
};

/**
 * A tRPC `TOO_MANY_REQUESTS` response is how the server reports CAP_REACHED
 * (see `guest.ts`). The discriminated `cause` is server-only and not serialized
 * to the browser, so the client distinguishes the cap case by the tRPC error
 * code carried in `error.data.code`.
 */
const isCapError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"data" in error &&
	typeof (error as { data?: { code?: unknown } }).data === "object" &&
	(error as { data?: { code?: unknown } }).data?.code === "TOO_MANY_REQUESTS";

/**
 * Reject after {@link GUEST_SIGN_IN_TIMEOUT_MS}. Raced against the sign-in call so
 * a hung request still re-enables the control and shows an error (R1.7). The
 * returned `clear` cancels the timer so a fast success doesn't leak it.
 */
const createTimeout = (): { promise: Promise<never>; clear: () => void } => {
	let timer: ReturnType<typeof setTimeout>;
	const promise = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error("guest-sign-in-timeout")),
			GUEST_SIGN_IN_TIMEOUT_MS,
		);
	});
	return { promise, clear: () => clearTimeout(timer) };
};

/**
 * Wraps `guest.signIn` + the session hand-off.
 *
 * _Requirements: 1.4, 1.6, 1.7, 2.5, 2.6_
 */
export const useGuestSession = (): UseGuestSession => {
	const signIn = api.guest.signIn.useMutation();
	const router = useRouter();

	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<GuestSessionError>(null);

	// Synchronous in-flight guard. `isPending` state updates asynchronously, so a
	// burst of clicks in the same tick could all pass a state check; a ref flips
	// immediately and makes the "ignore repeat activations" rule reliable (R1.6).
	const inFlightRef = useRef(false);

	const signInAsGuest = useCallback(
		async (captchaToken: string): Promise<void> => {
			// Ignore repeat activations while a request is in flight (R1.6).
			if (inFlightRef.current) {
				return;
			}
			inFlightRef.current = true;
			setIsPending(true);
			setError(null);

			const timeout = createTimeout();
			try {
				// Race the sign-in against the 5s client timeout (R1.7). The Turnstile
				// token is forwarded for server-side captcha verification.
				const { accessToken, refreshToken } = await Promise.race([
					signIn.mutateAsync({ captchaToken }),
					timeout.promise,
				]);

				// Hand the session to the existing `index.tsx` play flow. Seeding the
				// browser Supabase session with BOTH tokens makes the unchanged
				// `getSession()` path pick up the guest session and connect the socket
				// via the existing contract (R1.4). The refresh token is required: the
				// SSR cookie client rejects a token-only `setSession`, which is what
				// previously stranded the sign-in with a "Sign-in failed" error.
				const supabase = createClient();
				const { error: setSessionError } = await supabase.auth.setSession({
					access_token: accessToken,
					refresh_token: refreshToken,
				});
				if (setSessionError) {
					// The token was minted but the browser session could not be seeded,
					// so the home-screen `getSession()` handoff would find nothing.
					// Treat this as a sign-in failure rather than silently stranding the
					// user on the sign-in page.
					throw setSessionError;
				}

				// Navigate to the home screen the same way the OAuth callback does
				// (it redirects to "/"). The seeded session is picked up by the
				// unchanged `getSession()` play flow there (R1.4). Without this the
				// user stays on `/sign-in` with a valid session but no way into a game.
				await router.push("/");
			} catch (caught) {
				// Any failure (count failure, provider failure, or timeout) leaves the
				// socket unconnected and surfaces an error (R1.7). Only CAP_REACHED maps
				// to the distinct cap message (R2.5); everything else is "other" (R2.6).
				setError(isCapError(caught) ? "cap" : "other");
			} finally {
				timeout.clear();
				inFlightRef.current = false;
				setIsPending(false);
			}
		},
		[signIn, router],
	);

	return { signInAsGuest, isPending, error };
};
