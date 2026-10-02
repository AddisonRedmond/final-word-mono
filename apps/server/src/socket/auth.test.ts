// Feature: anonymous-sign-in
//
// Integration test for the socket auth middleware's no-extra-query anonymous
// read (Task 7.2). The middleware resolves the user with a single
// `getUser(accessToken)` call and must derive `socket.data.isAnonymous`
// straight off that already-resolved user via `resolveIsAnonymous` — with no
// additional DB/network round-trip (R4.1). We also confirm `socket.data.name`
// is set from `resolveDisplayName` and that `next()` is called with no error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDisplayName, resolveIsAnonymous } from "./anonymous.js";

// Hoisted mock for the Supabase admin client's `getUser`. Declared via
// `vi.hoisted` so it exists when the `vi.mock` factory below runs (mock
// factories are hoisted above imports).
const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

// Mock the Supabase SDK so `createClient` returns an admin stub whose
// `auth.getUser` is our spy. This lets us assert the call count (no extra
// query) and control the resolved user's `is_anonymous` value.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}));

// Silence the logger so test output stays clean.
vi.mock("../utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const ACCESS_TOKEN = "test-access-token";

// Build a minimal fake socket carrying the handshake auth token the middleware
// reads, plus a fresh `data` bag the middleware populates.
const makeSocket = () => ({
  id: "socket-under-test",
  handshake: {
    auth: { token: ACCESS_TOKEN },
    query: {},
    headers: {},
  },
  data: {} as Record<string, unknown>,
});

// Import the middleware lazily so the module-level env check and
// `createClient` call happen after env is stubbed and the SDK is mocked.
const loadMiddleware = async () => {
  const mod = await import("./auth.js");
  return mod.supabaseAuthMiddleware;
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  getUserMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabaseAuthMiddleware — no-extra-query anonymous read (Task 7.2)", () => {
  it("reads is_anonymous off the resolved user (single getUser call) for a guest", async () => {
    const user = {
      id: "user-anon",
      is_anonymous: true,
      user_metadata: { full_name: "Player#AB12" },
    };
    getUserMock.mockResolvedValue({ data: { user }, error: null });

    const supabaseAuthMiddleware = await loadMiddleware();
    const socket = makeSocket();
    const next = vi.fn();

    // biome-ignore lint/suspicious/noExplicitAny: fake socket for middleware
    await supabaseAuthMiddleware(socket as any, next);

    // Exactly one getUser call: the anonymous flag is derived from the
    // already-resolved user, with no additional query (R4.1).
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledWith(ACCESS_TOKEN);

    expect(socket.data.userId).toBe(user.id);
    expect(socket.data.isAnonymous).toBe(resolveIsAnonymous(user));
    expect(socket.data.isAnonymous).toBe(true);
    expect(socket.data.name).toBe(resolveDisplayName(user));
    expect(socket.data.name).toBe("Player#AB12");

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("reads is_anonymous off the resolved user (single getUser call) for a registered user", async () => {
    const user = {
      id: "user-registered",
      is_anonymous: false,
      user_metadata: { full_name: "Jane Doe" },
    };
    getUserMock.mockResolvedValue({ data: { user }, error: null });

    const supabaseAuthMiddleware = await loadMiddleware();
    const socket = makeSocket();
    const next = vi.fn();

    // biome-ignore lint/suspicious/noExplicitAny: fake socket for middleware
    await supabaseAuthMiddleware(socket as any, next);

    // Still exactly one query; the flag comes from the resolved user only.
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledWith(ACCESS_TOKEN);

    expect(socket.data.userId).toBe(user.id);
    expect(socket.data.isAnonymous).toBe(resolveIsAnonymous(user));
    expect(socket.data.isAnonymous).toBe(false);
    expect(socket.data.name).toBe(resolveDisplayName(user));
    expect(socket.data.name).toBe("Jane Doe");

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
