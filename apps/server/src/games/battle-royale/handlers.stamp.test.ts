import type { Server } from "socket.io";
import type { PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in, Task 8.3
//
// Unit tests for the per-match guest-flag STAMP in the Battle Royale `join`
// handler (task 8.2): the player record created at join must carry
// `isAnonymous === socket.data.isAnonymous` for both `true` and `false`
// (Req 4.5, 4.6).
//
// handlers.ts -> stats.ts -> db, so mock db before importing. The BR daily-
// limit seam is mocked to always PERMIT so placement proceeds regardless of
// the one-game-per-mode gate (R6.*), isolating the stamp behaviour.

vi.mock("db", () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }),
    }),
  },
  battleRoyaleStats: new Proxy({}, { get: (_t, key) => key }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("./daily-limit.js", () => ({
  canStartMatch: vi.fn(async () => true),
}));

const { registerBattleRoyaleHandlers } = await import("./handlers.js");
const { games, serverOnlyData, serverOnlyBotData } = await import("./state.js");

// ---------------------------------------------------------------------------
// Test doubles (mirror handlers.test.ts's fake socket + io harness)
// ---------------------------------------------------------------------------

type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string; isAnonymous: boolean };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  on: (event: string, cb: (...args: unknown[]) => unknown) => void;
  emit: (event: string, payload?: unknown) => void;
  join: (room: string) => void;
  leave: (room: string) => void;
};

const makeSocket = (
  userId: string,
  name: string,
  isAnonymous: boolean,
): FakeSocket => ({
  id: `sock-${userId}`,
  data: { userId, name, isAnonymous },
  handlers: {},
  on(event, cb) {
    this.handlers[event] = cb;
  },
  emit() {},
  join() {},
  leave() {},
});

const makeIo = () => {
  let connectionCb: ((socket: FakeSocket) => void) | undefined;
  const io = {
    on(event: string, cb: (socket: FakeSocket) => void) {
      if (event === "connection") {
        connectionCb = cb;
      }
    },
    to() {
      return { emit: () => {} };
    },
  };
  return {
    io: io as unknown as Server,
    connect: (socket: FakeSocket) => connectionCb?.(socket),
  };
};

const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const wire = (userId: string, name: string, isAnonymous: boolean) => {
  const { io, connect } = makeIo();
  registerBattleRoyaleHandlers(io);
  const socket = makeSocket(userId, name, isAnonymous);
  connect(socket);
  return socket;
};

describe("Battle Royale join handler stamps isAnonymous on the player record (Req 4.5, 4.6)", () => {
  beforeEach(() => {
    games.clear();
    serverOnlyData.clear();
    serverOnlyBotData.clear();
    // Fake timers so the lobby start timer armed on the first joiner never
    // fires (we only assert the record created synchronously at join time).
    vi.useFakeTimers();
  });

  it("stamps isAnonymous === true when socket.data.isAnonymous is true", async () => {
    const userId = uuidFromSeed(1);
    const socket = wire(userId, "guest", true);

    await socket.handlers.join();

    const roomId = socket.data.roomId;
    expect(roomId).toBeDefined();
    const player = games.get(roomId as string)?.players.get(userId) as
      | PlayerDisplay
      | undefined;
    expect(player).toBeDefined();
    expect(player?.isAnonymous).toBe(true);
  });

  it("stamps isAnonymous === false when socket.data.isAnonymous is false", async () => {
    const userId = uuidFromSeed(2);
    const socket = wire(userId, "registered", false);

    await socket.handlers.join();

    const roomId = socket.data.roomId;
    expect(roomId).toBeDefined();
    const player = games.get(roomId as string)?.players.get(userId) as
      | PlayerDisplay
      | undefined;
    expect(player).toBeDefined();
    expect(player?.isAnonymous).toBe(false);
  });
});
