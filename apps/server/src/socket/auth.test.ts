// Integration test for the socket auth middleware's no-extra-query user read.
// The middleware resolves the user with a single `getUser(accessToken)` call
// and derives `socket.data.name` straight off that already-resolved user, with
// no additional DB/network round-trip. We also confirm `next()` is called with
// no error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock for the Supabase admin client's `getUser`. Declared via
// `vi.hoisted` so it exists when the `vi.mock` factory below runs (mock
// factories are hoisted above imports).
const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

// Mock the Supabase SDK so `createClient` returns an admin stub whose
// `auth.getUser` is our spy. This lets us assert the call count (no extra
// query) and control the resolved user.
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

describe("supabaseAuthMiddleware — no-extra-query user read", () => {
  it("resolves name off the user with a single getUser call", async () => {
    const user = {
      id: "user-registered",
      user_metadata: { full_name: "Jane Doe" },
    };
    getUserMock.mockResolvedValue({ data: { user }, error: null });

    const supabaseAuthMiddleware = await loadMiddleware();
    const socket = makeSocket();
    const next = vi.fn();

    // biome-ignore lint/suspicious/noExplicitAny: fake socket for middleware
    await supabaseAuthMiddleware(socket as any, next);

    // Exactly one getUser call: everything is derived from the already-resolved
    // user, with no additional query.
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledWith(ACCESS_TOKEN);

    expect(socket.data.userId).toBe(user.id);
    expect(socket.data.name).toBe("Jane Doe");

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to \"Player\" when full_name is blank", async () => {
    const user = {
      id: "user-no-name",
      user_metadata: { full_name: "   " },
    };
    getUserMock.mockResolvedValue({ data: { user }, error: null });

    const supabaseAuthMiddleware = await loadMiddleware();
    const socket = makeSocket();
    const next = vi.fn();

    // biome-ignore lint/suspicious/noExplicitAny: fake socket for middleware
    await supabaseAuthMiddleware(socket as any, next);

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(socket.data.userId).toBe(user.id);
    expect(socket.data.name).toBe("Player");

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
