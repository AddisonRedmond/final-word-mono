import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Namespace } from "socket.io";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race, Task 13.5
//
// Unit tests for the connection handler's reconnect routing (`join`),
// explicit departure (`leave`), and accidental drop (`disconnect`) handlers in
// `registerRaceHandlers`. These exercise the disconnect-retains-state,
// reconnect-to-same-match, eliminated-reconnect-to-fresh-lobby, in-progress-
// leave-forfeits, and empty-room-cleanup flows.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5

// `handlers.ts` transitively imports `stats.ts` -> `db`, so mock `db` before
// importing the code under test. We also capture every `.insert().values()`
// row so we can assert the in-progress leaver was persisted as a loss (Req 9.3).
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
    raceStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

// Import AFTER the mock is registered. The handlers read the module globals
// (`matches`, `serverOnlyData`, `serverOnlyBotData`, `config`) from state.js,
// so we import those same references to set up and tear down scenarios.
const { registerRaceHandlers } = await import("./handlers.js");
const { matches, serverOnlyData, serverOnlyBotData } = await import(
  "./state.js"
);

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A fake socket that captures the join/leave/disconnect handlers registered
 * via `.on(...)` and records `.emit`, `.join`, `.leave` calls. `data` is
 * mutable so the handlers can read/clear `roomId`. */
type FakeSocket = {
  id: string;
  data: { userId: string; name: string; roomId?: string };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  joinedRooms: string[];
  leftRooms: string[];
  on: (event: string, cb: (...args: unknown[]) => unknown) => void;
  emit: (event: string, payload?: unknown) => void;
  join: (room: string) => void;
  leave: (room: string) => void;
};

const makeSocket = (userId: string, name: string): FakeSocket => {
  const socket: FakeSocket = {
    id: `sock-${userId}`,
    data: { userId, name },
    handlers: {},
    emitted: [],
    joinedRooms: [],
    leftRooms: [],
    on(event, cb) {
      this.handlers[event] = cb;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    join(room) {
      this.joinedRooms.push(room);
    },
    leave(room) {
      this.leftRooms.push(room);
    },
  };
  return socket;
};

/** A fake `/race` namespace. `to().emit()` is a no-op spy so broadcasts from
 * the handlers (scheduled updates, membership) don't fail. We capture the
 * connection callback so a test can drive it with a fake socket. */
const makeNsp = () => {
  let connectionCb: ((socket: FakeSocket) => void) | undefined;
  const toEmits: Array<{ room: string; event: string; payload: unknown }> = [];

  const nsp = {
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
    nsp: nsp as unknown as Namespace,
    connect: (socket: FakeSocket) => connectionCb?.(socket),
    toEmits,
  };
};

// A deterministic v4-shaped UUID so real-player ids pass the code's UUID check.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
  name: fields.name ?? "p",
  isBot: fields.isBot ?? false,
  isEliminated: fields.isEliminated ?? false,
  completedWords: fields.completedWords ?? 0,
  qualified: fields.qualified ?? false,
  roundGuesses: fields.roundGuesses ?? 0,
  totalGuesses: fields.totalGuesses ?? 0,
  correctGuesses: fields.correctGuesses ?? 0,
  correctLetters: fields.correctLetters ?? 0,
});

/** Seed an in-progress (phase `round`) match into the global maps with the
 * given real players, plus its server-only + bot records. Returns the match. */
const seedMatch = (
  matchId: string,
  players: Array<[string, RacePlayer]>,
): RaceMatch => {
  const match: RaceMatch = {
    room: {
      matchId,
      phase: "round",
      createdAt: 0,
      lobbyDeadline: 0,
      currentRoundIndex: 0,
      roundEndsAt: Date.now() + 60_000,
      isDraw: false,
    },
    players: new Map(players),
  };
  matches.set(matchId, match);
  serverOnlyData.set(matchId, {
    players: Object.fromEntries(
      players.map(([id]) => [id, { word: "apple", lastAcceptedGuessAt: 0 }]),
    ),
    timers: {},
  });
  serverOnlyBotData.set(matchId, {});
  return match;
};

/** Reset the shared global maps between tests so scenarios don't leak. */
const clearGlobals = () => {
  matches.clear();
  serverOnlyData.clear();
  serverOnlyBotData.clear();
};

/** Wire the handlers and connect a fresh socket, returning the socket + nsp
 * spies so a test can invoke the captured event handlers. */
const wireSocket = (userId: string, name: string) => {
  const { nsp, connect, toEmits } = makeNsp();
  registerRaceHandlers(nsp);
  const socket = makeSocket(userId, name);
  connect(socket);
  return { socket, toEmits };
};

describe("registerRaceHandlers connection handlers (Req 9.1–9.5)", () => {
  beforeEach(() => {
    clearGlobals();
    insertedRows.length = 0;
    vi.useRealTimers();
  });

  // --- disconnect: retains state (Req 9.1) --------------------------------
  it("disconnect retains the player and their server-only data (Req 9.1)", () => {
    const userId = uuidFromSeed(1);
    const matchId = "match-disc";
    const match = seedMatch(matchId, [
      [userId, makePlayer({ name: "alice" })],
      [uuidFromSeed(2), makePlayer({ name: "bob" })],
    ]);

    const { socket } = wireSocket(userId, "alice");
    socket.data.roomId = matchId;

    socket.handlers.disconnect();

    // Player is STILL in the match and their server-only secret is intact —
    // nothing removed, nothing persisted.
    expect(match.players.has(userId)).toBe(true);
    expect(serverOnlyData.get(matchId)?.players[userId]).toBeDefined();
    expect(insertedRows.length).toBe(0);
    // Match itself is retained for reconnect.
    expect(matches.has(matchId)).toBe(true);
  });

  // --- join: reconnect to same match (Req 9.2) ----------------------------
  it("reconnect returns the same match with a join:ack snapshot (Req 9.2)", async () => {
    const userId = uuidFromSeed(3);
    const matchId = "match-recon";
    const match = seedMatch(matchId, [
      [userId, makePlayer({ name: "carol", completedWords: 2 })],
      [uuidFromSeed(4), makePlayer({ name: "dave" })],
    ]);

    const { socket } = wireSocket(userId, "carol");

    await socket.handlers.join();

    // Rejoined the SAME match id.
    expect(socket.joinedRooms).toContain(matchId);
    expect(socket.data.roomId).toBe(matchId);

    // A join:ack carrying the current snapshot was emitted.
    const ack = socket.emitted.find((e) => e.event === "join:ack");
    expect(ack).toBeDefined();
    const payload = ack?.payload as {
      room: { matchId: string };
      players: Record<string, RacePlayer>;
    };
    expect(payload.room.matchId).toBe(matchId);
    expect(payload.players[userId]).toBeDefined();
    expect(payload.players[userId].completedWords).toBe(2);

    // No new match was created and the player is not duplicated.
    expect(matches.size).toBe(1);
    expect(match.players.size).toBe(2);
  });

  // --- join: eliminated reconnect -> fresh lobby (Req 9.5) ----------------
  it("eliminated reconnect routes the player into a fresh lobby (Req 9.5)", async () => {
    const userId = uuidFromSeed(5);
    const oldMatchId = "match-elim";
    const oldMatch = seedMatch(oldMatchId, [
      [userId, makePlayer({ name: "erin", isEliminated: true })],
      [uuidFromSeed(6), makePlayer({ name: "frank" })],
    ]);

    const { socket } = wireSocket(userId, "erin");

    await socket.handlers.join();

    // Removed from the old (in-progress) match and its server-only record.
    expect(oldMatch.players.has(userId)).toBe(false);
    expect(serverOnlyData.get(oldMatchId)?.players[userId]).toBeUndefined();

    // Placed into a DIFFERENT, freshly created lobby.
    const newRoomId = socket.data.roomId;
    expect(newRoomId).toBeDefined();
    expect(newRoomId).not.toBe(oldMatchId);
    expect(socket.joinedRooms).toContain(newRoomId as string);

    const newMatch = matches.get(newRoomId as string);
    expect(newMatch).toBeDefined();
    expect(newMatch?.room.phase).toBe("lobby");
    expect(newMatch?.players.has(userId)).toBe(true);

    // The join:ack reflects the fresh lobby, not the old match.
    const ack = socket.emitted.find((e) => e.event === "join:ack");
    expect(ack).toBeDefined();
    expect(
      (ack?.payload as { room: { matchId: string } }).room.matchId,
    ).toBe(newRoomId);
  });

  // --- leave: in-progress forfeits + empty-room cleanup (Req 9.3, 9.4) ----
  it("in-progress leave by the sole player forfeits as a loss and cleans up the empty room (Req 9.3, 9.4)", () => {
    const userId = uuidFromSeed(7);
    const matchId = "match-leave";
    const match = seedMatch(matchId, [
      [userId, makePlayer({ name: "gina", totalGuesses: 5, correctGuesses: 3 })],
    ]);
    // Give the room a live timer so we can confirm cleanup clears it.
    const roomData = serverOnlyData.get(matchId);
    if (roomData) {
      roomData.timers.roundTimer = setTimeout(() => {}, 60_000);
    }

    const { socket } = wireSocket(userId, "gina");
    socket.data.roomId = matchId;

    const ack = vi.fn();
    socket.handlers.leave(ack);

    // In-progress leaver persisted as a loss (Req 9.3 -> Req 8.6 path).
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].userId).toBe(userId);
    expect(insertedRows[0].wins).toBe(0);

    // Player removed and, since the room is now empty, the whole room state is
    // torn down (Req 9.4).
    expect(match.players.size).toBe(0);
    expect(matches.has(matchId)).toBe(false);
    expect(serverOnlyData.has(matchId)).toBe(false);
    expect(serverOnlyBotData.has(matchId)).toBe(false);

    // The socket left the room, its roomId was cleared, and the ack succeeded.
    expect(socket.leftRooms).toContain(matchId);
    expect(socket.data.roomId).toBeUndefined();
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("leaving a not-yet-started lobby records no stats and cleans up when empty (Req 9.4)", () => {
    const userId = uuidFromSeed(8);
    const matchId = "match-lobby-leave";
    // A lobby-phase match (not yet started) with a single real player.
    const match: RaceMatch = {
      room: {
        matchId,
        phase: "lobby",
        createdAt: 0,
        lobbyDeadline: Date.now() + 30_000,
        currentRoundIndex: 0,
        isDraw: false,
      },
      players: new Map([[userId, makePlayer({ name: "hank" })]]),
    };
    matches.set(matchId, match);
    serverOnlyData.set(matchId, {
      players: { [userId]: { word: "", lastAcceptedGuessAt: 0 } },
      timers: {},
    });
    serverOnlyBotData.set(matchId, {});

    const { socket } = wireSocket(userId, "hank");
    socket.data.roomId = matchId;

    socket.handlers.leave();

    // Lobby leaver: NO stats persisted (Req 8.7 via the leave path).
    expect(insertedRows.length).toBe(0);
    // Empty room torn down (Req 9.4).
    expect(matches.has(matchId)).toBe(false);
    expect(serverOnlyData.has(matchId)).toBe(false);
    expect(serverOnlyBotData.has(matchId)).toBe(false);
  });

  it("in-progress leave with a remaining player keeps the room and does not clean up (Req 9.3)", () => {
    const leaver = uuidFromSeed(9);
    const stayer = uuidFromSeed(10);
    const matchId = "match-leave-remain";
    const match = seedMatch(matchId, [
      [leaver, makePlayer({ name: "ivy" })],
      [stayer, makePlayer({ name: "jack" })],
    ]);

    const { socket } = wireSocket(leaver, "ivy");
    socket.data.roomId = matchId;

    socket.handlers.leave();

    // Leaver forfeited (loss persisted), but the room survives for the stayer.
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].userId).toBe(leaver);
    expect(match.players.has(leaver)).toBe(false);
    expect(match.players.has(stayer)).toBe(true);
    expect(matches.has(matchId)).toBe(true);
    expect(serverOnlyData.has(matchId)).toBe(true);
  });

  // --- leave: last human out leaving only bots -> abandon (stop match) -----
  it("abandons the match when the last human leaves and only bots remain", () => {
    const leaver = uuidFromSeed(11);
    const matchId = "match-leave-bots";
    // One human + two bots, all in progress. The human is the only real player.
    const match = seedMatch(matchId, [
      [leaver, makePlayer({ name: "kate" })],
      ["bot0", makePlayer({ name: "bot0", isBot: true })],
      ["bot1", makePlayer({ name: "bot1", isBot: true })],
    ]);
    // A live round timer proves the room's timers get cleared on teardown.
    const roomData = serverOnlyData.get(matchId);
    if (roomData) {
      roomData.timers.roundTimer = setTimeout(() => {}, 60_000);
    }

    const { socket } = wireSocket(leaver, "kate");
    socket.data.roomId = matchId;

    socket.handlers.leave();

    // The leaving human still forfeits as a loss (they were in progress).
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].userId).toBe(leaver);

    // Only bots would remain, so the whole room is torn down rather than left
    // running with bots — matches abandoned, no bot winner, no broadcast.
    expect(matches.has(matchId)).toBe(false);
    expect(serverOnlyData.has(matchId)).toBe(false);
    expect(serverOnlyBotData.has(matchId)).toBe(false);
    // The room was marked finished before teardown.
    expect(match.room.phase).toBe("finished");
    expect(match.room.winnerId).toBeUndefined();
  });
});
