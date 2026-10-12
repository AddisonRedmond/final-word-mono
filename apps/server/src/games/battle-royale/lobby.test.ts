import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import type { Game, PlayerDisplay, Room } from "types/battle-royale.types.js";
import * as strain from "../../telemetry/strain.js";
import {
  buildBattleRoyaleKeyframePayload,
  emitBattleRoyaleKeyframe,
  emitLobbyUpdate,
  scheduleLobbyUpdate,
  serializeGame,
} from "./lobby.js";
import { GAME_UPDATE_DELAY, serverOnlyData } from "./state.js";

// Feature: realtime-broadcast-scaling.
//
// Task 1.3 — wire Strain_Telemetry into the Battle Royale emit choke point:
// `emitLobbyUpdate` records each Broadcast_Tick's cost (mode, roomId, the
// serialized payload bytes, and the room's socket count) and `scheduleLobbyUpdate`
// keeps its trailing-edge coalescing. Validates: Requirements 1.3, 1.6.
//
// Task 3.2 — Battle Royale projection: `emitLobbyUpdate` now emits the TRIMMED
// `ClientGame` DTO produced by the single `serializeGame` projection (the same
// shape join:ack and every other lobby:update site use), not the raw
// `{ ...game, players: <record> }` spread. These tests assert against the
// trimmed projection. The exhaustive trim-shape assertions are task 3.3.
// Validates: Requirements 2.1, 2.3, 2.4, 2.6, 2.7.

const ROOM_ID = "test-br-lobby";

// A game whose `players` is a Map (as the authoritative state holds it) and
// whose room/players carry both keep-list UI_Fields and dropped Non_UI_Fields
// (`createdAt`, `endTimeStamp`, `statsPersisted`) so the trim is observable.
const makePlayer = (id: string): PlayerDisplay => ({
  name: id,
  isAnonymous: false,
  revealed_letters: {},
  partialMatches: [],
  noMatch: [],
  display_queue: [],
  isEliminated: false,
  life: 3,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
  // Dropped by the trim (Non_UI_Fields):
  endTimeStamp: 123,
  statsPersisted: true,
});

const makeRoom = (): Room => ({
  lobbyId: ROOM_ID,
  startTime: 0,
  isStarted: true,
  // Dropped by the trim (Non_UI_Field):
  createdAt: 42,
  isFinished: false,
  isDraw: false,
});

const makeGame = (): Game => ({
  room: makeRoom(),
  players: new Map<string, PlayerDisplay>([
    ["p1", makePlayer("p1")],
    ["p2", makePlayer("p2")],
  ]),
});

// A mock Socket.IO Server exposing the `to(room).emit()` chain and the
// `sockets.adapter.rooms` map used to read the room's socket count.
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

describe("emitLobbyUpdate Strain_Telemetry wiring (Task 1.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the trimmed ClientGame projection on lobby:update", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    const { io, to, emit } = makeIo(2);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game);

    expect(to).toHaveBeenCalledWith(ROOM_ID);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");

    // The wire payload is the trimmed projection — the single `serializeGame`
    // projection every broadcast site now shares (Req 2.6, 2.7).
    expect(emit.mock.calls[0][1]).toEqual(serializeGame(game));

    // The trim drops the Non_UI_Fields from the authoritative state (Req 2.3).
    const payload = emit.mock.calls[0][1];
    expect(payload.room).not.toHaveProperty("createdAt");
    expect(payload.players.p1).not.toHaveProperty("endTimeStamp");
    expect(payload.players.p1).not.toHaveProperty("statsPersisted");

    // The projection never mutates the authoritative state (Req 2.4): the live
    // game keeps its players Map and its dropped fields.
    expect(game.players instanceof Map).toBe(true);
    expect(game.room.createdAt).toBe(42);
  });

  it("records the tick cost with serialized payload bytes and recipient count", () => {
    const recordSpy = vi
      .spyOn(strain, "recordBroadcast")
      .mockImplementation(() => {});
    const { io, emit } = makeIo(5);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game);

    const payload = emit.mock.calls[0][1];
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      mode: "battle-royale",
      roomId: ROOM_ID,
      bytes: Buffer.byteLength(JSON.stringify(payload)),
      recipients: 5,
    });
  });
});

describe("scheduleLobbyUpdate broadcast coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("emits at most one lobby:update per GAME_UPDATE_DELAY for a burst", () => {
    const { io, emit } = makeIo(2);
    const game = makeGame();

    for (let i = 0; i < 20; i++) {
      scheduleLobbyUpdate(io, ROOM_ID, game);
    }

    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GAME_UPDATE_DELAY);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");
  });
});

// Feature: realtime-broadcast-scaling, Task 6.1 — keyframe emission (Battle
// Royale), FLAG-OFF path.
//
// With `DELTA_BROADCAST_ENABLED` off (the default) the keyframe helpers MUST
// emit the full trimmed snapshot EXACTLY as before — byte-identical to
// `serializeGame`, no `seq`/`type` envelope, and no version bookkeeping (Req
// 5.5 / task 8.1). The flag-ON path (stamped envelope + advancing version) is
// covered in `lobby.keyframe-on.test.ts`, which mocks the flag module.
//
// Validates: Requirements 3.2, 5.5

describe("Battle Royale keyframe emission, flag OFF (Task 6.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("buildBattleRoyaleKeyframePayload returns the full snapshot, no version", () => {
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const game = makeGame();

    const payload = buildBattleRoyaleKeyframePayload(ROOM_ID, game);

    expect(payload).toEqual(serializeGame(game));
    expect(payload).not.toHaveProperty("seq");
    expect(payload).not.toHaveProperty("type");
    expect(serverOnlyData.get(ROOM_ID)?.broadcastVersion).toBeUndefined();
  });

  it("emitBattleRoyaleKeyframe emits the full snapshot on lobby:update", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, to, emit } = makeIo(3);
    const game = makeGame();

    emitBattleRoyaleKeyframe(io, ROOM_ID, game);

    expect(to).toHaveBeenCalledWith(ROOM_ID);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");
    expect(emit.mock.calls[0][1]).toEqual(serializeGame(game));
    expect(emit.mock.calls[0][1]).not.toHaveProperty("seq");
  });
});

// Feature: realtime-broadcast-scaling, Task 6.2 — delta emission at the
// trailing edge (Battle Royale), FLAG-OFF path.
//
// With `DELTA_BROADCAST_ENABLED` off (the default) every `lobby:update` tick
// emits the full trimmed snapshot EXACTLY as before — byte-identical to
// `serializeGame`, no `seq`/`type` envelope, and no version bookkeeping, even
// across repeated ticks with no change (Req 5.5). The flag-ON delta path
// (keyframe → delta → skip → forced keyframe) is covered in
// `lobby.delta-on.test.ts`, which mocks the flag module.
//
// Validates: Requirements 3.5, 5.5

describe("Battle Royale delta emission, flag OFF (Task 6.2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("every tick emits the full trimmed snapshot and never touches version state", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitLobbyUpdate(io, ROOM_ID, game);
    emitLobbyUpdate(io, ROOM_ID, game);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");
    expect(emit.mock.calls[0][1]).toEqual(serializeGame(game));
    expect(emit.mock.calls[1][1]).toEqual(serializeGame(game));
    expect(emit.mock.calls[0][1]).not.toHaveProperty("seq");
    expect(serverOnlyData.get(ROOM_ID)?.broadcastVersion).toBeUndefined();
  });
});
