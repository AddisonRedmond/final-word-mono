import type { Namespace } from "socket.io";
import type { RacePlayer } from "types/race.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in, Task 8.3
//
// Unit tests for the per-match guest-flag STAMP in the Race `join` handler
// (task 8.1): the player record created at join must carry
// `isAnonymous === socket.data.isAnonymous` for both `true` and `false`
// (Req 4.5, 4.6).
//
// `handlers.ts` transitively imports `stats.ts` -> `db`, so mock `db` before
// importing the code under test (no real DB in a unit test). We also mock the
// Race daily-limit seam so `canStartMatch` always PERMITS — placement must
// proceed regardless of the guest gate so we can observe the stamped record.

vi.mock("db", () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }),
    }),
  },
  raceStats: new Proxy({}, { get: (_t, key) => key }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

// Permit every start so the join flow reaches fresh-lobby placement. This is
// the join-level match-start gate the handler consults before placing a player
// (`canStartMatch(userId, socket.data.isAnonymous)`); forcing it to allow
// isolates the stamp behaviour from the one-game-per-mode gate (R6.*).
vi.mock("./daily-limit.js", () => ({
  canStartMatch: vi.fn(async () => true),
  recordMatchStart: vi.fn(async () => undefined),
}));

// Import AFTER the mocks are registered. The handlers read the module globals
// from state.js, so import those same references to inspect the created record.
const { registerRaceHandlers } = await import("./handlers.js");
const { matches, serverOnlyData, serverOnlyBotData } = await import(
  "./state.js"
);

// ---------------------------------------------------------------------------
// Test doubles (mirror handlers.test.ts's fake socket + namespace harness)
// ---------------------------------------------------------------------------

type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string; isAnonymous: boolean };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  joinedRooms: string[];
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
  emitted: [],
  joinedRooms: [],
  on(event, cb) {
    this.handlers[event] = cb;
  },
  emit(event, payload) {
    this.emitted.push({ event, payload });
  },
  join(room) {
    this.joinedRooms.push(room);
  },
  leave() {},
});

const makeNsp = () => {
  let connectionCb: ((socket: FakeSocket) => void) | undefined;
  const nsp = {
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
    nsp: nsp as unknown as Namespace,
    connect: (socket: FakeSocket) => connectionCb?.(socket),
  };
};

// A deterministic v4-shaped UUID so real-player ids pass the code's UUID check.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const wireSocket = (userId: string, name: string, isAnonymous: boolean) => {
  const { nsp, connect } = makeNsp();
  registerRaceHandlers(nsp);
  const socket = makeSocket(userId, name, isAnonymous);
  connect(socket);
  return socket;
};

describe("Race join handler stamps isAnonymous on the player record (Req 4.5, 4.6)", () => {
  beforeEach(() => {
    matches.clear();
    serverOnlyData.clear();
    serverOnlyBotData.clear();
    // Fake timers so the lobby-start countdown armed on a single joiner never
    // fires during the test (we only assert the record created at join time).
    vi.useFakeTimers();
  });

  it("stamps isAnonymous === true when socket.data.isAnonymous is true", async () => {
    const userId = uuidFromSeed(1);
    const socket = wireSocket(userId, "guest", true);

    await socket.handlers.join();

    const roomId = socket.data.roomId;
    expect(roomId).toBeDefined();
    const player = matches.get(roomId as string)?.players.get(userId) as
      | RacePlayer
      | undefined;
    expect(player).toBeDefined();
    expect(player?.isAnonymous).toBe(true);
  });

  it("stamps isAnonymous === false when socket.data.isAnonymous is false", async () => {
    const userId = uuidFromSeed(2);
    const socket = wireSocket(userId, "registered", false);

    await socket.handlers.join();

    const roomId = socket.data.roomId;
    expect(roomId).toBeDefined();
    const player = matches.get(roomId as string)?.players.get(userId) as
      | RacePlayer
      | undefined;
    expect(player).toBeDefined();
    expect(player?.isAnonymous).toBe(false);
  });
});
