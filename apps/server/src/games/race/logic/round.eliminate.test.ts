import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { eliminationCount } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import { type RankedSurvivor, selectEliminated } from "./round.js";

// Feature: round-based-elimination-race, Property 6: Elimination count follows the configured percentage with ceil rounding
//
// For any survivor count `n` and any `eliminationPct` `p` in (0, 1], the number
// eliminated equals `min(n - 1, max(1, ceil(n * p)))` when `n > 1` and `0` when
// `n <= 1`; the eliminated players are exactly the lowest-ranked suffix of
// `rankSurvivors`.
//
// Validates: Requirements 5.4

// The expected elimination count, mirroring the specification directly so the
// property checks the implementation against the formula rather than itself.
const expectedCount = (n: number, p: number): number =>
  n <= 1 ? 0 : Math.min(n - 1, Math.max(1, Math.ceil(n * p)));

// A percentage strictly greater than 0 and at most 1. fast-check's float
// generator can produce values arbitrarily close to 0, so we filter out any
// non-positive draw to stay within the (0, 1] domain the property covers.
const pctArb = fc
  .float({ min: 0, max: 1, noNaN: true, minExcluded: true })
  .filter((p) => p > 0 && p <= 1);

// A minimal RacePlayer; ranking-relevant fields are irrelevant here because we
// generate the ranked array in its final order directly.
const makePlayer = (name: string): RacePlayer => ({
  name,
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

describe("elimination count and suffix selection (Property 6)", () => {
  it("Test A: eliminationCount follows the configured percentage with ceil rounding", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), pctArb, (n, p) => {
        expect(eliminationCount(n, p)).toBe(expectedCount(n, p));
      }),
      { numRuns: 100 },
    );
  });

  it("Test B: selectEliminated returns exactly the lowest-ranked suffix", () => {
    // A ranked array of unique-id [id, player] entries, already in best-first
    // order (as rankSurvivors would return). Unique ids let us compare the
    // returned suffix by identity and order.
    const rankedArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 0,
        maxLength: 100,
      })
      .map((ids): RankedSurvivor[] =>
        ids.map((id) => [id, makePlayer(id)] as const),
      );

    fc.assert(
      fc.property(rankedArb, pctArb, (ranked, p) => {
        const count = eliminationCount(ranked.length, p);
        const eliminated = selectEliminated(ranked, p);

        // The eliminated ids are exactly the last `count` ids of the ranked
        // array, in the same order.
        const expectedIds = ranked
          .slice(ranked.length - count)
          .map(([id]) => id);
        expect(eliminated).toEqual(expectedIds);
        expect(eliminated).toHaveLength(count);
      }),
      { numRuns: 100 },
    );
  });
});
