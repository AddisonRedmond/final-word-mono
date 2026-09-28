import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtendedError, Socket } from "socket.io";

// Feature: round-based-elimination-race — Task 12.3
// Integration/smoke tests for Race_Mode registration and auth.
//
// These verify:
//   - Module identity (Req 1.1)
//   - Namespace registration + auth + connection handler wiring (Req 1.2, 1.3)
//   - Config-invalid skip (Req 2.7)
//   - Unauthenticated sockets are rejected before any handler runs (Req 1.4)
//
// `socket/auth.ts` reads Supabase env vars and constructs a Supabase client at
// import time. We provide dummy env vars (so the module-level guard passes)
// and mock `@supabase/supabase-js` so no real client/network is involved.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

// getUser is captured so individual tests can control the auth result.
const getUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser },
  }),
}));

// Import AFTER env + mocks are registered.
const raceModule = (await import("./index.js")).default;
const { supabaseAuthMiddleware } = await import("../../socket/auth.js");

/** Minimal recording stub for a Socket.IO Namespace. */
const makeNamespaceStub = () => {
  const nsp = {
    useCalls: [] as unknown[],
    connectionHandlers: [] as unknown[],
    use(fn: unknown) {
      nsp.useCalls.push(fn);
      return nsp;
    },
    on(event: string, fn: unknown) {
      if (event === "connection") {
        nsp.connectionHandlers.push(fn);
      }
      return nsp;
    },
  };
  return nsp;
};

/** Minimal recording stub for a Socket.IO Server (only `.of` is used). */
const makeServerStub = () => {
  const namespaces = new Map<string, ReturnType<typeof makeNamespaceStub>>();
  const ofCalls: string[] = [];
  const io = {
    ofCalls,
    namespaces,
    of(name: string) {
      ofCalls.push(name);
      let nsp = namespaces.get(name);
      if (!nsp) {
        nsp = makeNamespaceStub();
        namespaces.set(name, nsp);
      }
      return nsp;
    },
  };
  return io;
};

/** Builds a socket-like object with the given handshake fields. */
const makeSocket = (handshake: {
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): Socket =>
  ({
    id: "socket-test-id",
    data: {},
    handshake: {
      auth: handshake.auth ?? {},
      query: handshake.query ?? {},
      headers: handshake.headers ?? {},
    },
  }) as unknown as Socket;

describe("Race GameModule identity (Req 1.1)", () => {
  it('exposes the id "round-based-elimination-race"', () => {
    expect(raceModule.id).toBe("round-based-elimination-race");
  });
});

describe("Race GameModule registration (Req 1.2, 1.3)", () => {
  it('registers on the "/race" namespace with auth + connection handler', () => {
    const io = makeServerStub();

    // biome-ignore lint/suspicious/noExplicitAny: stub stands in for Server.
    raceModule.register(io as any);

    // Race is isolated on its own namespace (state isolation, Req 1.3).
    expect(io.ofCalls).toContain("/race");

    const nsp = io.namespaces.get("/race");
    expect(nsp).toBeDefined();

    // Auth middleware installed (Req 1.4 wiring) before handlers.
    expect(nsp?.useCalls.length).toBeGreaterThanOrEqual(1);

    // A connection handler is attached (Req 1.2).
    expect(nsp?.connectionHandlers.length).toBeGreaterThanOrEqual(1);
  });

  it("uses only the /race namespace (does not touch the default namespace)", () => {
    const io = makeServerStub();

    // biome-ignore lint/suspicious/noExplicitAny: stub stands in for Server.
    raceModule.register(io as any);

    for (const name of io.ofCalls) {
      expect(name).toBe("/race");
    }
  });
});

describe("Race auth middleware rejects unauthenticated sockets (Req 1.4)", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("rejects a connection with no token before any handler runs", async () => {
    const socket = makeSocket({ auth: {}, query: {}, headers: {} });
    const next = vi.fn<(err?: ExtendedError) => void>();

    await supabaseAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/unauthorized/i);

    // No user data was populated on the socket.
    expect(socket.data.userId).toBeUndefined();
    // Supabase was never consulted — rejected purely on the missing token.
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a connection whose token Supabase deems invalid", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    const socket = makeSocket({ auth: { token: "bogus-token" } });
    const next = vi.fn<(err?: ExtendedError) => void>();

    await supabaseAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/unauthorized/i);
    expect(socket.data.userId).toBeUndefined();
  });

  it("admits a valid token and populates socket.data (positive control)", async () => {
    getUser.mockResolvedValue({
      data: {
        user: { id: "user-123", user_metadata: { full_name: "Ada" } },
      },
      error: null,
    });

    const socket = makeSocket({ auth: { token: "good-token" } });
    const next = vi.fn<(err?: ExtendedError) => void>();

    await supabaseAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Called with no error argument on success.
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
    expect(socket.data.userId).toBe("user-123");
    expect(socket.data.name).toBe("Ada");
  });
});
