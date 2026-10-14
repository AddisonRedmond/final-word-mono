import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import type { Game, PlayerDisplay, Room } from "types/battle-royale.types.js";

// Feature: realtime-broadcast-scaling, Task 6.2 — delta emission at the
// trailing edge (Battle Royale), FLAG-ON path.
//
// `DELTA_BROADCAST_ENABLED` is a module constant (not a mutable config object
// like Race's), so to exercise the flag-ON branch we mock the state module to
// flip it on while keeping its real `serverOnlyData` map, `KEYFRAME_INTERVAL_TICKS`,
// and other exports. With the flag on `emitLobbyUpdate` — the coalesced
// `lobby:update` broadcast driven by `scheduleLobbyUpdate` — emits a KEYFRAME on
// the first tick (seq 1, establishing `lastSent`), a DELTA on a subsequent
// changed tick (seq 2, carrying only the change), NOTHING on an unchanged tick
// (empty-diff skip, Req 3.8), and a FORCED keyframe once `KEYFRAME_INTERVAL_TICKS`
// deltas have been emitted (Req 3.6).
//
// Validates: Requirements 3.3, 3.5, 3.6, 3.7, 3.8, 5.5

vi.mock("./state.js", async () => {
  const actual =
    await vi.importActual<typeof import("./state.js")>("./state.js");
  return { ...actual, DELTA_BROADCAST_ENABLED: true };
});

// Imported AFTER the mock is registered so the flag-on module is used.
const { emitLobbyUpdate, serializeGame } = await import("./lobby.js");
const strain = await import("../../telemetry/strain.js");
const { serverOnlyData, KEYFRAME_INTERVAL_TICKS } = await import("./state.js");

const ROOM_ID = "test-br-delta-on";

const makePlayer = (id: string): PlayerDisplay => ({
  name: id,
  revealed_letters: {},
  partialMatches: [],
  noMatch: [],
  display_queue: [],
  isEliminated: false,
  life: 3,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
});

const makeRoom = (): Room => ({
  lobbyId: ROOM_ID,
  startTime: 0,
  isStarted: true,
  isFinished: false,
  isDraw: false,
});

const makeGame = (): Game => ({
  room: makeRoom(),
  players: new Map<string, PlayerDisplay>([["p1", makePlayer("p1")]]),
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
  return { io, to, emit };
};

describe("Battle Royale delta emission at the trailing edge, flag ON (Task 6.2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("first tick is a keyframe (seq 1) that establishes lastSent", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");
    expect(emit.mock.calls[0][1]).toMatchObject({ seq: 1, type: "keyframe" });

    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toEqual(serializeGame(game));
  });

  it("a changed tick after the keyframe emits a delta (seq 2) with only the change", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game); // keyframe

    const p1 = game.players.get("p1");
    if (p1) p1.life = 2;
    emitLobbyUpdate(io, ROOM_ID, game); // delta

    expect(emit).toHaveBeenCalledTimes(2);
    const delta = emit.mock.calls[1][1];
    expect(delta).toMatchObject({ seq: 2, type: "delta" });
    expect(delta.room).toBeUndefined();
    expect(Object.keys(delta.players)).toEqual(["p1"]);
    expect(delta.players.p1.life).toBe(2);

    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(2);
    expect(version?.ticksSinceKeyframe).toBe(1);
  });

  it("an unchanged tick emits nothing (empty-diff skip, Req 3.8)", () => {
    const recordSpy = vi
      .spyOn(strain, "recordBroadcast")
      .mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game); // keyframe
    expect(emit).toHaveBeenCalledTimes(1);

    emitLobbyUpdate(io, ROOM_ID, game); // nothing changed → skip

    expect(emit).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
  });

  it("a forced keyframe fires after KEYFRAME_INTERVAL_TICKS deltas and resets ticks", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game); // keyframe (seq 1)

    for (let i = 1; i <= KEYFRAME_INTERVAL_TICKS; i++) {
      const p1 = game.players.get("p1");
      if (p1) p1.totalGuesses = i;
      emitLobbyUpdate(io, ROOM_ID, game); // delta each tick
    }

    let version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.ticksSinceKeyframe).toBe(KEYFRAME_INTERVAL_TICKS);
    const lastDelta = emit.mock.calls[emit.mock.calls.length - 1][1];
    expect(lastDelta.type).toBe("delta");

    // Next tick is a forced keyframe (cadence bound reached) and resets ticks.
    const p1 = game.players.get("p1");
    if (p1) p1.totalGuesses = KEYFRAME_INTERVAL_TICKS + 1;
    emitLobbyUpdate(io, ROOM_ID, game);

    const forced = emit.mock.calls[emit.mock.calls.length - 1][1];
    expect(forced.type).toBe("keyframe");
    version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.seq).toBe(KEYFRAME_INTERVAL_TICKS + 2);
  });
});
