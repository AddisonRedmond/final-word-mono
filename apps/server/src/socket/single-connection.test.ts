import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Namespace, Server, Socket } from "socket.io";
import {
  ALREADY_CONNECTED_MESSAGE,
  __resetActiveSocketsForTest,
  installSingleConnection,
} from "./single-connection.js";

// Feature: single active connection per user, spanning namespaces.
//
// The games live on separate Socket.IO namespaces (Battle Royale on the default
// `/`, Race on `/race`). Socket.IO middleware/connection tracking is
// per-namespace, so the guard is installed on EACH namespace sharing one
// cross-namespace registry. These tests drive the installed middleware directly
// to prove: a user cannot hold two live sockets across namespaces; a refresh
// (old socket already gone) takes over the slot instead of being rejected; and
// a disconnect only frees the slot it still owns.

type MiddlewareFn = (
  socket: Socket,
  next: (err?: Error) => void,
) => void;

/**
 * A fake namespace that captures the `use` middleware and the `connection`
 * handler the guard installs, so a test can invoke them like Socket.IO would.
 */
class FakeNamespace {
  middleware?: MiddlewareFn;
  connectionHandler?: (socket: Socket) => void;

  use(fn: MiddlewareFn) {
    this.middleware = fn;
    return this;
  }

  on(event: string, handler: (socket: Socket) => void) {
    if (event === "connection") this.connectionHandler = handler;
    return this;
  }
}

/** A fake socket exposing just what the guard reads/calls. */
const makeSocket = (userId: string, id: string): Socket & { disconnectHandlers: Array<() => void> } => {
  const disconnectHandlers: Array<() => void> = [];
  return {
    id,
    connected: true,
    data: { userId },
    on(event: string, handler: () => void) {
      if (event === "disconnect") disconnectHandlers.push(handler);
      return this;
    },
    disconnectHandlers,
  } as unknown as Socket & { disconnectHandlers: Array<() => void> };
};

/** Run a namespace's `connection` handler so the socket's disconnect wiring is set. */
const connect = (nsp: FakeNamespace, socket: Socket) => {
  nsp.connectionHandler?.(socket);
};

/** Drive a namespace's admission middleware; returns the error (if rejected). */
const admit = (nsp: FakeNamespace, socket: Socket): Error | undefined => {
  let captured: Error | undefined;
  nsp.middleware?.(socket, (err?: Error) => {
    captured = err;
  });
  return captured;
};

describe("installSingleConnection (cross-namespace)", () => {
  let root: FakeNamespace;
  let race: FakeNamespace;

  beforeEach(() => {
    __resetActiveSocketsForTest();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = new FakeNamespace();
    race = new FakeNamespace();
    // Default namespace (BR) and /race share the one registry.
    installSingleConnection(root as unknown as Server);
    installSingleConnection(race as unknown as Namespace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetActiveSocketsForTest();
  });

  it("admits the first connection for a user", () => {
    const s = makeSocket("u1", "sock-1");
    expect(admit(root, s)).toBeUndefined();
  });

  it("rejects a second LIVE connection in another namespace (the cross-mode bug)", () => {
    const brSocket = makeSocket("u1", "br-1");
    expect(admit(root, brSocket)).toBeUndefined();
    connect(root, brSocket);

    // Same user tries to open a Race socket while the BR socket is still live.
    const raceSocket = makeSocket("u1", "race-1");
    const err = admit(race, raceSocket);

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe(ALREADY_CONNECTED_MESSAGE);
  });

  it("admits a different user on another namespace independently", () => {
    const a = makeSocket("u1", "br-1");
    admit(root, a);
    connect(root, a);

    const b = makeSocket("u2", "race-1");
    expect(admit(race, b)).toBeUndefined();
  });

  it("takes over the slot on refresh when the prior socket is already gone", () => {
    const old = makeSocket("u1", "br-1");
    admit(root, old);
    connect(root, old);

    // Simulate the refresh: the old transport has closed before the new socket
    // arrives.
    (old as unknown as { connected: boolean }).connected = false;

    // New connection (even into the OTHER mode) is admitted, not rejected.
    const fresh = makeSocket("u1", "race-1");
    expect(admit(race, fresh)).toBeUndefined();
  });

  it("frees the slot when the owning socket disconnects, allowing a new one", () => {
    const first = makeSocket("u1", "br-1");
    admit(root, first);
    connect(root, first);

    // The owning socket disconnects → its handler clears the slot.
    first.disconnectHandlers.forEach((h) => h());

    const second = makeSocket("u1", "race-1");
    expect(admit(race, second)).toBeUndefined();
  });

  it("a stale disconnect does NOT free a slot a newer socket owns", () => {
    const first = makeSocket("u1", "br-1");
    admit(root, first);
    connect(root, first);

    // Refresh: old gone, new takes over the slot.
    (first as unknown as { connected: boolean }).connected = false;
    const second = makeSocket("u1", "race-1");
    admit(race, second);
    connect(race, second);

    // The OLD socket's late disconnect fires — must not evict the new owner.
    first.disconnectHandlers.forEach((h) => h());

    // A third connection should still be rejected because `second` owns the slot.
    const third = makeSocket("u1", "br-2");
    const err = admit(root, third);
    expect(err?.message).toBe(ALREADY_CONNECTED_MESSAGE);
  });

  it("re-admitting the SAME socket id (idempotent) is not a self-rejection", () => {
    const s = makeSocket("u1", "sock-1");
    expect(admit(root, s)).toBeUndefined();
    // Same socket passes the middleware again (e.g. re-run) — not rejected.
    expect(admit(root, s)).toBeUndefined();
  });
});
