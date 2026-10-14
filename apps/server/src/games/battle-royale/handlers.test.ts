import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// handlers.ts -> stats.ts -> db, so mock db before importing. Capture upserts
// so we can assert the leaver (and only the leaver) is recorded on a bots-only
// leave.
const insertedRows: Array<{ userId: string; won: boolean }> = [];
vi.mock("db", () => {
  return {
    db: {
      // writeModeStats runs the upserts inside db.transaction; passthrough so
      // the mocked upsertModeStats fires with a dummy tx.
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
    upsertModeStats: (
      _tx: unknown,
      {
        userId,
        scope,
        outcome,
      }: { userId: string; scope: string; outcome: { won: boolean } },
    ) => {
      if (scope === "lifetime") {
        insertedRows.push({ userId, won: outcome.won });
      }
      return Promise.resolve(undefined);
    },
    setWonLastRealtimeGame: () => Promise.resolve(undefined),
    matchPoints: () => 0,
    seasonKey: () => "2026-01",
    LIFETIME_SCOPE: "lifetime",
  };
});

const { registerBattleRoyaleHandlers } = await import("./handlers.js");
const { games, serverOnlyData, serverOnlyBotData } = await import("./state.js");

type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  leftRooms: string[];
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
  leftRooms: [],
  on(event, cb) {
    this.handlers[event] = cb;
  },
  emit(event, payload) {
    this.emitted.push({ event, payload });
  },
  join() {},
  leave(room) {
    this.leftRooms.push(room);
  },
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

const makePlayer = (fields: Partial<PlayerDisplay> = {}): PlayerDisplay => ({
  name: "p",
  isEliminated: false,
  life: Date.now() + 60_000,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
  ...fields,
});

const seedStartedGame = (
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
  const { io, connect } = makeIo();
  registerBattleRoyaleHandlers(io);
  const socket = makeSocket(userId, name);
  connect(socket);
  return socket;
};

/** Like `wire`, but also surfaces the room-broadcast capture so a test can
 * assert a resync reply goes to the requesting socket ONLY (never `io.to`). */
const wireWithRoom = (userId: string, name: string) => {
  const { io, connect, toEmits } = makeIo();
  registerBattleRoyaleHandlers(io);
  const socket = makeSocket(userId, name);
  connect(socket);
  return { socket, toEmits };
};

describe("Battle Royale leave: bots-only cleanup", () => {
  beforeEach(() => {
    games.clear();
    serverOnlyData.clear();
    serverOnlyBotData.clear();
    insertedRows.length = 0;
  });

  it("tears down an in-progress game when the last human leaves and only bots remain", () => {
    const human = randomUUID();
    const lobbyId = "br-bots-leave";
    seedStartedGame(lobbyId, [
      [human, makePlayer({ name: "alice" })],
      ["bot0", makePlayer({ name: "bot0" })],
      ["bot1", makePlayer({ name: "bot1" })],
    ]);
    // A live game timer to confirm cleanup clears it.
    const roomData = serverOnlyData.get(lobbyId);
    if (roomData) {
      roomData.timers.gameTimer = setInterval(() => {}, 1000);
    }

    const socket = wire(human, "alice");
    socket.data.roomId = lobbyId;

    socket.handlers.leave?.();

    // The leaving human forfeits as a loss (recorded once).
    expect(insertedRows.map((r) => r.userId)).toEqual([human]);
    // Only bots would remain, so the room is torn down rather than left running.
    expect(games.has(lobbyId)).toBe(false);
    expect(serverOnlyData.has(lobbyId)).toBe(false);
    expect(serverOnlyBotData.has(lobbyId)).toBe(false);
  });

  // --- resync (realtime-broadcast-scaling Req 4.4, 4.8), flag OFF ---------
  // Validates: Requirements 4.4, 4.8
  it("resync (flag OFF) replies to the requesting socket only with the full trimmed snapshot", () => {
    const userId = randomUUID();
    const lobbyId = "br-resync-off";
    seedStartedGame(lobbyId, [
      [userId, makePlayer({ name: "nina", totalGuesses: 4 })],
      [randomUUID(), makePlayer({ name: "omar" })],
    ]);

    const { socket, toEmits } = wireWithRoom(userId, "nina");
    socket.data.roomId = lobbyId;

    socket.handlers.resync?.();

    // Reply goes to THIS socket, not a room broadcast.
    const reply = socket.emitted.find((e) => e.event === "lobby:update");
    expect(reply).toBeDefined();
    expect(toEmits.length).toBe(0);

    // Flag off → full trimmed snapshot (no envelope seq/type).
    const payload = reply?.payload as {
      seq?: number;
      type?: string;
      room: { lobbyId: string };
      players: Record<string, PlayerDisplay>;
    };
    expect(payload.type).toBeUndefined();
    expect(payload.seq).toBeUndefined();
    expect(payload.room.lobbyId).toBe(lobbyId);
    expect(payload.players[userId].totalGuesses).toBe(4);
  });

  it("resync for an unknown room is a safe no-op", () => {
    const userId = randomUUID();
    const { socket, toEmits } = wireWithRoom(userId, "rob");
    socket.data.roomId = "br-does-not-exist";

    expect(() => socket.handlers.resync?.()).not.toThrow();
    expect(socket.emitted.some((e) => e.event === "lobby:update")).toBe(false);
    expect(toEmits.length).toBe(0);
    expect(games.has("br-does-not-exist")).toBe(false);
  });

  it("resync from a socket not in any room is a safe no-op", () => {
    const userId = randomUUID();
    const { socket } = wireWithRoom(userId, "sam");
    socket.data.roomId = undefined;

    expect(() => socket.handlers.resync?.()).not.toThrow();
    expect(socket.emitted.some((e) => e.event === "lobby:update")).toBe(false);
  });

  it("keeps the game alive when a human leaves but another human (even eliminated/spectating) remains", () => {
    const leaver = randomUUID();
    const spectator = randomUUID();
    const lobbyId = "br-spectator-stays";
    const game = seedStartedGame(lobbyId, [
      [leaver, makePlayer({ name: "bob" })],
      // An eliminated-but-still-connected human is a spectator.
      [spectator, makePlayer({ name: "cara", isEliminated: true, endTimeStamp: 1 })],
      ["bot0", makePlayer({ name: "bot0" })],
    ]);

    const socket = wire(leaver, "bob");
    socket.data.roomId = lobbyId;

    socket.handlers.leave?.();

    // The room survives for the remaining (spectating) human.
    expect(games.has(lobbyId)).toBe(true);
    expect(game.players.has(leaver)).toBe(false);
    expect(game.players.has(spectator)).toBe(true);
  });
});
