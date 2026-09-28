import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Namespace } from "socket.io";
import type { RaceMatch } from "types/race.types.js";
import { config, serverOnlyData } from "./state.js";
import { scheduleRaceUpdate } from "./lobby.js";

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
