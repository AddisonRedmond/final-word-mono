/**
 * Property tests for setAuthToken / getAuthToken round-trip and tRPC Authorization header
 *
 * Property 4: setAuthToken / getAuthToken round-trip
 * For any value x (including null), calling setAuthToken(x) followed
 * immediately by getAuthToken() SHALL return x.
 *
 * Property 5: tRPC Authorization header is present for any non-null token
 * For any non-null, non-empty token string stored in the TokenStore, the
 * httpBatchLink headers() function SHALL return { Authorization: 'Bearer <token>' }.
 *
 * Validates: Requirements 7.1, 7.3, 7.4
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";

// Mock heavy dependencies so the module loads cleanly in a Node test env
vi.mock("@trpc/next", () => ({ createTRPCNext: () => ({}) }));
vi.mock("@trpc/client", () => ({
	httpBatchLink: () => ({}),
	loggerLink: () => ({}),
}));
vi.mock("superjson", () => ({ default: {} }));
vi.mock("@/server/api/root", () => ({}));

import { setAuthToken, getAuthToken, buildAuthHeaders } from "../api";

describe("setAuthToken / getAuthToken round-trip", () => {
	// Reset token state before each test to avoid cross-test pollution
	beforeEach(() => {
		setAuthToken(null);
	});

	it("returns null when no token has been set", () => {
		expect(getAuthToken()).toBeNull();
	});

	/**
	 * **Validates: Requirements 7.3, 7.4**
	 *
	 * Property 4: For any non-null string token x,
	 * setAuthToken(x) followed by getAuthToken() returns x.
	 */
	it("round-trip: setAuthToken(string) then getAuthToken() returns the same string", () => {
		fc.assert(
			fc.property(fc.string(), (token) => {
				setAuthToken(token);
				expect(getAuthToken()).toBe(token);
			}),
		);
	});

	/**
	 * **Validates: Requirements 7.3, 7.4**
	 *
	 * Property 4 (null case): setAuthToken(null) followed by getAuthToken() returns null.
	 */
	it("round-trip: setAuthToken(null) then getAuthToken() returns null", () => {
		// First set a non-null token, then clear it
		fc.assert(
			fc.property(fc.string(), (prior) => {
				setAuthToken(prior);
				setAuthToken(null);
				expect(getAuthToken()).toBeNull();
			}),
		);
	});

	/**
	 * **Validates: Requirements 7.3, 7.4**
	 *
	 * Property 4 (combined): For any value x in {string | null},
	 * setAuthToken(x) followed by getAuthToken() always returns x.
	 */
	it("round-trip: for any value x (string | null), getAuthToken() returns x after setAuthToken(x)", () => {
		const tokenArb = fc.oneof(fc.string(), fc.constant(null));
		fc.assert(
			fc.property(tokenArb, (x) => {
				setAuthToken(x);
				expect(getAuthToken()).toBe(x);
			}),
		);
	});
});

describe("tRPC Authorization header (Property 5)", () => {
	// Reset token state before each test to avoid cross-test pollution
	beforeEach(() => {
		setAuthToken(null);
	});

	/**
	 * **Validates: Requirements 7.1**
	 *
	 * Property 5: For any non-null, non-empty token string stored in the TokenStore,
	 * buildAuthHeaders() SHALL return { Authorization: 'Bearer <token>' }.
	 */
	it("buildAuthHeaders() returns Authorization: Bearer <token> for any non-empty token", () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1 }), (token) => {
				setAuthToken(token);
				const headers = buildAuthHeaders();
				expect(headers).toEqual({ Authorization: `Bearer ${token}` });
			}),
		);
	});

	/**
	 * **Validates: Requirements 7.1**
	 *
	 * Property 5 (null case): When token is null, buildAuthHeaders() returns {}.
	 */
	it("buildAuthHeaders() returns {} when token is null", () => {
		setAuthToken(null);
		expect(buildAuthHeaders()).toEqual({});
	});
});
