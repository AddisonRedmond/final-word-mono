import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import type { Game, PlayerDisplay, Room } from "types/battle-royale.types.js";

// Feature: realtime-broadcast-scaling, Task 6.1 — keyframe emission (Battle
// Royale), FLAG-ON path.
//
// `DELTA_BROADCAST_ENABLED` is a module constant (not a mutable config object
// like Race's), so to exercise the flag-ON branch we mock the state module to
// flip it on while keeping its real `serverOnlyData` map and other exports.
// With the flag on the keyframe helpers emit a stamped keyframe envelope and
// advance the room's `broadcastVersion`: increasing `seq`, `ticksSinceKeyframe`
// reset to 0, `lastSent` set.
//
// Validates: Requirements 3.2, 3.6

vi.mock("./state.js", async () => {
  const actual =
    await vi.importActual<typeof import("./state.js")>("./state.js");
  return { ...actual, DELTA_BROADCAST_ENABLED: true };
});

// Imported AFTER the mock is registered so the flag-on module is used.
const { buildBattleRoyaleKeyframePayload, emitBattleRoyaleKeyframe } =
  await import("./lobby.js");
const strain = await import("../../telemetry/strain.js");
const { serverOnlyData } = await import("./state.js");

const ROOM_ID = "test-br-keyframe-on";

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

describe("Battle Royale keyframe emission, flag ON (Task 6.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(ROOM_ID);
  });

  it("first keyframe is seq 1, resets ticks, stores lastSent", () => {
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const game = makeGame();

    const payload = buildBattleRoyaleKeyframePayload(ROOM_ID, game) as {
      seq: number;
      type: string;
    };

    expect(payload.seq).toBe(1);
    expect(payload.type).toBe("keyframe");

    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toBeDefined();
  });

  it("successive keyframes stamp a strictly increasing seq", () => {
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const game = makeGame();

    const a = buildBattleRoyaleKeyframePayload(ROOM_ID, game) as { seq: number };
    const b = buildBattleRoyaleKeyframePayload(ROOM_ID, game) as { seq: number };
    const c = buildBattleRoyaleKeyframePayload(ROOM_ID, game) as { seq: number };

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
  });

  it("a keyframe resets ticksSinceKeyframe after it was advanced", () => {
    serverOnlyData.set(ROOM_ID, {
      playerData: {},
      timers: {},
      broadcastVersion: { seq: 4, ticksSinceKeyframe: 11 },
    });
    const game = makeGame();

    buildBattleRoyaleKeyframePayload(ROOM_ID, game);

    const version = serverOnlyData.get(ROOM_ID)?.broadcastVersion;
    expect(version?.seq).toBe(5);
    expect(version?.ticksSinceKeyframe).toBe(0);
  });

  it("emitBattleRoyaleKeyframe emits the keyframe envelope on lobby:update", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(ROOM_ID, { playerData: {}, timers: {} });
    const { io, emit } = makeIo(3);
    const game = makeGame();

    emitBattleRoyaleKeyframe(io, ROOM_ID, game);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("lobby:update");
    expect(emit.mock.calls[0][1]).toMatchObject({ seq: 1, type: "keyframe" });
  });
});
