import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RacePlayer } from "types/race.types.js";
import { type RankedSurvivor, rankSurvivors } from "./round.js";

// Feature: round-based-elimination-race, Property 5: Survivor ranking is a total order over the tie-break policy
//
// For any set of round survivors, `rankSurvivors` returns a permutation of its
// input ordered so that every qualified survivor precedes every non-qualified
// survivor; qualified survivors are ordered by earliest `qualifiedAt` first;
// and non-qualified survivors are ordered by highest `completedWords` first,
// then fewest `roundGuesses`. The ordering is transitive and stable for exact
// ties (equal sort keys retain input order).
//
// Validates: Requirements 5.1, 5.2, 5.3

// A minimal RacePlayer whose only meaningful fields are those the ranking
// reads. The remaining fields are fixed placeholders so we exercise the sort
// keys in isolation.
const makePlayer = (fields: {
  qualified: boolean;
  qualifiedAt?: number;
  completedWords: number;
  roundGuesses: number;
}): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: fields.completedWords,
  qualified: fields.qualified,
  qualifiedAt: fields.qualifiedAt,
  roundGuesses: fields.roundGuesses,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

const qualifiedAtOf = (p: RacePlayer): number =>
  p.qualifiedAt ?? Number.POSITIVE_INFINITY;

describe("rankSurvivors total order (Property 5)", () => {
  // Generator: survivors with varied qualified/qualifiedAt/completedWords/
  // roundGuesses and unique ids. Small numeric ranges keep ties (and thus the
  // ordering-among-equals branches) frequent. `qualifiedAt` is sometimes
  // omitted, including for qualified survivors, to exercise the
  // "missing sorts last" path.
  const survivorsArb = fc
    .array(
      fc.record({
        qualified: fc.boolean(),
        qualifiedAt: fc.option(fc.integer({ min: 0, max: 5 }), {
          nil: undefined,
        }),
        completedWords: fc.integer({ min: 0, max: 5 }),
        roundGuesses: fc.integer({ min: 0, max: 5 }),
      }),
      { minLength: 0, maxLength: 12 },
    )
    .map((records) =>
      records.map(
        (r, i): RankedSurvivor => [`id-${i}`, makePlayer(r)] as const,
      ),
    );

  it("output is a permutation ordered by the tie-break policy", () => {
    fc.assert(
      fc.property(survivorsArb, (survivors) => {
        const ranked = rankSurvivors(survivors);

        // (1) Permutation: same multiset of ids (unique here, so same set +
        // same length is enough).
        expect(ranked).toHaveLength(survivors.length);
        const inputIds = survivors.map(([id]) => id).sort();
        const outputIds = ranked.map(([id]) => id).sort();
        expect(outputIds).toEqual(inputIds);

        // (2) No non-qualified survivor precedes a qualified one: once we see
        // a non-qualified entry, everything after must also be non-qualified.
        let seenNonQualified = false;
        for (const [, p] of ranked) {
          if (!p.qualified) {
            seenNonQualified = true;
          } else {
            expect(seenNonQualified).toBe(false);
          }
        }

        // Pairwise-adjacent checks over the total order.
        for (let i = 0; i + 1 < ranked.length; i++) {
          const a = ranked[i]?.[1] as RacePlayer;
          const b = ranked[i + 1]?.[1] as RacePlayer;

          if (a.qualified && b.qualified) {
            // (3) Qualified: non-decreasing by qualifiedAt (missing last).
            expect(qualifiedAtOf(a)).toBeLessThanOrEqual(qualifiedAtOf(b));
          } else if (!a.qualified && !b.qualified) {
            // (4) Non-qualified: completedWords desc, then roundGuesses asc.
            if (a.completedWords === b.completedWords) {
              expect(a.roundGuesses).toBeLessThanOrEqual(b.roundGuesses);
            } else {
              expect(a.completedWords).toBeGreaterThan(b.completedWords);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is stable for exact ties: equal sort keys retain input order", () => {
    // All entries share identical sort keys (same qualified flag, same
    // qualifiedAt, same completedWords, same roundGuesses) but carry unique,
    // ascending ids reflecting their input position. A stable sort must return
    // them in their original relative order.
    const tiedArb = fc
      .record({
        qualified: fc.boolean(),
        qualifiedAt: fc.option(fc.integer({ min: 0, max: 5 }), {
          nil: undefined,
        }),
        completedWords: fc.integer({ min: 0, max: 5 }),
        roundGuesses: fc.integer({ min: 0, max: 5 }),
        count: fc.integer({ min: 0, max: 12 }),
      })
      .map(({ count, ...key }) =>
        Array.from(
          { length: count },
          (_, i): RankedSurvivor => [`id-${i}`, makePlayer(key)] as const,
        ),
      );

    fc.assert(
      fc.property(tiedArb, (survivors) => {
        const ranked = rankSurvivors(survivors);
        // Input order is id-0, id-1, ...; a stable sort preserves it exactly.
        expect(ranked.map(([id]) => id)).toEqual(survivors.map(([id]) => id));
      }),
      { numRuns: 100 },
    );
  });
});
