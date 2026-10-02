// Feature: anonymous-sign-in
// Unit tests for server-side Cloudflare Turnstile verification. The helper POSTs
// the token + secret to the siteverify API and returns `true` only when the
// response reports `success === true`; every other outcome (empty token,
// non-success response, network/parse error) must fail closed to `false`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		TURNSTILE_SECRET_KEY: "test-secret-key",
		NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test-site-key",
	},
}));

import { verifyTurnstileToken } from "@/server/api/turnstile";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("verifyTurnstileToken", () => {
	it("returns true when siteverify reports success", async () => {
		fetchMock.mockResolvedValue({
			json: async () => ({ success: true }),
		});

		await expect(verifyTurnstileToken("good-token")).resolves.toBe(true);

		// Posts to the siteverify endpoint with the secret + response token.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe(SITEVERIFY_URL);
		expect((init as RequestInit).method).toBe("POST");
		const body = (init as RequestInit).body as URLSearchParams;
		expect(body.get("secret")).toBe("test-secret-key");
		expect(body.get("response")).toBe("good-token");
	});

	it("returns false when siteverify reports failure", async () => {
		fetchMock.mockResolvedValue({
			json: async () => ({
				success: false,
				"error-codes": ["invalid-input-response"],
			}),
		});

		await expect(verifyTurnstileToken("bad-token")).resolves.toBe(false);
	});

	it("fails closed (false) without calling fetch for an empty/whitespace token", async () => {
		await expect(verifyTurnstileToken("")).resolves.toBe(false);
		await expect(verifyTurnstileToken("   ")).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fails closed (false) on a network error", async () => {
		fetchMock.mockRejectedValue(new Error("network down"));

		await expect(verifyTurnstileToken("some-token")).resolves.toBe(false);
	});

	it("fails closed (false) on a non-JSON / malformed response body", async () => {
		fetchMock.mockResolvedValue({
			json: async () => {
				throw new Error("not json");
			},
		});

		await expect(verifyTurnstileToken("some-token")).resolves.toBe(false);
	});
});
