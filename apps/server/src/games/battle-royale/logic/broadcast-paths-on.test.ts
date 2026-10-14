import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import type {
  Game,
  PlayerDisplay,
  Room,
  RoomTimers,
  ServerBotData,
} from "types/battle-royale.types.js";

// Feature: realtime-broadcast-scaling, Task 8.1 — flag-ON correctness of the
// Battle Royale timer broadcast paths (Req 3.7).
//
// This is the companion to `broadcast-paths.test.ts` (flag OFF). It proves the
// REASON the two timer broadcasts were routed through `emitBattleRoyaleKeyframe`
// rather than left as bare `serializeGame` emits: with the delta flag ON, each
// of these broadcasts must advance the room's per-room `broadcastVersion`
// (stamp a monotonic `seq`, reset `ticksSinceKeyframe`, store `lastSent`) so a
// subsequent delta diffs against the right base. A bare snapshot emit would
// have left the version untouched and desynced the client's sequence base.
//
// `DELTA_BROADCAST_ENABLED` is a module constant, so we mock `../state.js` to
// flip it on (same technique as `lobby.keyframe-on.test.ts`) while keeping the
// real `serverOnlyData` map.
//
// Validates: Requirements 3.7

vi.mock("../state.js", async () => {
  const actual =
    await vi.importActual<typeof import("../state.js")>("../state.js");
  return { ...actual, DELTA_BROADCAST_ENABLED: true };
});

// Imported AFTER the mock so the flag-on lobby module is used by the logic.
// `serverOnlyData` is the REAL module singleton the lobby emitter reads from
// (`buildBattleRoyaleKeyframePayload` looks the room up on its own imported
// `serverOnlyData`, not on the map handed to `handleStartGame`), so the test
// must seed and assert against this exact instance.
const { handleStartGame } = await import("./battle-royale.js");
const { scheduleMatchTimeLimit } = await import("./match-timer.js");
const strain = await import("../../../telemetry/strain.js");
const { serverOnlyData } = await import("../state.js");

const ROOM_ID = "br-broadcast-paths-on";

const makePlayer = (
  id: string,
  fields: Partial<PlayerDisplay> = {},
): PlayerDisplay => ({
  name: id,
  revealed_letters: {},
  partialMatches: [],
  noMatch: [],
  display_queue: [],
  isEliminated: false,
  life: Number.POSITIVE_INFINITY,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
  ...fields,
});

const makeRoom = (fields: Partial<Room> = {}): Room => ({
  lobbyId: ROOM_ID,
  startTime: 0,
  isStarted: false,
  isFinished: false,
  isDraw: false,
  ...fields,
});

const makeIo = (socketCount: number) => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const io = {
    to,
    sockets: {
      adapter: { rooms: new Map([[ROOM_ID, { size: socketCount }]]) },
    },
  } as unknown as Server;
  return { io, emit };
};

describe("Battle Royale timer broadcast paths advance the version, flag ON (Task 8.1)", () => {
  let serverOnlyBotData: ServerBotData;
  let games: Map<string, Game>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyBotData = new Map();
    games = new Map();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("the 1 Hz game sweep emits a keyframe envelope and advances broadcastVersion", () => {
    // THREE players so eliminating one still leaves two alive — the game does
    // NOT finish on this sweep, so `cleanupGame` (called internally by the
    // sweep only when the game finishes) does not delete the room's
    // server-only record, letting the test observe the advanced version.
    const players = new Map<string, PlayerDisplay>([
      ["p1", makePlayer("p1")],
      ["p2", makePlayer("p2")],
      ["p3", makePlayer("p3")],
    ]);
    const game: Game = { room: makeRoom(), players };
    games.set(ROOM_ID, game);
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });

    const timers: RoomTimers = {};
    const { io, emit } = makeIo(4);

    handleStartGame(game, io, timers, games, serverOnlyData, serverOnlyBotData);

    // Force a sweepable change (one player expires), then fire the first 1 Hz
    // tick. Two survivors remain, so the game keeps running after the broadcast.
    const p3 = game.players.get("p3");
    if (p3) p3.life = 1;
    vi.advanceTimersByTime(1000);

    const lobbyUpdates = emit.mock.calls.filter((c) => c[0] === "lobby:update");
    expect(lobbyUpdates.length).toBeGreaterThanOrEqual(1);
    // Flag ON: the sweep broadcast is a stamped keyframe, not a bare snapshot.
    expect(lobbyUpdates[0]?.[1]).toMatchObject({ seq: 1, type: "keyframe" });

    // The per-room version was advanced (the whole point of routing through the
    // shared emitter): seq 1, cadence reset, lastSent stored.
    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toBeDefined();

    if (timers.gameTimer) clearInterval(timers.gameTimer);
    if (timers.matchTimer) clearTimeout(timers.matchTimer);
  });

  it("the match-time-limit terminal broadcast emits a keyframe envelope and advances broadcastVersion", () => {
    const players = new Map<string, PlayerDisplay>([
      ["p1", makePlayer("p1", { correctGuesses: 5 })],
      ["p2", makePlayer("p2", { correctGuesses: 2 })],
    ]);
    const game: Game = { room: makeRoom({ isStarted: true }), players };
    games.set(ROOM_ID, game);
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });

    const { io, emit } = makeIo(6);

    scheduleMatchTimeLimit({
      game,
      io,
      games,
      serverOnlyData,
      serverOnlyBotData,
      revealEliminatedPlayerWord: vi.fn(),
      // Keep the version observable after the broadcast by not deleting state.
      cleanupGame: vi.fn(),
    });

    vi.runOnlyPendingTimers();

    const lobbyUpdates = emit.mock.calls.filter((c) => c[0] === "lobby:update");
    expect(lobbyUpdates.length).toBe(1);
    expect(lobbyUpdates[0]?.[1]).toMatchObject({ seq: 1, type: "keyframe" });

    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toBeDefined();
  });
});
