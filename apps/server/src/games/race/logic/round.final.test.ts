import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RacePlayer } from "types/race.types.js";
import { type RankedSurvivor, resolveFinalRound } from "./round.js";

// Feature: round-based-elimination-race, Property 9: Final-round resolution picks the leader or declares a draw, others ranked behind
//
// For any set of Final_Round survivors when the timer expires with no correct
// guess, the winner is the survivor with the highest `completedWords`, broken
// by fewest total guesses; when a winner exists, every other survivor receives
// a placement greater than 1 in ranking order behind the winner; and when no
// progress distinguishes a leader, the result is a draw with no winner.
//
// The implemented draw condition (round.ts) is precisely:
//   - there are no survivors, or
//   - the top-ranked survivor has zero `completedWords`, or
//   - the top two survivors are exactly tied on (completedWords, totalGuesses).
// The oracle below mirrors that condition exactly.
//
// Validates: Requirements 6.3, 6.4, 6.5

// A minimal RacePlayer whose only meaningful fields for final-round resolution
// are `completedWords` and `totalGuesses`. The rest are fixed placeholders so
// the sort keys are exercised in isolation.
const makePlayer = (fields: {
  completedWords: number;
  totalGuesses: number;
}): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: fields.completedWords,
  qualified: false,
  qualifiedAt: undefined,
  roundGuesses: 0,
  totalGuesses: fields.totalGuesses,
  correctGuesses: 0,
  correctLetters: 0,
});

describe("resolveFinalRound leader-or-draw (Property 9)", () => {
  // Survivors with varied completedWords/totalGuesses and unique ids. Small
  // numeric ranges keep ties (and thus the draw branches) frequent.
  const survivorsArb = fc
    .array(
      fc.record({
        completedWords: fc.integer({ min: 0, max: 4 }),
        totalGuesses: fc.integer({ min: 0, max: 6 }),
      }),
      { minLength: 0, maxLength: 10 },
    )
    .map((records) =>
      records.map(
        (r, i): RankedSurvivor => [`id-${i}`, makePlayer(r)] as const,
      ),
    );

  it("ranks survivors and picks the leader or declares a draw", () => {
    fc.assert(
      fc.property(survivorsArb, (survivors) => {
        const { winnerId, ranking } = resolveFinalRound(survivors);

        // (1) ranking is a permutation of the input ids.
        expect(ranking).toHaveLength(survivors.length);
        const inputIds = survivors.map(([id]) => id).sort();
        const outputIds = [...ranking].sort();
        expect(outputIds).toEqual(inputIds);

        // Build a lookup from id -> player to inspect sort keys in ranking.
        const byId = new Map(survivors);

        // (2) ranking ordered by completedWords desc then totalGuesses asc.
        //     For exact ties, stable order preserves the input's relative
        //     order (ids were assigned in ascending input position).
        for (let i = 0; i + 1 < ranking.length; i++) {
          const a = byId.get(ranking[i] as string) as RacePlayer;
          const b = byId.get(ranking[i + 1] as string) as RacePlayer;

          if (a.completedWords !== b.completedWords) {
            expect(a.completedWords).toBeGreaterThan(b.completedWords);
          } else if (a.totalGuesses !== b.totalGuesses) {
            expect(a.totalGuesses).toBeLessThan(b.totalGuesses);
          } else {
            // Exact tie: input order preserved (numeric id suffix ascending).
            const ai = Number((ranking[i] as string).slice("id-".length));
            const bi = Number((ranking[i + 1] as string).slice("id-".length));
            expect(ai).toBeLessThan(bi);
          }
        }

        // Oracle for the implemented draw condition.
        const leaderId = ranking[0];
        const runnerUpId = ranking[1];
        const leader =
          leaderId === undefined
            ? undefined
            : (byId.get(leaderId) as RacePlayer);
        const runnerUp =
          runnerUpId === undefined
            ? undefined
            : (byId.get(runnerUpId) as RacePlayer);

        const isDraw =
          leader === undefined ||
          leader.completedWords === 0 ||
          (runnerUp !== undefined &&
            runnerUp.completedWords === leader.completedWords &&
            runnerUp.totalGuesses === leader.totalGuesses);

        if (isDraw) {
          // (3) Draw: no winner.
          expect(winnerId).toBeUndefined();
        } else {
          // (4) Winner exists: it is ranking[0] and every other survivor is
          //     placed behind it (placement > 1).
          expect(winnerId).toBeDefined();
          expect(winnerId).toBe(ranking[0]);

          const winner = byId.get(winnerId as string) as RacePlayer;
          // Highest completedWords overall.
          const maxCompleted = Math.max(
            ...survivors.map(([, p]) => p.completedWords),
          );
          expect(winner.completedWords).toBe(maxCompleted);
          // Fewest totalGuesses among the survivors sharing the max.
          const minGuessesAtMax = Math.min(
            ...survivors
              .filter(([, p]) => p.completedWords === maxCompleted)
              .map(([, p]) => p.totalGuesses),
          );
          expect(winner.totalGuesses).toBe(minGuessesAtMax);

          // Every other survivor has placement > 1 (index > 0 in ranking).
          for (let i = 1; i < ranking.length; i++) {
            expect(ranking[i]).not.toBe(winnerId);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
