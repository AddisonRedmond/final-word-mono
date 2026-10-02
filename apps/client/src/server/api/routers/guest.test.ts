// Feature: anonymous-sign-in
// Property tests for the tRPC guest sign-in resolver (`guestRouter.signIn`).
//
// The resolver builds a service-role Supabase admin client via `createClient`
// from `@supabase/supabase-js`. We mock that module so each test can control
// `auth.admin.listUsers` (used by the cap counter) and spy on
// `auth.signInAnonymously` / `auth.admin.updateUserById` (account creation) to
// prove exactly when an account is and is not minted.
//
// `@/env` is mocked so importing the resolver does not require real runtime
// environment variables or a live database/Supabase connection.

import type { TRPCError as TRPCErrorType } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks ---------------------------------------------------------

// Mock `@/env` with dummy values so the server barrel (db + env validation)
// imports cleanly in the test environment without real secrets.
vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "test",
		DATABASE_URL: "postgres://user:pass@localhost:5432/test",
		SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
		NEXT_PUBLIC_WS_URL: "ws://localhost:3001",
		NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test-site-key",
		TURNSTILE_SECRET_KEY: "test-secret-key",
	},
}));

// Captcha verification is a separate concern with its own tests. Here we stub it
// to always pass so these properties exercise the count/cap/create logic. A
// `captchaToken` is still threaded through every call so the input contract is
// honored.
const verifyTurnstileToken = vi.fn(async (_token: string) => true);
vi.mock("@/server/api/turnstile", () => ({
	verifyTurnstileToken: (token: string) => verifyTurnstileToken(token),
}));

// A valid, non-empty captcha token passed to every signIn invocation below.
const VALID_INPUT = { captchaToken: "test-captcha-token" } as const;

// Shared spies so each test can both drive and inspect the admin client.
const listUsers = vi.fn();
const signInAnonymously = vi.fn();
const updateUserById = vi.fn();

// Mock the Supabase SDK: `createClient` returns a single controllable admin
// stub whose methods are the shared spies above. The resolver calls
// `createClient(url, serviceRoleKey, ...)` and then only touches `auth.*`.
vi.mock("@supabase/supabase-js", () => ({
	createClient: vi.fn(() => ({
		auth: {
			admin: { listUsers, updateUserById },
			signInAnonymously,
		},
	})),
}));

// Import AFTER the mocks are registered so the resolver binds to them.
import { createCaller } from "@/server/api/root";
import type { GuestSignInError } from "@/server/api/routers/guest";

/**
 * Build a tRPC caller with a minimal unauthenticated context. `guest.signIn`
 * is a `publicProcedure` that never reads `ctx` (all work goes through the
 * admin client), so a bare context is sufficient to invoke the resolver.
 */
const caller = createCaller({
	db: {} as never,
	supabase: null,
	user: null,
} as unknown as Parameters<typeof createCaller>[0]);

/**
 * Read the discriminated failure kind carried by the thrown TRPCError.
 *
 * The resolver sets `cause` to a {@link GuestSignInError} string. The TRPCError
 * constructor normalizes a non-Error `cause` into an `Error` whose `message` is
 * that string, so the discriminator is recovered from `cause` whether it stayed
 * a raw string or was wrapped into an `Error`.
 */
const errorKind = (err: unknown): string | undefined => {
	if (!(err instanceof TRPCError)) return undefined;
	const cause = (err as TRPCErrorType).cause;
	if (typeof cause === "string") return cause;
	if (cause instanceof Error) return cause.message;
	return undefined;
};

beforeEach(() => {
	listUsers.mockReset();
	signInAnonymously.mockReset();
	updateUserById.mockReset();
	verifyTurnstileToken.mockReset();
	// Default: captcha passes so count/cap/create logic is exercised.
	verifyTurnstileToken.mockResolvedValue(true);
});

// =========================================================================
// Property 5: Counting failure never creates an account and is distinctly
// reported.
//
// For any shape of page-fetch failure, the resolver must (a) never attempt to
// create an account (`signInAnonymously` / `updateUserById` never called) and
// (b) reject with `COUNT_FAILED`, distinguishable from `CAP_REACHED`.
//
// Validates: Requirements 2.2
// =========================================================================
describe("guestRouter.signIn — count-failure path (Property 5)", () => {
	// Feature: anonymous-sign-in, Property 5
	it("never creates an account and reports COUNT_FAILED (distinct from CAP_REACHED) on any page-fetch failure", async () => {
		// A failure may surface either as a returned `{ error }` from the admin
		// API or as a thrown exception from inside `listUsers`. We vary both the
		// delivery mode and the error payload shape.
		const failureArb = fc.record({
			// true -> listUsers throws; false -> listUsers returns `{ error }`.
			throws: fc.boolean(),
			// Arbitrary error payload shape (message, status code, name, etc.).
			error: fc.oneof(
				fc.record({ message: fc.string() }),
				fc.record({
					message: fc.string(),
					status: fc.integer({ min: 400, max: 599 }),
				}),
				fc.record({ name: fc.string(), message: fc.string() }),
				fc.constant({}),
				fc.constant(new Error("boom")),
			),
			// Which page the failure occurs on (1-based). The first listUsers call
			// is page 1; a later-page failure still aborts the whole count.
			failOnPage: fc.integer({ min: 1, max: 3 }),
		});

		await fc.assert(
			fc.asyncProperty(failureArb, async ({ throws, error, failOnPage }) => {
				listUsers.mockReset();
				signInAnonymously.mockReset();
				updateUserById.mockReset();

				// Serve non-empty "good" pages until the chosen failing page, so the
				// failure can occur on page 1 or on a subsequent page.
				listUsers.mockImplementation(async ({ page }: { page: number }) => {
					if (page >= failOnPage) {
						if (throws) {
							throw error;
						}
						return { data: null, error };
					}
					// A healthy page that advertises a next page so pagination
					// continues toward the failing page.
					return {
						data: {
							users: [{ is_anonymous: false }],
							nextPage: page + 1,
						},
						error: null,
					};
				});

				let thrown: unknown;
				try {
					await caller.guest.signIn(VALID_INPUT);
					thrown = undefined;
				} catch (err) {
					thrown = err;
				}

				// (a) The resolver must have rejected.
				expect(thrown).toBeInstanceOf(TRPCError);

				// (b) It is reported as COUNT_FAILED, and NOT as CAP_REACHED.
				const kind = errorKind(thrown);
				expect(kind).toBe("COUNT_FAILED" satisfies GuestSignInError);
				expect(kind).not.toBe("CAP_REACHED" satisfies GuestSignInError);

				// (c) No account creation of any kind was attempted.
				expect(signInAnonymously).not.toHaveBeenCalled();
				expect(updateUserById).not.toHaveBeenCalled();
			}),
			{ numRuns: 100 },
		);
		// Generous timeout: tRPC's dev timing middleware adds a 100–500ms
		// artificial delay per invocation, so 100 runs can take well over the
		// 5s default. The behavior under test is unaffected by the delay.
	}, 60_000);
});

// =========================================================================
// Property 6: Cap boundary governs account creation at 100.
//
// For any current anonymous count `n`, the endpoint creates exactly one
// account when `n < 100` and creates no account while returning a
// distinguishable `CAP_REACHED` error when `n >= 100`.
//
// We drive the count by having the mocked admin `listUsers` return `n`
// anonymous users, spread across one or more pages that respect the
// `nextPage` contract (a page advertises `nextPage` until the final page,
// which returns `nextPage: null`). The resolver sums `is_anonymous === true`
// across all pages, so the partitioning is irrelevant to the count.
//
// Validates: Requirements 2.3, 2.4
// =========================================================================
describe("guestRouter.signIn — cap boundary (Property 6)", () => {
	const ANON_ACCOUNT_CAP = 100;

	// Serve `n` anonymous users split into pages no larger than `pageSize`,
	// honoring the nextPage contract (null only on the final page). A page may
	// also carry a trailing non-anonymous user to prove the resolver counts by
	// `is_anonymous === true` rather than by raw page length.
	const installListUsers = (n: number, pageSize: number) => {
		listUsers.mockImplementation(async ({ page }: { page: number }) => {
			const start = (page - 1) * pageSize;
			const remaining = Math.max(0, n - start);
			const take = Math.min(pageSize, remaining);
			const users: Array<{ is_anonymous: boolean }> = [];
			for (let i = 0; i < take; i += 1) {
				users.push({ is_anonymous: true });
			}
			// Sprinkle a registered (non-anonymous) user that must NOT be counted.
			users.push({ is_anonymous: false });

			const servedSoFar = start + take;
			const hasMore = servedSoFar < n;
			return {
				data: { users, nextPage: hasMore ? page + 1 : null },
				error: null,
			};
		});
	};

	// Feature: anonymous-sign-in, Property 6
	it("creates exactly one account below the cap and rejects with a distinct CAP_REACHED at/above it, creating none", async () => {
		await fc.assert(
			fc.asyncProperty(
				// Span values both below and at/above the 100 boundary, with extra
				// weight right around the edge where the behavior flips.
				fc.oneof(
					fc.integer({ min: 0, max: 220 }),
					fc.integer({ min: 95, max: 105 }),
				),
				// Vary pagination so the same `n` arrives in differently sized pages.
				fc.integer({ min: 1, max: 40 }),
				async (n, pageSize) => {
					listUsers.mockReset();
					signInAnonymously.mockReset();
					updateUserById.mockReset();

					installListUsers(n, pageSize);

					// A healthy provider: a token-bearing session plus a user id so the
					// best-effort name assignment path (updateUserById) can run.
					const accessToken = `token-${n}`;
					signInAnonymously.mockResolvedValue({
						data: {
							user: { id: `user-${n}` },
							session: {
								access_token: accessToken,
								refresh_token: `refresh-${n}`,
							},
						},
						error: null,
					});
					updateUserById.mockResolvedValue({ data: {}, error: null });

					let result: { accessToken: string; refreshToken: string } | undefined;
					let thrown: unknown;
					try {
						result = await caller.guest.signIn(VALID_INPUT);
					} catch (err) {
						thrown = err;
					}

					if (n < ANON_ACCOUNT_CAP) {
						// Below the cap: exactly one account minted, non-empty token.
						expect(thrown).toBeUndefined();
						expect(signInAnonymously).toHaveBeenCalledTimes(1);
						expect(result).toBeDefined();
						expect(result?.accessToken).toBe(accessToken);
						expect((result?.accessToken ?? "").length).toBeGreaterThan(0);
					} else {
						// At/above the cap: no account minted, and the failure is a
						// CAP_REACHED error distinguishable from COUNT_FAILED.
						expect(signInAnonymously).not.toHaveBeenCalled();
						expect(thrown).toBeInstanceOf(TRPCError);
						const kind = errorKind(thrown);
						expect(kind).toBe("CAP_REACHED" satisfies GuestSignInError);
						expect(kind).not.toBe("COUNT_FAILED" satisfies GuestSignInError);
					}
				},
			),
			{ numRuns: 100 },
		);
		// Generous timeout: tRPC's dev timing middleware adds a 100–500ms
		// artificial delay per invocation, matching the Property 5 test above.
	}, 60_000);
});

// =========================================================================
// Property 7: Sign-in result carries a token exactly on success.
//
// Once the resolver reaches the `signInAnonymously` step (count succeeds and is
// below the cap), the outcome is a strict dichotomy:
//
//   - genuine success  — provider returns `error: null` AND a non-empty
//     `data.session.access_token` -> the resolver returns `{ accessToken }`
//     with EXACTLY that non-empty token.
//   - any failure      — a provider error, OR a token-less "success" (session
//     null/absent, or `access_token` an empty string, with `error: null`) ->
//     the resolver throws SIGN_IN_FAILED and returns NO token.
//
// SIGN_IN_FAILED must be distinct from CAP_REACHED and COUNT_FAILED on every
// failure, proving the three failure kinds stay distinguishable.
//
// To guarantee the resolver reaches the sign-in step, the mocked admin
// `listUsers` reports a small anonymous count (< 100, below the cap) that never
// trips the cap or count-failure branches.
//
// Validates: Requirements 1.3, 1.8
// =========================================================================
describe("guestRouter.signIn — token-on-success (Property 7)", () => {
	// A fixed, well-below-cap anonymous count so count/cap branches never fire
	// and control always flows into the signInAnonymously step under test.
	const installBelowCapCount = () => {
		listUsers.mockImplementation(async ({ page }: { page: number }) => {
			// Single page of a few anonymous users (< 100), final page.
			if (page === 1) {
				return {
					data: {
						users: [
							{ is_anonymous: true },
							{ is_anonymous: true },
							{ is_anonymous: false },
						],
						nextPage: null,
					},
					error: null,
				};
			}
			return { data: { users: [], nextPage: null }, error: null };
		});
	};

	// Feature: anonymous-sign-in, Property 7
	it("returns a non-empty token iff signInAnonymously genuinely succeeded, else SIGN_IN_FAILED with no token", async () => {
		// A non-empty access token for the success case. Constrain to a token that
		// is guaranteed non-empty after trimming so "success" is unambiguous.
		const nonEmptyTokenArb = fc
			.string({ minLength: 1, maxLength: 40 })
			.map((s) => `tok-${s}`);

		// The three mutually-exclusive sign-in outcomes.
		//   kind "ok"       -> error null + non-empty token (the ONLY success)
		//   kind "provider" -> a provider error object (classic failure)
		//   kind "tokenless"-> error null but no usable token (session null/absent
		//                      or empty-string access_token): MUST be SIGN_IN_FAILED
		const outcomeArb = fc.oneof(
			// (a) Genuine success.
			fc.record({
				tag: fc.constant("ok" as const),
				token: nonEmptyTokenArb,
				// Whether the user id is present drives the best-effort name path;
				// it must never change the success/failure outcome.
				hasUserId: fc.boolean(),
			}),
			// (b) Provider error — arbitrary error payload shape; session may or
			// may not be present, but an error is always treated as failure.
			fc.record({
				tag: fc.constant("provider" as const),
				error: fc.oneof(
					fc.record({ message: fc.string() }),
					fc.record({
						message: fc.string(),
						status: fc.integer({ min: 400, max: 599 }),
					}),
					fc.constant({}),
					fc.constant(new Error("provider boom")),
				),
				// Even if a token were present alongside an error, failure wins.
				token: fc.oneof(fc.constant(""), nonEmptyTokenArb),
			}),
			// (c) Token-less "success": error null, but no usable access token.
			fc.record({
				tag: fc.constant("tokenless" as const),
				// Shape of the missing token: null session, absent session, a
				// session object with no access_token, or an empty-string token.
				shape: fc.constantFrom(
					"null-session",
					"absent-session",
					"no-token-field",
					"empty-token",
				),
			}),
		);

		await fc.assert(
			fc.asyncProperty(outcomeArb, async (outcome) => {
				listUsers.mockReset();
				signInAnonymously.mockReset();
				updateUserById.mockReset();

				installBelowCapCount();
				// Best-effort name assignment always resolves cleanly; it must never
				// influence the success/failure outcome under test.
				updateUserById.mockResolvedValue({ data: {}, error: null });

				if (outcome.tag === "ok") {
					signInAnonymously.mockResolvedValue({
						data: {
							user: outcome.hasUserId ? { id: "user-ok" } : null,
							session: {
								access_token: outcome.token,
								refresh_token: "refresh-ok",
							},
						},
						error: null,
					});
				} else if (outcome.tag === "provider") {
					signInAnonymously.mockResolvedValue({
						data: {
							user: { id: "user-x" },
							session: { access_token: outcome.token },
						},
						error: outcome.error,
					});
				} else {
					// tokenless
					let data: unknown;
					switch (outcome.shape) {
						case "null-session":
							data = { user: { id: "user-x" }, session: null };
							break;
						case "absent-session":
							data = { user: { id: "user-x" } };
							break;
						case "no-token-field":
							data = { user: { id: "user-x" }, session: {} };
							break;
						default: // "empty-token"
							data = { user: { id: "user-x" }, session: { access_token: "" } };
							break;
					}
					signInAnonymously.mockResolvedValue({ data, error: null });
				}

				let result: { accessToken: string; refreshToken: string } | undefined;
				let thrown: unknown;
				try {
					result = await caller.guest.signIn(VALID_INPUT);
				} catch (err) {
					thrown = err;
				}

				// The resolver must have reached the sign-in step in every case.
				expect(signInAnonymously).toHaveBeenCalledTimes(1);

				if (outcome.tag === "ok") {
					// Success: NO throw, and the returned token is EXACTLY the
					// non-empty token the provider handed back (R1.3), alongside the
					// refresh token needed to seed a complete browser session.
					expect(thrown).toBeUndefined();
					expect(result).toBeDefined();
					expect(result?.accessToken).toBe(outcome.token);
					expect((result?.accessToken ?? "").length).toBeGreaterThan(0);
					expect(result?.refreshToken).toBe("refresh-ok");
				} else {
					// Every failure (provider error OR token-less "success"): a thrown
					// SIGN_IN_FAILED and NO token returned (R1.8).
					expect(result).toBeUndefined();
					expect(thrown).toBeInstanceOf(TRPCError);
					const kind = errorKind(thrown);
					expect(kind).toBe("SIGN_IN_FAILED" satisfies GuestSignInError);
					// Distinct from the other two failure kinds.
					expect(kind).not.toBe("CAP_REACHED" satisfies GuestSignInError);
					expect(kind).not.toBe("COUNT_FAILED" satisfies GuestSignInError);
				}
			}),
			{ numRuns: 100 },
		);
		// Generous timeout: tRPC's dev timing middleware adds a 100–500ms
		// artificial delay per invocation, matching the Property 5/6 tests above.
	}, 60_000);
});
