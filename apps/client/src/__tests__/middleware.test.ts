/**
 * Property tests for middleware redirect logic — unauthenticated requests
 *
 * Property 1: Unauthenticated requests to any protected path redirect to sign-in
 * For any request path that is NOT '/sign-in', when the request carries no valid
 * session cookie (absent, expired, or signature-invalid), the middleware response
 * SHALL be a redirect to '/sign-in'.
 *
 * Validates: Requirements 1.1, 10.1, 10.2
 */
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

// Mock next/server so NextResponse works in a Node test environment
vi.mock("next/server", () => {
  const redirectUrls: Map<string, string> = new Map();

  class MockNextResponse {
    readonly type: "redirect" | "next";
    readonly redirectUrl?: string;

    constructor(type: "redirect" | "next", redirectUrl?: string) {
      this.type = type;
      this.redirectUrl = redirectUrl;
    }

    static redirect(url: URL): MockNextResponse {
      return new MockNextResponse("redirect", url.pathname);
    }

    static next(_init?: unknown): MockNextResponse {
      return new MockNextResponse("next");
    }
  }

  return { NextResponse: MockNextResponse };
});

// Import helpers AFTER mocking next/server
import { handleInvalidTokenRedirect } from "../../middleware";

// Arbitrary that generates any path string except '/sign-in'
const protectedPathArb = fc
  .string({ minLength: 1 })
  .filter((s) => s !== "/sign-in")
  .map((s) => (s.startsWith("/") ? s : `/${s}`));

const BASE_URL = "http://localhost:3000";

describe("handleInvalidTokenRedirect — Property 1", () => {
  /**
   * **Validates: Requirements 1.1, 10.1, 10.2**
   *
   * Property 1: For any path that is NOT '/sign-in', an unauthenticated request
   * (invalid/missing token) SHALL produce a redirect response to '/sign-in'.
   */
  it("redirects to /sign-in for any path that is not /sign-in", () => {
    fc.assert(
      fc.property(protectedPathArb, (pathname) => {
        const response = handleInvalidTokenRedirect(pathname, BASE_URL) as any;
        expect(response.type).toBe("redirect");
        expect(response.redirectUrl).toBe("/sign-in");
      }),
    );
  });

  /**
   * **Validates: Requirements 1.1, 10.1, 10.2**
   *
   * Edge case: the root path '/' is a protected path and must redirect to '/sign-in'.
   */
  it("redirects to /sign-in for the root path /", () => {
    const response = handleInvalidTokenRedirect("/", BASE_URL) as any;
    expect(response.type).toBe("redirect");
    expect(response.redirectUrl).toBe("/sign-in");
  });

  /**
   * **Validates: Requirements 1.1, 10.1, 10.2**
   *
   * Edge case: '/sign-in' itself must NOT redirect — it returns NextResponse.next().
   */
  it("returns next() for /sign-in (not a redirect)", () => {
    const response = handleInvalidTokenRedirect("/sign-in", BASE_URL) as any;
    expect(response.type).toBe("next");
    expect(response.redirectUrl).toBeUndefined();
  });
});
