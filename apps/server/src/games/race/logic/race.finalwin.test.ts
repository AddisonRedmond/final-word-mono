import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import { type RoundLifecycleDeps, handleFinalRoundWin } from "./race.js";

// Feature: round-based-elimination-race, Task 7.9: first-correct-guess win in
// the Final_Round.
//
// In the Final_Round the fastest correct guess wins (Req 6.2): "WHEN a Survivor
// submits the first correct guess of the Final_Round word, THE Race_Server SHALL
// declare that Survivor the winner and finish the Match." The guess handler
// calls `handleFinalRoundWin` the moment a correct guess arrives. Because
// `finishMatch` is idempotent, a LATER correct guess (a second call with a
// different guesser id) is a no-op — the EARLIEST correct guesser stays the
// winner. This test drives ordered submissions and asserts the first guesser
// wins, is placement 1, the phase is `finished`, and `match:result` broadcasts
// the first guesser as the winner. All side effects (stats persistence,
// cleanup) are injected as spies so no DB/timer is touched.
//
// Validates: Requirements 6.2

const config: RaceConfig = {
  rounds: [
    { timerMs: 60_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0.5 },
    { timerMs: 60_000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 8,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  qualifiedAt: undefined,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
  ...fields,
});

// A Match sitting in the Final_Round (the last configured round) with the given
// survivors. currentRoundIndex points at the last round so the field is the
// Final_Round survivor set.
const makeFinalRoundMatch = (players: Map<string, RacePlayer>): RaceMatch => {
  const now = Date.now();
  return {
    room: {
      matchId: randomUUID(),
      phase: "round",
      createdAt: now,
      lobbyDeadline: now,
      currentRoundIndex: config.rounds.length - 1,
      isDraw: false,
    },
    players,
  };
};

// A mock Socket.IO Namespace exposing the `to(room).emit(event, payload)`
// chain, with `emit` a spy so the `match:result` broadcast can be inspected.
const makeNsp = () => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { nsp: { to } as unknown as Namespace, to, emit };
};

// Deps with no real side effects: persistRaceStats/cleanupMatch are spies and
// serverOnlyData is empty so no timers are looked up.
const makeDeps = (): {
  deps: RoundLifecycleDeps;
  persistRaceStats: ReturnType<typeof vi.fn>;
  cleanupMatch: ReturnType<typeof vi.fn>;
} => {
  const persistRaceStats = vi.fn(async () => {});
  const cleanupMatch = vi.fn();
  return {
    deps: {
      serverOnlyData: new Map(),
      persistRaceStats,
      cleanupMatch,
    },
    persistRaceStats,
    cleanupMatch,
  };
};

const resultCalls = (emit: ReturnType<typeof vi.fn>) =>
  emit.mock.calls.filter((c) => c[0] === "match:result");

describe("Final_Round first-correct-guess win (Req 6.2)", () => {
  it("the earliest correct guesser wins; a later correct guess is a no-op", () => {
    // Several Final_Round survivors submit correct guesses in order:
    // first -> second -> third. The handler is called once per submission in
    // arrival order (the guess handler fires it the moment a correct guess
    // lands).
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();
    const players = new Map<string, RacePlayer>([
      [first, makePlayer({ name: "first" })],
      [second, makePlayer({ name: "second" })],
      [third, makePlayer({ name: "third" })],
    ]);
    const match = makeFinalRoundMatch(players);
    const { nsp, to, emit } = makeNsp();
    const { deps, persistRaceStats, cleanupMatch } = makeDeps();

    // Ordered submissions: the FIRST correct guesser triggers the win.
    handleFinalRoundWin(match, nsp, config, first, deps);
    // Later correct guessers arrive after the Match has already finished — each
    // is a no-op because finishMatch is idempotent.
    handleFinalRoundWin(match, nsp, config, second, deps);
    handleFinalRoundWin(match, nsp, config, third, deps);

    // The earliest correct guesser is the winner (Req 6.2) — NOT overwritten by
    // the later submissions.
    expect(match.room.phase).toBe("finished");
    expect(match.room.winnerId).toBe(first);
    expect(match.room.isDraw).toBe(false);

    // Winner is placement 1; the later guessers are ranked behind (Req 6.3).
    expect(players.get(first)?.placement).toBe(1);
    expect(players.get(second)?.placement).not.toBe(1);
    expect(players.get(third)?.placement).not.toBe(1);

    // Exactly one match:result broadcast, carrying the FIRST guesser, to the
    // match's lobby (Req 6.6). The later no-op calls don't re-broadcast.
    const calls = resultCalls(emit);
    expect(calls).toHaveLength(1);
    expect(to).toHaveBeenCalledWith(match.room.matchId);
    const payload = calls[0]?.[1] as {
      winnerId?: string;
      placements: { playerId: string; placement: number }[];
    };
    expect(payload.winnerId).toBe(first);
    expect(payload.placements).toEqual(
      expect.arrayContaining([{ playerId: first, placement: 1 }]),
    );

    // Persist + cleanup handed off exactly once (the later calls are no-ops).
    expect(persistRaceStats).toHaveBeenCalledTimes(1);
    expect(persistRaceStats).toHaveBeenCalledWith(match);
    expect(cleanupMatch).toHaveBeenCalledTimes(1);
    expect(cleanupMatch).toHaveBeenCalledWith(match.room.matchId);
  });

  it("winner is the first guesser even when a later guesser has more progress", () => {
    // A later guesser looking "stronger" (more completed words) must NOT
    // dislodge the earliest correct guesser: order of correct guess is the sole
    // decider in the Final_Round (Req 6.2).
    const first = randomUUID();
    const strongerButLater = randomUUID();
    const players = new Map<string, RacePlayer>([
      [first, makePlayer({ name: "first", completedWords: 0 })],
      [strongerButLater, makePlayer({ name: "later", completedWords: 3 })],
    ]);
    const match = makeFinalRoundMatch(players);
    const { nsp, emit } = makeNsp();
    const { deps } = makeDeps();

    handleFinalRoundWin(match, nsp, config, first, deps);
    handleFinalRoundWin(match, nsp, config, strongerButLater, deps);

    expect(match.room.winnerId).toBe(first);
    expect(players.get(first)?.placement).toBe(1);

    const calls = resultCalls(emit);
    expect(calls).toHaveLength(1);
    const payload = calls[0]?.[1] as { winnerId?: string };
    expect(payload.winnerId).toBe(first);
  });
});
