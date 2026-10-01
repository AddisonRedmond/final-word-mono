import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyGuess, type GuessApplicationInput } from "./round.js";

// Feature: round-based-elimination-race, Property 4: Qualification progression is monotonic and latches once
//
// For any survivor below the round's Qualifying_Count, a correct guess
// increments `completedWords` by exactly one and assigns a new word whose
// length equals the configured round length; and the first time
// `completedWords` reaches the Qualifying_Count, `qualified` becomes true and
// `qualifiedAt` is set exactly once and never changes on subsequent guesses
// that round.
//
// A "correct guess" is forced by passing the guess equal to the survivor's
// currently assigned `word` (applyGuess grades the guess against player.word),
// and by feeding each result's freshly-assigned `word` back in as the next
// guess so the simulated sequence stays a chain of matches.
//
// Validates: Requirements 4.4, 4.5

/** A fresh, non-eliminated survivor at the start of a round with the given word. */
const freshSurvivor = (word: string): GuessApplicationInput => ({
  completedWords: 0,
  qualified: false,
  qualifiedAt: undefined,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
  isEliminated: false,
  word,
});

describe("applyGuess qualification progression (Property 4)", () => {
  it("a single correct guess below the count increments completedWords by one and assigns a same-length word", () => {
    const arb = fc.record({
      wordLength: fc.constantFrom(4, 5, 6),
      qualifyingCount: fc.integer({ min: 2, max: 8 }),
      // completedWords strictly below the qualifying count so this correct
      // guess is pure progression (does not itself reach the count).
      completedWords: fc.integer({ min: 0, max: 6 }),
      roundGuesses: fc.integer({ min: 0, max: 20 }),
      totalGuesses: fc.integer({ min: 0, max: 100 }),
      correctGuesses: fc.integer({ min: 0, max: 100 }),
      now: fc.integer({ min: 0, max: 1_000_000 }),
    });

    fc.assert(
      fc.property(arb, (s) => {
        // Keep completedWords strictly below qualifyingCount for this case.
        const completedWords = Math.min(s.completedWords, s.qualifyingCount - 1);
        const word = "a".repeat(s.wordLength);
        const player: GuessApplicationInput = {
          ...freshSurvivor(word),
          completedWords,
          roundGuesses: s.roundGuesses,
          totalGuesses: s.totalGuesses,
          correctGuesses: s.correctGuesses,
        };

        // Correct guess == the assigned word.
        const result = applyGuess(
          player,
          word,
          s.qualifyingCount,
          s.wordLength,
          s.now,
        );

        expect(result.accepted).toBe(true);
        expect(result.isMatch).toBe(true);
        // completedWords increments by exactly one.
        expect(result.completedWords).toBe(completedWords + 1);
        expect(result.correctGuesses).toBe(s.correctGuesses + 1);
        expect(result.roundGuesses).toBe(s.roundGuesses + 1);
        expect(result.totalGuesses).toBe(s.totalGuesses + 1);
        // A new word of the configured round length is assigned.
        expect(result.word).toHaveLength(s.wordLength);
      }),
      { numRuns: 100 },
    );
  });

  it("qualification latches true exactly at the qualifying count, sets qualifiedAt once, and never changes it afterward", () => {
    const arb = fc.record({
      wordLength: fc.constantFrom(4, 5, 6),
      qualifyingCount: fc.integer({ min: 1, max: 6 }),
      // Extra correct guesses to attempt after reaching the count, to prove
      // qualifiedAt latches once and does not move.
      extraGuesses: fc.integer({ min: 0, max: 5 }),
      qualifyTime: fc.integer({ min: 1, max: 1_000_000 }),
    });

    fc.assert(
      fc.property(arb, (s) => {
        let player: GuessApplicationInput = freshSurvivor(
          "a".repeat(s.wordLength),
        );

        let latchedAt: number | undefined;
        let sawQualifiedTransition = false;

        const totalGuesses = s.qualifyingCount + s.extraGuesses;

        for (let i = 0; i < totalGuesses; i++) {
          // Was the player qualified *before* this guess? Used to detect the
          // single latching transition.
          const wasQualified = player.qualified;
          const prevQualifiedAt = player.qualifiedAt;

          // Distinct, increasing timestamps so any spurious re-assignment of
          // qualifiedAt on a later guess would be observable.
          const now = s.qualifyTime + i;

          // Force a correct guess: guess equals the currently assigned word.
          const result = applyGuess(
            player,
            player.word,
            s.qualifyingCount,
            s.wordLength,
            now,
          );

          expect(result.accepted).toBe(true);
          expect(result.isMatch).toBe(true);

          // completedWords is monotonic and never exceeds the qualifying count
          // (progression stops advancing completedWords once qualified).
          expect(result.completedWords).toBeGreaterThanOrEqual(
            player.completedWords,
          );
          expect(result.completedWords).toBeLessThanOrEqual(s.qualifyingCount);

          if (!wasQualified && result.qualified) {
            // The single latching transition: qualifiedAt is set to `now`.
            expect(sawQualifiedTransition).toBe(false);
            sawQualifiedTransition = true;
            latchedAt = now;
            expect(result.completedWords).toBe(s.qualifyingCount);
            expect(result.qualifiedAt).toBe(now);
          }

          if (wasQualified) {
            // Once qualified, qualifiedAt never changes on later guesses.
            expect(result.qualified).toBe(true);
            expect(result.qualifiedAt).toBe(prevQualifiedAt);
          }

          player = {
            ...player,
            completedWords: result.completedWords,
            qualified: result.qualified,
            qualifiedAt: result.qualifiedAt,
            roundGuesses: result.roundGuesses,
            totalGuesses: result.totalGuesses,
            correctGuesses: result.correctGuesses,
            word: result.word,
          };
        }

        // The player qualifies exactly once, at the first time completedWords
        // reaches the qualifying count, and qualifiedAt stays put thereafter.
        expect(player.qualified).toBe(true);
        expect(sawQualifiedTransition).toBe(true);
        expect(player.qualifiedAt).toBe(latchedAt);
        expect(player.completedWords).toBe(s.qualifyingCount);
      }),
      { numRuns: 100 },
    );
  });
});
