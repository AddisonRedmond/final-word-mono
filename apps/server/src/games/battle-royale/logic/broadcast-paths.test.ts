import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import type {
  Game,
  PlayerDisplay,
  Room,
  RoomTimers,
  ServerBotData,
} from "types/battle-royale.types.js";
import * as strain from "../../../telemetry/strain.js";
import { serializeGame } from "../lobby.js";
import { serverOnlyData } from "../state.js";
import { handleStartGame } from "./battle-royale.js";
import { scheduleMatchTimeLimit } from "./match-timer.js";

// Feature: realtime-broadcast-scaling, Task 8.1 — both modes behind the flag,
// symmetry of the keyframe/delta model (Req 3.7) and flag-OFF exactness (Req
// 5.5).
//
// Battle Royale has two STATE broadcasts that fire from timers rather than the
// coalesced `scheduleLobbyUpdate` path: the 1 Hz game sweep inside
// `handleStartGame` (attack cementing + life expiry) and the terminal
// match-time-limit broadcast in `scheduleMatchTimeLimit`. Both used to emit a
// BARE `serializeGame(game)` directly on `lobby:update`, bypassing the
// keyframe/delta decision every other broadcast goes through — an asymmetry
// with Race (whose gameplay loop broadcasts only via
// `emitRaceUpdate`/`emitRaceKeyframe`, never a bare `serializeRaceMatch` emit)
// and a flag-ON hazard (a bare snapshot would not advance the room's
// `seq`/`lastSent`, desyncing the client's sequence base).
//
// Task 8.1 routes both through the shared `emitBattleRoyaleKeyframe` emitter.
// These tests pin that:
//   - flag OFF (the shipped default): the wire payload is BYTE-IDENTICAL to the
//     full trimmed `serializeGame` snapshot — no `seq`/`type` envelope — and no
//     per-room version bookkeeping is created (Req 5.5);
//   - the broadcast is recorded through Strain_Telemetry like every other emit
//     choke point (the bare direct emits previously recorded nothing).
//
// Validates: Requirements 3.7, 5.5

const ROOM_ID = "br-broadcast-paths";

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

const makeGame = (players: Map<string, PlayerDisplay>, room = makeRoom()): Game => ({
  room,
  players,
});

// A mock Server exposing the `to(room).emit()` chain plus the adapter room map
// that `emitBattleRoyaleKeyframe` reads for the recipient count.
const makeIo = (socketCount: number) => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const io = {
    to,
    sockets: {
      adapter: { rooms: new Map([[ROOM_ID, { size: socketCount }]]) },
    },
  } as unknown as Server;
  return { io, to, emit };
};

describe("Battle Royale timer broadcast paths route through the keyframe emitter (Task 8.1)", () => {
  // The lobby emitter reads the REAL module-singleton `serverOnlyData`
  // (`buildBattleRoyaleKeyframePayload` looks the room up on its own imported
  // map, not the one handed to `handleStartGame`), so seed/assert against it.
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

  it("the 1 Hz game sweep (flag OFF) emits the full trimmed snapshot with no envelope and no version", () => {
    const recordSpy = vi.spyOn(strain, "recordBroadcast");

    // One player whose life has already expired, so the first sweep tick
    // eliminates them, resolves the game, and broadcasts (not an empty tick).
    const players = new Map<string, PlayerDisplay>([
      ["p1", makePlayer("p1")],
      ["p2", makePlayer("p2")],
    ]);
    const game = makeGame(players);
    games.set(ROOM_ID, game);
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });

    const timers: RoomTimers = {};
    const { io, to, emit } = makeIo(4);

    handleStartGame(game, io, timers, games, serverOnlyData, serverOnlyBotData);

    // `handleStartGame` overwrites every player's `life` to a future expiry, so
    // force one player's life into the past AFTER start. The first 1 Hz sweep
    // tick then eliminates them, resolves the game, and broadcasts (not an
    // empty-tick skip).
    const p2 = game.players.get("p2");
    if (p2) p2.life = 1;

    // Advance past the first 1 Hz sweep tick.
    vi.advanceTimersByTime(1000);

    expect(to).toHaveBeenCalledWith(ROOM_ID);
    const lobbyUpdates = emit.mock.calls.filter((c) => c[0] === "lobby:update");
    expect(lobbyUpdates.length).toBeGreaterThanOrEqual(1);

    const payload = lobbyUpdates[0]?.[1];
    // Flag OFF: byte-identical full trimmed snapshot, no `seq`/`type` envelope.
    expect(payload).toEqual(serializeGame(game));
    expect(payload).not.toHaveProperty("seq");
    expect(payload).not.toHaveProperty("type");
    // No per-room broadcast version was created (Req 5.5 — flag off touches no
    // version bookkeeping).
    expect(serverOnlyData.get(ROOM_ID)?.broadcastVersion).toBeUndefined();
    // The broadcast was recorded through Strain_Telemetry, like every other
    // emit choke point.
    expect(recordSpy).toHaveBeenCalled();

    // Tidy up any armed timers so they don't leak into other tests.
    if (timers.gameTimer) clearInterval(timers.gameTimer);
    if (timers.matchTimer) clearTimeout(timers.matchTimer);
  });

  it("the match-time-limit terminal broadcast (flag OFF) emits the full trimmed snapshot with no envelope and no version", () => {
    const recordSpy = vi.spyOn(strain, "recordBroadcast");

    const players = new Map<string, PlayerDisplay>([
      ["p1", makePlayer("p1", { correctGuesses: 5 })],
      ["p2", makePlayer("p2", { correctGuesses: 2 })],
    ]);
    const game = makeGame(players, makeRoom({ isStarted: true }));
    games.set(ROOM_ID, game);
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });

    const { io, to, emit } = makeIo(6);

    const revealEliminatedPlayerWord = vi.fn();
    const cleanupGame = vi.fn();

    scheduleMatchTimeLimit({
      game,
      io,
      games,
      serverOnlyData,
      serverOnlyBotData,
      revealEliminatedPlayerWord,
      cleanupGame,
    });

    // Fire the match-time-limit timer.
    vi.runOnlyPendingTimers();

    expect(to).toHaveBeenCalledWith(ROOM_ID);
    const lobbyUpdates = emit.mock.calls.filter((c) => c[0] === "lobby:update");
    expect(lobbyUpdates.length).toBe(1);

    const payload = lobbyUpdates[0]?.[1];
    // Flag OFF: byte-identical full trimmed snapshot, no `seq`/`type` envelope.
    expect(payload).toEqual(serializeGame(game));
    expect(payload).not.toHaveProperty("seq");
    expect(payload).not.toHaveProperty("type");
    expect(serverOnlyData.get(ROOM_ID)?.broadcastVersion).toBeUndefined();
    // Recorded through Strain_Telemetry; cleanup still runs after the emit.
    expect(recordSpy).toHaveBeenCalled();
    expect(cleanupGame).toHaveBeenCalledWith(
      ROOM_ID,
      games,
      serverOnlyData,
      serverOnlyBotData,
    );
  });
});
