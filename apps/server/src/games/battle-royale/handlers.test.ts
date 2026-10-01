import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// handlers.ts -> stats.ts -> db, so mock db before importing. Capture upserts
// so we can assert the leaver (and only the leaver) is recorded on a bots-only
// leave.
const insertedRows: Array<{ userId: string; wins: number }> = [];
vi.mock("db", () => {
  const insert = () => ({
    values: (row: { userId: string; wins: number }) => {
      insertedRows.push(row);
      return { onConflictDoUpdate: () => Promise.resolve(undefined) };
    },
  });
  return {
    db: { insert },
    battleRoyaleStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

const { registerBattleRoyaleHandlers } = await import("./handlers.js");
const { games, serverOnlyData, serverOnlyBotData } = await import("./state.js");

type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string };
  handlers: Record<string, (...args: unknown[]) => unknown>;
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
  leftRooms: [],
  on(event, cb) {
    this.handlers[event] = cb;
  },
  emit() {},
  join() {},
  leave(room) {
    this.leftRooms.push(room);
  },
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
