// Feature: anonymous-sign-in
// Server-side Cloudflare Turnstile verification — a named seam so the captcha
// surface stays greppable and removable in one pass (R9). The guest sign-in
// resolver calls this before counting or minting any account, so a client that
// cannot solve the challenge never reaches the privileged path.
import { env } from "@/env";

/** Cloudflare's token validation endpoint. Always responds HTTP 200. */
const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The subset of the siteverify JSON response we rely on. `success` is the only
 * field that governs the decision; `error-codes` is kept for logging/diagnostics.
 * See https://developers.cloudflare.com/turnstile/get-started/server-side-validation/.
 */
type SiteverifyResponse = {
	success: boolean;
	"error-codes"?: string[];
};

/**
 * Verify a Turnstile token against Cloudflare's siteverify API using the
 * server-only `TURNSTILE_SECRET_KEY`.
 *
 * Returns `true` only when Cloudflare reports `success === true`. An empty
 * token, a network/parse failure, or any non-success response all resolve to
 * `false` so the caller fails closed and refuses to mint a guest account.
 *
 * The siteverify endpoint always returns HTTP 200; success/failure is carried
 * in the JSON `success` boolean, so we never branch on the HTTP status.
 */
export const verifyTurnstileToken = async (token: string): Promise<boolean> => {
	// An empty/whitespace token can never pass; skip the round-trip.
	if (!token.trim()) {
		return false;
	}

	try {
		const body = new URLSearchParams({
			secret: env.TURNSTILE_SECRET_KEY,
			response: token,
		});

		const res = await fetch(SITEVERIFY_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
		});

		const data = (await res.json()) as SiteverifyResponse;
		return data.success === true;
	} catch {
		// Network error, non-JSON body, or any unexpected failure: fail closed.
		return false;
	}
};
