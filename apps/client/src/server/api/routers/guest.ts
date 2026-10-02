// Feature: anonymous-sign-in
// tRPC guest sign-in endpoint — a named seam so the whole feature is greppable and
// removable in one pass (R9.6). Mints a temporary Supabase anonymous account
// server-side with the service-role key, behind a soft cap on concurrent guests.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { ANON_ACCOUNT_CAP, countAnonymousUsers } from "@/server/api/guest-cap";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { verifyTurnstileToken } from "@/server/api/turnstile";
import { generateGuestDisplayName } from "@/utils/guest-name";

/**
 * Discriminated failure kinds so the client can tell cap-rejection (R2.5) apart
 * from count-failure / generic sign-in failure (R2.6, R1.7, R1.8). Carried as the
 * `cause` of the thrown {@link TRPCError} so each kind stays distinguishable.
 */
export type GuestSignInError =
	| "CAPTCHA_FAILED" // captcha token missing/invalid — before any count/create
	| "CAP_REACHED" // R2.3 — at/above 100 anonymous accounts
	| "COUNT_FAILED" // R2.2 — could not count existing anon accounts
	| "SIGN_IN_FAILED"; // R1.8 — signInAnonymously() itself failed

/**
 * The session shape returned to the browser on success. The access token is
 * guaranteed non-empty (R1.3). The refresh token is included so the browser can
 * seed a complete, persistable Supabase session via `setSession` — seeding with
 * an empty refresh token fails on the SSR cookie client and strands the sign-in.
 */
export type GuestSignInSession = {
	accessToken: string;
	refreshToken: string;
};

/**
 * Build a service-role Supabase admin client (R1.5). This client uses the
 * `SUPABASE_SERVICE_ROLE_KEY` and MUST only ever run server-side — never the
 * anon/cookie client. Sessions are not persisted: every call is a fresh,
 * stateless admin client used purely to count and mint accounts.
 */
const createAdminClient = (): SupabaseClient =>
	createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});

export const guestRouter = createTRPCRouter({
	/**
	 * Mint a temporary anonymous guest account.
	 *
	 * `publicProcedure` because a guest has no session yet, so this must be
	 * callable unauthenticated (R1.2). All privileged work happens server-side
	 * with the service-role client (R1.5).
	 *
	 * Order of checks matters: captcha → count → cap → create (see design "Error
	 * Handling"). The Cloudflare Turnstile token is verified first so a bot that
	 * cannot solve the challenge never reaches the counting or account-minting
	 * steps. A count failure then short-circuits before the cap comparison, and
	 * the cap check short-circuits before `signInAnonymously`, so no account is
	 * minted at the ceiling or on a transient listing error.
	 */
	signIn: publicProcedure
		.input(
			z.object({
				// The Cloudflare Turnstile token solved on the sign-in page. Required
				// and non-empty: an empty/absent token can never pass verification.
				captchaToken: z.string().min(1),
			}),
		)
		.mutation(async ({ input }): Promise<GuestSignInSession> => {
			const admin = createAdminClient();

			// 0. Verify the Turnstile captcha token server-side before doing any
			//    privileged work. A missing/invalid/expired token is rejected with a
			//    distinct CAPTCHA_FAILED and never mints or even counts accounts.
			const captchaOk = await verifyTurnstileToken(input.captchaToken);
			if (!captchaOk) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Captcha verification failed",
					cause: "CAPTCHA_FAILED" satisfies GuestSignInError,
				});
			}

			// 1. Count anonymous accounts via the service-role admin client (R2.1).
			//    Any listing failure is reported as COUNT_FAILED, distinct from the
			//    cap rejection, and no account is created (R2.2).
			let anonymousCount: number;
			try {
				anonymousCount = await countAnonymousUsers(admin);
			} catch {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Could not count existing guest accounts",
					cause: "COUNT_FAILED" satisfies GuestSignInError,
				});
			}

			// 2. Soft cap: at/above the ceiling, reject without creating (R2.3). The
			//    cap error is distinguishable from every other failure.
			if (anonymousCount >= ANON_ACCOUNT_CAP) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Guest play is temporarily unavailable",
					cause: "CAP_REACHED" satisfies GuestSignInError,
				});
			}

			// 3. Below the cap: create exactly one new anonymous account (R2.4).
			//    The captcha token is NOT forwarded to signInAnonymously: Turnstile
			//    tokens are single-use and we already consumed this one in the
			//    verifyTurnstileToken call above. Forwarding it would make Supabase
			//    verify the same spent token again (when its CAPTCHA protection is
			//    enabled) and fail with `timeout-or-duplicate`. Our own server-side
			//    verification is the single source of captcha truth here.
			const { data, error } = await admin.auth.signInAnonymously();

			const accessToken = data?.session?.access_token;
			const refreshToken = data?.session?.refresh_token;

			// Provider failure OR a token-less "success" are both treated as a
			// sign-in failure, and no tokens are returned (R1.8, Property 7). Both
			// tokens are required: the browser seeds a complete session with them,
			// and seeding with a missing refresh token fails on the cookie client.
			if (error || !accessToken || !refreshToken) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Guest sign-in could not be completed",
					cause: "SIGN_IN_FAILED" satisfies GuestSignInError,
				});
			}

			// On success, assign the cosmetic display name (R3.1). A failure to set
			// the name must not fail the sign-in — the socket layer falls back to
			// "Player" (R3.3) — so this is best-effort.
			const userId = data.user?.id;
			if (userId) {
				try {
					await admin.auth.admin.updateUserById(userId, {
						user_metadata: { full_name: generateGuestDisplayName() },
					});
				} catch {
					// Best-effort: name generation never blocks account creation.
				}
			}

			// Guaranteed non-empty access + refresh tokens on success (R1.3).
			return { accessToken, refreshToken };
		}),
});
