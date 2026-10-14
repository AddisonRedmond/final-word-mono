import type { Server } from "socket.io";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: realtime-broadcast-scaling, Task 6.3 — resync endpoint (Battle
// Royale), FLAG-ON path.
//
// `DELTA_BROADCAST_ENABLED` is a module constant (not a mutable config object
// like Race's), so to exercise the flag-ON branch we mock the state module to
// flip it on while keeping its real `games` / `serverOnlyData` maps and other
// exports. With the flag on, a `resync` request replies to the REQUESTING
// socket only (never a room broadcast) with a stamped KEYFRAME envelope and
// advances the room's `broadcastVersion` by exactly one keyframe. Repeated
// resyncs are therefore IDEMPOTENT (Req 4.8): each simply replies with another
// current keyframe (seq 1, 2, 3, …) with no crash and no gameplay side effect.
//
// Validates: Requirements 4.4, 4.8

// handlers.ts -> stats.ts -> db, so mock db before importing.
vi.mock("db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
  upsertModeStats: () => Promise.resolve(undefined),
  setWonLastRealtimeGame: () => Promise.resolve(undefined),
  matchPoints: () => 0,
  seasonKey: () => "2026-01",
  LIFETIME_SCOPE: "lifetime",
}));

// Flip the delta flag ON while keeping the real shared state maps.
vi.mock("./state.js", async () => {
  const actual =
    await vi.importActual<typeof import("./state.js")>("./state.js");
  return { ...actual, DELTA_BROADCAST_ENABLED: true };
});

// Import AFTER the mocks so the flag-on module is used and the handlers read
// the same `games` / `serverOnlyData` references we set up below.
const { registerBattleRoyaleHandlers } = await import("./handlers.js");
const { games, serverOnlyData, serverOnlyBotData } = await import("./state.js");

type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  on: (event: string, cb: (...args: unknown[]) => unknown) => void;
  emit: (event: string, payload?: unknown) => void;
  join: (room: string) => void;
  leave: (room: string) => void;
};

const makeSocket = (userId: string, name: string): FakeSocket => ({
  id: `sock-${userId}`,
  data: { userId, name },
  handlers: {},
  emitted: [],
  on(event, cb) {
    this.handlers[event] = cb;
  },
  emit(event, payload) {
    this.emitted.push({ event, payload });
  },
  join() {},
  leave() {},
});

const makeIo = () => {
  let connectionCb: ((socket: FakeSocket) => void) | undefined;
  const toEmits: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    on(event: string, cb: (socket: FakeSocket) => void) {
      if (event === "connection") {
        connectionCb = cb;
      }
    },
    to(room: string) {
      return {
        emit: (event: string, payload?: unknown) => {
          toEmits.push({ room, event, payload });
        },
      };
    },
  };
  return {
    io: io as unknown as Server,
    connect: (socket: FakeSocket) => connectionCb?.(socket),
    toEmits,
  };
};

const makePlayer = (name: string): PlayerDisplay => ({
  name,
  isEliminated: false,
  life: Date.now() + 60_000,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
});

const seedGame = (
  lobbyId: string,
  players: Array<[string, PlayerDisplay]>,
): Game => {
  const game: Game = {
    room: {
      lobbyId,
      startTime: Date.now(),
      isStarted: true,
      createdAt: Date.now(),
      isFinished: false,
      isDraw: false,
    },
    players: new Map(players),
  };
  games.set(lobbyId, game);
  serverOnlyData.set(lobbyId, { playerData: {}, timers: {} });
  serverOnlyBotData.set(lobbyId, {});
  return game;
};

const wire = (userId: string, name: string) => {
  const { io, connect, toEmits } = makeIo();
  registerBattleRoyaleHandlers(io);
  const socket = makeSocket(userId, name);
  connect(socket);
  return { socket, toEmits };
};

describe("Battle Royale resync, flag ON (Task 6.3, Req 4.4/4.8)", () => {
  beforeEach(() => {
    games.clear();
    serverOnlyData.clear();
    serverOnlyBotData.clear();
  });

  it("replies with a keyframe envelope and advances the version by one keyframe per resync (idempotent)", () => {
    const userId = "11111111-1111-4000-8000-000000000000";
    const lobbyId = "br-resync-on";
    seedGame(lobbyId, [
      [userId, makePlayer("pam")],
      ["22222222-2222-4000-8000-000000000000", makePlayer("quinn")],
    ]);

    const { socket, toEmits } = wire(userId, "pam");
    socket.data.roomId = lobbyId;

    // Three resyncs in a row — repeated requests must be safe.
    socket.handlers.resync?.();
    socket.handlers.resync?.();
    socket.handlers.resync?.();

    const replies = socket.emitted.filter((e) => e.event === "lobby:update");
    expect(replies.length).toBe(3);
    // Never a room broadcast — only the requester hears it.
    expect(toEmits.length).toBe(0);

    const seqs = replies.map((r) => {
      const env = r.payload as { seq: number; type: string };
      expect(env.type).toBe("keyframe");
      return env.seq;
    });
    // Each resync advances the per-room version by exactly one keyframe.
    expect(seqs).toEqual([1, 2, 3]);
    expect(serverOnlyData.get(lobbyId)?.broadcastVersion?.seq).toBe(3);
  });
});
