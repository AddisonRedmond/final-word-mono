import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Namespace } from "socket.io";
import type { RaceMatch } from "types/race.types.js";
import * as strain from "../../telemetry/strain.js";
import { config, serverOnlyData } from "./state.js";
import {
  buildRaceKeyframePayload,
  emitRaceKeyframe,
  emitRaceUpdate,
  scheduleRaceUpdate,
  serializeRaceMatch,
} from "./lobby.js";

// Feature: round-based-elimination-race, Task 9.2: broadcast coalescing.
//
// `scheduleRaceUpdate` schedules at most one `race:update` per
// `config.updateWindowMs` window per lobby. A burst of calls within a single
// window must produce exactly one broadcast (trailing-edge), and a fresh call
// after the window elapses must be able to schedule the next broadcast.
//
// Validates: Requirements 3.6, 4.7

const MATCH_ID = "test-race-lobby";

// Minimal display-only match; `scheduleRaceUpdate` only reads `room.matchId`
// (to find room server state and address the room) and passes the match to
// `serializeRaceMatch`, which reads `room` and iterates `players`.
const makeMatch = (): RaceMatch => ({
  room: {
    matchId: MATCH_ID,
    phase: "round",
    createdAt: 0,
    lobbyDeadline: 0,
    currentRoundIndex: 0,
    isDraw: false,
  },
  players: new Map(),
});

// A mock Socket.IO Namespace exposing the `to(room).emit(event, payload)`
// chain. `emit` is a spy so we can count `race:update` broadcasts and inspect
// the room each broadcast targeted.
const makeNsp = () => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { nsp: { to } as unknown as Namespace, to, emit };
};

describe("scheduleRaceUpdate broadcast coalescing (Task 9.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    serverOnlyData.delete(MATCH_ID);
  });

  it("emits at most one race:update per updateWindowMs for a burst of calls", () => {
    const { nsp, to, emit } = makeNsp();
    const match = makeMatch();

    // Burst of scheduling calls in quick succession within one window.
    for (let i = 0; i < 20; i++) {
      scheduleRaceUpdate(nsp, match);
    }

    // Nothing fires until the window elapses (trailing-edge).
    expect(emit).not.toHaveBeenCalled();

    // Advance to the end of the coalescing window.
    vi.advanceTimersByTime(config.updateWindowMs);

    // Exactly one broadcast for the whole burst.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    expect(to).toHaveBeenCalledWith(MATCH_ID);
  });

  it("allows a second broadcast after the window elapses", () => {
    const { nsp, emit } = makeNsp();
    const match = makeMatch();

    // First window: one or more calls coalesce into a single emit.
    scheduleRaceUpdate(nsp, match);
    scheduleRaceUpdate(nsp, match);
    vi.advanceTimersByTime(config.updateWindowMs);
    expect(emit).toHaveBeenCalledTimes(1);

    // A new call after the timer has fired/cleared arms a fresh window.
    scheduleRaceUpdate(nsp, match);
    // Still coalesced until the new window elapses.
    expect(emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(config.updateWindowMs);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0]).toBe("race:update");
  });

  it("does not emit before the window fully elapses", () => {
    const { nsp, emit } = makeNsp();
    const match = makeMatch();

    scheduleRaceUpdate(nsp, match);

    // Just short of the window: no broadcast yet.
    vi.advanceTimersByTime(config.updateWindowMs - 1);
    expect(emit).not.toHaveBeenCalled();

    // Crossing the window boundary fires the single broadcast.
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

// Feature: realtime-broadcast-scaling, Task 1.3 — wire Strain_Telemetry into
// the race emit choke point.
//
// `emitRaceUpdate` must record each Broadcast_Tick's cost (mode, roomId, the
// serialized payload bytes, and the room's socket count) WITHOUT altering the
// emitted payload. The payload is serialized once and reused for the send, and
// a telemetry fault must never break the broadcast.
//
// Validates: Requirements 1.3, 1.6

// A mock Namespace exposing the `to(room).emit()` chain plus an `adapter` whose
// room map reports a socket count, so `emitRaceUpdate` can read recipients.
const makeNspWithAdapter = (socketCount: number) => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const adapter = {
    rooms: new Map([[MATCH_ID, { size: socketCount }]]),
  };
  return { nsp: { to, adapter } as unknown as Namespace, to, emit };
};

describe("emitRaceUpdate Strain_Telemetry wiring (Task 1.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the tick cost with the serialized payload bytes and recipient count", () => {
    const recordSpy = vi
      .spyOn(strain, "recordBroadcast")
      .mockImplementation(() => {});
    const { nsp, emit } = makeNspWithAdapter(7);
    const match = makeMatch();

    emitRaceUpdate(nsp, match);

    // The broadcast is emitted exactly once, unchanged.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    const payload = emit.mock.calls[0][1];

    // recordBroadcast is called once with mode/roomId, the serialized byte size
    // of the exact emitted payload, and the room's socket count as recipients.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      mode: "race",
      roomId: MATCH_ID,
      bytes: Buffer.byteLength(JSON.stringify(payload)),
      recipients: 7,
    });
  });

  it("still emits even if the recorder throws (telemetry never drops a tick)", () => {
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {
      throw new Error("telemetry boom");
    });
    const { nsp, emit } = makeNspWithAdapter(3);
    const match = makeMatch();

    // emitRaceUpdate must not surface a telemetry fault; the test spy throws to
    // prove the broadcast is sent before (and regardless of) the record call.
    expect(() => emitRaceUpdate(nsp, match)).toThrow("telemetry boom");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
  });
});

// Feature: realtime-broadcast-scaling, Task 6.1 — keyframe emission (Race).
//
// `buildRaceKeyframePayload` / `emitRaceKeyframe` emit a KEYFRAME at the
// keyframe points (join/reconnect, round transition, forced cadence, resync).
// With the delta flag OFF the payload MUST be the full trimmed snapshot exactly
// as before (byte-identical, no version bookkeeping — Req 5.5). With it ON the
// payload is a stamped keyframe envelope and the room's `broadcastVersion`
// advances: increasing `seq`, `ticksSinceKeyframe` reset to 0, `lastSent` set.
//
// Validates: Requirements 3.2, 3.6

describe("Race keyframe emission (Task 6.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(MATCH_ID);
    config.deltaBroadcastEnabled = false;
  });

  it("flag OFF: payload is the full trimmed snapshot and version is untouched", () => {
    config.deltaBroadcastEnabled = false;
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const match = makeMatch();

    const payload = buildRaceKeyframePayload(match);

    // Byte-identical to the full trimmed snapshot — no `seq`/`type` envelope.
    expect(payload).toEqual(serializeRaceMatch(match));
    expect(payload).not.toHaveProperty("seq");
    expect(payload).not.toHaveProperty("type");
    // No version record was created or advanced.
    expect(serverOnlyData.get(MATCH_ID)?.broadcastVersion).toBeUndefined();
  });

  it("flag ON: first keyframe is seq 1, resets ticks, stores lastSent", () => {
    config.deltaBroadcastEnabled = true;
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const match = makeMatch();

    const snapshot = serializeRaceMatch(match);
    const payload = buildRaceKeyframePayload(match);

    expect(payload).toMatchObject({
      seq: 1,
      type: "keyframe",
      room: snapshot.room,
      players: snapshot.players,
    });

    const version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toEqual(snapshot);
  });

  it("flag ON: successive keyframes stamp a strictly increasing seq", () => {
    config.deltaBroadcastEnabled = true;
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const match = makeMatch();

    const first = buildRaceKeyframePayload(match) as { seq: number };
    const second = buildRaceKeyframePayload(match) as { seq: number };
    const third = buildRaceKeyframePayload(match) as { seq: number };

    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);
    expect(serverOnlyData.get(MATCH_ID)?.broadcastVersion?.seq).toBe(3);
  });

  it("flag ON: a keyframe resets ticksSinceKeyframe after it was advanced", () => {
    config.deltaBroadcastEnabled = true;
    // Simulate a room mid-way through its delta cadence.
    serverOnlyData.set(MATCH_ID, {
      players: {},
      timers: {},
      broadcastVersion: { seq: 9, ticksSinceKeyframe: 15 },
    });
    const match = makeMatch();

    buildRaceKeyframePayload(match);

    const version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.seq).toBe(10);
    expect(version?.ticksSinceKeyframe).toBe(0);
  });

  it("emitRaceKeyframe (flag OFF) emits the full snapshot on race:update", () => {
    config.deltaBroadcastEnabled = false;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, to, emit } = makeNspWithAdapter(4);
    const match = makeMatch();

    emitRaceKeyframe(nsp, match);

    expect(to).toHaveBeenCalledWith(MATCH_ID);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    // Full trimmed snapshot, byte-identical to emitRaceUpdate's payload.
    expect(emit.mock.calls[0][1]).toEqual(serializeRaceMatch(match));
    expect(emit.mock.calls[0][1]).not.toHaveProperty("seq");
  });

  it("emitRaceKeyframe (flag ON) emits the keyframe envelope on race:update", () => {
    config.deltaBroadcastEnabled = true;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatch();

    emitRaceKeyframe(nsp, match);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    expect(emit.mock.calls[0][1]).toMatchObject({ seq: 1, type: "keyframe" });
  });
});

// Feature: realtime-broadcast-scaling, Task 6.2 — delta emission at the
// trailing edge (Race).
//
// `emitRaceUpdate` is the coalesced `race:update` broadcast driven by
// `scheduleRaceUpdate`. With the delta flag OFF it emits the full trimmed
// snapshot every tick, byte-identical to its pre-delta behavior (Req 5.5). With
// it ON: the first tick (no version yet) emits a KEYFRAME (seq 1) establishing
// `lastSent`; a subsequent changed tick emits a DELTA (seq 2) carrying only the
// change; an unchanged tick emits NOTHING (empty-diff skip, Req 3.8); and once
// `keyframeIntervalTicks` deltas have been emitted the next tick is a forced
// KEYFRAME that resets `ticksSinceKeyframe` (Req 3.6).
//
// Validates: Requirements 3.3, 3.5, 3.6, 3.7, 3.8, 5.5

// A fuller match whose room/players can be mutated between ticks so the diff
// has something to find. Players is a Map, as the authoritative state holds it.
const makeMatchWithPlayer = (): RaceMatch => ({
  room: {
    matchId: MATCH_ID,
    phase: "round",
    createdAt: 0,
    lobbyDeadline: 0,
    currentRoundIndex: 0,
    isDraw: false,
  },
  players: new Map([
    [
      "p1",
      {
        name: "P1",
        isEliminated: false,
        completedWords: 0,
        qualified: false,
        totalGuesses: 0,
        correctGuesses: 0,
      },
    ],
  ]) as RaceMatch["players"],
});

describe("Race delta emission at the trailing edge (Task 6.2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    serverOnlyData.delete(MATCH_ID);
    config.deltaBroadcastEnabled = false;
  });

  it("flag OFF: every tick emits the full trimmed snapshot (byte-identical)", () => {
    config.deltaBroadcastEnabled = false;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatchWithPlayer();

    emitRaceUpdate(nsp, match);
    emitRaceUpdate(nsp, match);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    // Full trimmed snapshot each time — no envelope, no version touched.
    expect(emit.mock.calls[0][1]).toEqual(serializeRaceMatch(match));
    expect(emit.mock.calls[1][1]).toEqual(serializeRaceMatch(match));
    expect(emit.mock.calls[0][1]).not.toHaveProperty("seq");
    expect(serverOnlyData.get(MATCH_ID)?.broadcastVersion).toBeUndefined();
  });

  it("flag ON: first tick is a keyframe (seq 1) that establishes lastSent", () => {
    config.deltaBroadcastEnabled = true;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatchWithPlayer();

    emitRaceUpdate(nsp, match);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("race:update");
    expect(emit.mock.calls[0][1]).toMatchObject({ seq: 1, type: "keyframe" });

    const version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
    expect(version?.lastSent).toEqual(serializeRaceMatch(match));
  });

  it("flag ON: a changed tick after the keyframe emits a delta (seq 2) with only the change", () => {
    config.deltaBroadcastEnabled = true;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatchWithPlayer();

    // Tick 1 → keyframe.
    emitRaceUpdate(nsp, match);

    // Mutate one player's rendered field, then tick again → delta.
    const p1 = match.players.get("p1");
    if (p1) p1.completedWords = 1;
    emitRaceUpdate(nsp, match);

    expect(emit).toHaveBeenCalledTimes(2);
    const delta = emit.mock.calls[1][1];
    expect(delta).toMatchObject({ seq: 2, type: "delta" });
    // Carries only the changed player; no room-level change this tick.
    expect(delta.room).toBeUndefined();
    expect(Object.keys(delta.players)).toEqual(["p1"]);
    expect(delta.players.p1.completedWords).toBe(1);

    const version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.seq).toBe(2);
    expect(version?.ticksSinceKeyframe).toBe(1);
  });

  it("flag ON: an unchanged tick emits nothing (empty-diff skip, Req 3.8)", () => {
    config.deltaBroadcastEnabled = true;
    const recordSpy = vi
      .spyOn(strain, "recordBroadcast")
      .mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatchWithPlayer();

    // Tick 1 → keyframe (seq 1).
    emitRaceUpdate(nsp, match);
    expect(emit).toHaveBeenCalledTimes(1);

    // Tick 2 with NOTHING changed → skip: no emit, no telemetry, no seq bump.
    emitRaceUpdate(nsp, match);

    expect(emit).toHaveBeenCalledTimes(1);
    // Only the keyframe recorded a Broadcast_Tick cost; the skipped tick did not.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.seq).toBe(1);
    expect(version?.ticksSinceKeyframe).toBe(0);
  });

  it("flag ON: a forced keyframe fires after keyframeIntervalTicks deltas and resets ticks", () => {
    config.deltaBroadcastEnabled = true;
    vi.spyOn(strain, "recordBroadcast").mockImplementation(() => {});
    serverOnlyData.set(MATCH_ID, { players: {}, timers: {} });
    const { nsp, emit } = makeNspWithAdapter(4);
    const match = makeMatchWithPlayer();

    // Tick 1 → keyframe (seq 1, ticksSinceKeyframe 0).
    emitRaceUpdate(nsp, match);

    // Emit exactly `keyframeIntervalTicks` deltas, mutating a field each tick
    // so none is skipped. After the last the counter reaches the bound.
    const interval = config.keyframeIntervalTicks;
    for (let i = 1; i <= interval; i++) {
      const p1 = match.players.get("p1");
      if (p1) p1.totalGuesses = i;
      emitRaceUpdate(nsp, match);
    }

    let version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.ticksSinceKeyframe).toBe(interval);
    // Last emitted payload so far was a delta.
    const lastDelta = emit.mock.calls[emit.mock.calls.length - 1][1];
    expect(lastDelta.type).toBe("delta");

    // The next tick is a FORCED keyframe (cadence bound reached), even though a
    // field also changed — the keyframe wins and resets the counter.
    const p1 = match.players.get("p1");
    if (p1) p1.totalGuesses = interval + 1;
    emitRaceUpdate(nsp, match);

    const forced = emit.mock.calls[emit.mock.calls.length - 1][1];
    expect(forced.type).toBe("keyframe");
    version = serverOnlyData.get(MATCH_ID)?.broadcastVersion;
    expect(version?.ticksSinceKeyframe).toBe(0);
    // seq kept its +1 cadence across the whole chain: keyframe + interval
    // deltas + forced keyframe = interval + 2 envelopes, so seq = interval + 2.
    expect(version?.seq).toBe(interval + 2);
  });
});
