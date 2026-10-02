// Feature: anonymous-sign-in
//
// Integration test for the guest sign-in endpoint wiring (Task 6.6).
//
// Two things are asserted here, both about HOW the endpoint is wired rather than
// its branching logic (which the property tests cover):
//
//   1. Service-role usage (R1.5): the resolver builds its Supabase client with the
//      SERVICE_ROLE key and `persistSession: false` — never the anon/publishable
//      (cookie) key, and never the request-scoped cookie client from the tRPC
//      context. This is what keeps all privileged work server-side.
//
//   2. Public-procedure reachability (R1.2): `guest.signIn` is a `publicProcedure`,
//      so it is callable through `createCaller` with an UNAUTHENTICATED context
//      (no `ctx.user`). A guest has no session yet, so the endpoint must not be
//      gated behind the authenticated/protected middleware.
//
// Validates: Requirements 1.2, 1.5

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock @/env ------------------------------------------------------------
//
// Replace the real env module so the test does not depend on real environment
// variables (and so t3-env validation never runs). We give the service-role key
// and the anon/publishable key clearly DISTINCT sentinel values so the assertion
// below can prove the service-role key — and not the anon key — is the one passed
// to createClient.
// NOTE: these string values are duplicated as literals inside the `vi.mock`
// factory below because `vi.mock` is hoisted above all top-level declarations,
// so the factory cannot reference these constants. The constants are used only
// by the assertions further down.
const SERVICE_ROLE_KEY = "test-service-role-key";
const ANON_PUBLISHABLE_KEY = "test-anon-publishable-key";
const SUPABASE_URL = "https://project.supabase.co";

vi.mock("@/env", () => ({
	env: {
		SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon-publishable-key",
		NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
		NODE_ENV: "test",
		TURNSTILE_SECRET_KEY: "test-secret-key",
		NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test-site-key",
	},
}));

// Captcha verification is covered by its own tests; stub it to always pass so
// this wiring test exercises only service-role usage and reachability.
vi.mock("@/server/api/turnstile", () => ({
	verifyTurnstileToken: vi.fn(async () => true),
}));

// A valid, non-empty captcha token threaded through every signIn call.
const VALID_INPUT = { captchaToken: "test-captcha-token" } as const;

// --- Mock @supabase/supabase-js createClient -------------------------------
//
// Capture every createClient call so we can inspect the key + options the
// resolver used. The returned stub implements only the admin surface the
// resolver touches: listUsers (for the cap count), signInAnonymously (mint), and
// admin.updateUserById (best-effort display name).
// `vi.hoisted` keeps the spy available inside the hoisted mock factory while
// still letting the test body reference it for assertions.
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
	createClient: (...args: unknown[]) => createClientMock(...args),
}));

// Imported after the mocks are registered so the resolver picks up the stubs.
import { createCaller } from "@/server/api/root";

/** A fresh service-role admin stub whose calls drive a successful sign-in. */
const buildAdminStub = () => ({
	auth: {
		admin: {
			listUsers: vi.fn().mockResolvedValue({
				data: { users: [], nextPage: null },
				error: null,
			}),
			updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
		},
		signInAnonymously: vi.fn().mockResolvedValue({
			data: {
				session: {
					access_token: "guest-access-token",
					refresh_token: "guest-refresh-token",
				},
				user: { id: "guest-user-id" },
			},
			error: null,
		}),
	},
});

/**
 * Build an UNAUTHENTICATED tRPC context — the shape `createTRPCContext` produces
 * for a visitor with no session: `user` is null. We also stash a sentinel on the
 * request-scoped `supabase` (the anon/cookie client) so the test can prove the
 * resolver never reached for it.
 */
const cookieClientSentinel = { __kind: "anon-cookie-client" } as const;
const createUnauthenticatedContext = () =>
	({
		db: {} as never,
		supabase: cookieClientSentinel as never,
		user: null,
	}) as unknown as Parameters<typeof createCaller>[0];

describe("guest.signIn — service-role usage and endpoint wiring (Task 6.6)", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		createClientMock.mockImplementation(() => buildAdminStub());
	});

	it("is reachable as a publicProcedure with an unauthenticated context (R1.2)", async () => {
		const caller = createCaller(createUnauthenticatedContext());

		// No session, no ctx.user — a protected procedure would throw UNAUTHORIZED
		// here. A successful call proves signIn is public.
		const result = await caller.guest.signIn(VALID_INPUT);

		expect(result).toEqual({
			accessToken: "guest-access-token",
			refreshToken: "guest-refresh-token",
		});
	});

	it("builds its Supabase client with the SERVICE_ROLE key, not the anon key (R1.5)", async () => {
		const caller = createCaller(createUnauthenticatedContext());
		await caller.guest.signIn(VALID_INPUT);

		// The resolver must have minted a client via createClient.
		expect(createClientMock).toHaveBeenCalled();

		const [url, key, options] = createClientMock.mock.calls[0] ?? [];

		// Service-role key — and explicitly NOT the anon/publishable (cookie) key.
		expect(key).toBe(SERVICE_ROLE_KEY);
		expect(key).not.toBe(ANON_PUBLISHABLE_KEY);
		expect(url).toBe(SUPABASE_URL);

		// Stateless admin client: sessions are never persisted (service-role must
		// not behave like the browser cookie client).
		expect(options).toMatchObject({ auth: { persistSession: false } });
	});

	it("uses the service-role admin client, not the request-scoped cookie client (R1.5)", async () => {
		const adminStub = buildAdminStub();
		createClientMock.mockImplementation(() => adminStub);

		const caller = createCaller(createUnauthenticatedContext());
		await caller.guest.signIn(VALID_INPUT);

		// Privileged work (count + mint) runs on the service-role admin client...
		expect(adminStub.auth.admin.listUsers).toHaveBeenCalled();
		expect(adminStub.auth.signInAnonymously).toHaveBeenCalled();

		// ...and the anon/cookie client from the context is never used for it.
		expect(cookieClientSentinel).not.toHaveProperty("auth");
	});
});
