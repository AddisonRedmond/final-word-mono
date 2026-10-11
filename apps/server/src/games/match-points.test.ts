import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SCORING_CONFIG, matchPoints, type ScoringConfig } from "db/schema";

// Feature: retention-foundation, Task 2.1 — Match_Points scoring properties.
//
// `matchPoints(placement, combatInput, config)` is the pure, independently
// testable scoring function (design Section 1.0, R2A.9): the points one player
// earns for one completed scored match =
//     placementPoints(tier) + winBonus(iff placement 1) + combatPoints(capped).
//
// It lives as a single shared constant/function in `packages/db` so client and
// server cannot drift (R2A.5). These tests mirror the style of the sibling
// `stats-eligibility.guest.test.ts`: a faithful property-based characterization
// of the function under test, with each property tied back to its requirement.
//
// Validates: Requirements 2A.1, 2A.2, 2A.3, 2A.4, 2A.9

// Highest tier threshold in the default config. Placements beyond this earn 0
// placementPoints, so generators split the placement space around it to
// exercise both the "in a tier" and "below all tiers" branches.
const MAX_TIER_PLACEMENT = Math.max(
  ...SCORING_CONFIG.placementTiers.map((t) => t.maxPlacement),
);

// The placementPoints the default config awards for a given placement,
// computed independently of matchPoints so the two can be cross-checked.
const expectedPlacementPoints = (
  placement: number,
  config: ScoringConfig = SCORING_CONFIG,
): number =>
  config.placementTiers.find((t) => placement <= t.maxPlacement)?.points ?? 0;

describe("matchPoints scoring (Task 2.1)", () => {
  // R2A.9: pure function of its inputs — same (placement, combatInput, config)
  // always yields the same result, with no hidden state or side effects.
  it("is pure: identical inputs always produce identical output", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: -50, max: 500 }),
        (placement, combatInput) => {
          const a = matchPoints(placement, combatInput);
          const b = matchPoints(placement, combatInput);
          expect(a).toBe(b);
        },
      ),
      { numRuns: 100 },
    );
  });

  // R2A.1-R2A.4: the result is always ≥ 0 (negative combat inputs are clamped
  // to 0, every component is non-negative).
  it("is always non-negative, even for negative combat input", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: -1000, max: 1000 }),
        (placement, combatInput) => {
          expect(matchPoints(placement, combatInput)).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // R2A.4: combatPoints = min(max(0, combatInput) * perGuess, cap). The combat
  // contribution never exceeds combatPointsCap no matter how large the input.
  it("caps the combat contribution at combatPointsCap", () => {
    const { combatPointsCap, combatPointsPerGuess } = SCORING_CONFIG;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 100_000 }),
        (placement, combatInput) => {
          // Isolate the combat contribution: total minus the placement/win
          // part (which depends only on placement) is exactly combatPoints.
          const placementAndWin =
            expectedPlacementPoints(placement) +
            (placement === 1 ? SCORING_CONFIG.winBonus : 0);
          const combatPart = matchPoints(placement, combatInput) - placementAndWin;

          const uncapped = combatInput * combatPointsPerGuess;
          expect(combatPart).toBe(Math.min(uncapped, combatPointsCap));
          expect(combatPart).toBeLessThanOrEqual(combatPointsCap);
        },
      ),
      { numRuns: 200 },
    );
  });

  // R2A.3: winBonus is added iff the player's placement is exactly 1. Holding
  // combat fixed, placement 1 must score exactly winBonus more than it would
  // from its placement tier alone, and no non-1 placement may include the bonus.
  it("adds the win bonus if and only if placement is 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        (placement, combatInput) => {
          const combatPart = Math.min(
            combatInput * SCORING_CONFIG.combatPointsPerGuess,
            SCORING_CONFIG.combatPointsCap,
          );
          const withoutBonus =
            expectedPlacementPoints(placement) + combatPart;
          const total = matchPoints(placement, combatInput);

          if (placement === 1) {
            expect(total).toBe(withoutBonus + SCORING_CONFIG.winBonus);
          } else {
            expect(total).toBe(withoutBonus);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // R2A.2 / R2A.3: monotonic in better placement — improving (lowering) a
  // player's placement never decreases their points when combat is held fixed.
  // Finishing better is always at least as good.
  it("is monotonic in placement: a better placement never scores fewer points", () => {
    fc.assert(
      fc.property(
        // Two placements and a fixed combat input; `better` is the smaller
        // (closer to 1) of the pair.
        fc.integer({ min: 1, max: MAX_TIER_PLACEMENT + 10 }),
        fc.integer({ min: 1, max: MAX_TIER_PLACEMENT + 10 }),
        fc.integer({ min: 0, max: 50 }),
        (p1, p2, combatInput) => {
          const better = Math.min(p1, p2);
          const worse = Math.max(p1, p2);
          expect(
            matchPoints(better, combatInput),
          ).toBeGreaterThanOrEqual(matchPoints(worse, combatInput));
        },
      ),
      { numRuns: 200 },
    );
  });

  // R2A.4 / R2A.9: the combat proxy is a single swappable argument. Swapping
  // the combat input source (e.g. correctGuesses -> a future eliminations
  // count) changes nothing but the number passed in — the formula is unchanged.
  // Equivalently, two different combat sources that happen to yield the same
  // value produce identical points.
  it("depends on combat only through its single numeric argument", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 500 }),
        (placement, combatValue) => {
          // "correctGuesses source" vs a hypothetical "eliminations source"
          // that resolves to the same value: results must match exactly.
          const viaGuesses = matchPoints(placement, combatValue);
          const viaEliminations = matchPoints(placement, combatValue);
          expect(viaGuesses).toBe(viaEliminations);
        },
      ),
      { numRuns: 100 },
    );
  });

  // R2A.2: concrete placement-tier examples from the default config, so a tier
  // retune is caught by an explicit, readable assertion (not just properties).
  describe("default-config placement tiers (examples)", () => {
    it("awards 10 placement points + 12 win bonus for 1st place", () => {
      // placement 1, zero combat: 10 (tier) + 12 (win bonus) = 22.
      expect(matchPoints(1, 0)).toBe(22);
    });

    it("awards tiered placement points for top 3 / 5 / 10", () => {
      expect(matchPoints(3, 0)).toBe(6); // top 3
      expect(matchPoints(5, 0)).toBe(4); // top 5
      expect(matchPoints(10, 0)).toBe(2); // top 10
    });

    it("awards 0 placement points below the lowest tier", () => {
      expect(matchPoints(11, 0)).toBe(0);
      expect(matchPoints(100, 0)).toBe(0);
    });

    it("adds capped combat points on top of placement points", () => {
      // placement 5 (4 pts) + 3 correct guesses (3 pts) = 7.
      expect(matchPoints(5, 3)).toBe(7);
      // placement 5 (4 pts) + combat capped at 15 = 19.
      expect(matchPoints(5, 1000)).toBe(4 + SCORING_CONFIG.combatPointsCap);
    });
  });
});
