import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyGuess, type GuessApplicationInput } from "./round.js";

// Feature: round-based-elimination-race, Property 3: Wrong-length and eliminated-player guesses are rejected without side effects
//
// For any player state and any guess whose length does not equal the current
// round word length, and for any eliminated player and any guess, processing
// the guess leaves the player's roundGuesses, totalGuesses, completedWords, and
// assigned word unchanged (and the result is not accepted).
//
// Validates: Requirements 4.6, 4.8

// Arbitrary well-formed player state. Counts are kept in modest ranges; the
// exact magnitudes are irrelevant to rejection — only that they are preserved.
const playerArb = (
  overrides: Partial<Pick<GuessApplicationInput, "isEliminated">> = {},
): fc.Arbitrary<GuessApplicationInput> =>
  fc.record({
    completedWords: fc.integer({ min: 0, max: 20 }),
    qualified: fc.boolean(),
    qualifiedAt: fc.option(fc.integer({ min: 0, max: 1_000_000 }), {
      nil: undefined,
    }),
    roundGuesses: fc.integer({ min: 0, max: 50 }),
    totalGuesses: fc.integer({ min: 0, max: 200 }),
    correctGuesses: fc.integer({ min: 0, max: 50 }),
    isEliminated: fc.boolean(),
    // A concrete assigned word of arbitrary length.
    word: fc
      .integer({ min: 1, max: 12 })
      .chain((n) =>
        fc
          .array(fc.constantFrom(..."abcde".split("")), {
            minLength: n,
            maxLength: n,
          })
          .map((chars) => chars.join("")),
      ),
  }).map((p) => ({ ...p, ...overrides }));

// Assert the mutable, count-bearing fields plus the assigned word are all
// preserved and the guess was rejected.
const expectRejected = (
  player: GuessApplicationInput,
  result: ReturnType<typeof applyGuess>,
): void => {
  expect(result.accepted).toBe(false);
  expect(result.completedWords).toBe(player.completedWords);
  expect(result.roundGuesses).toBe(player.roundGuesses);
  expect(result.totalGuesses).toBe(player.totalGuesses);
  expect(result.word).toBe(player.word);
};

describe("applyGuess rejects without side effects (Property 3)", () => {
  it("(a) an eliminated player's guess is rejected regardless of guess length", () => {
    fc.assert(
      fc.property(
        playerArb({ isEliminated: true }),
        fc.string({ minLength: 0, maxLength: 15 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (player, guess, qualifyingCount, wordLength, now) => {
          const result = applyGuess(
            player,
            guess,
            qualifyingCount,
            wordLength,
            now,
          );
          expectRejected(player, result);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("(b) a non-eliminated player's wrong-length guess is rejected", () => {
    // Draw a wordLength then a guess whose length is guaranteed != wordLength.
    const scenarioArb = fc
      .integer({ min: 1, max: 12 })
      .chain((wordLength) => {
        const wrongLengthArb = fc
          .integer({ min: 0, max: 15 })
          .filter((len) => len !== wordLength);
        const guessArb = wrongLengthArb.chain((len) =>
          fc
            .array(fc.constantFrom(..."abcde".split("")), {
              minLength: len,
              maxLength: len,
            })
            .map((chars) => chars.join("")),
        );
        return fc.tuple(fc.constant(wordLength), guessArb);
      });

    fc.assert(
      fc.property(
        playerArb({ isEliminated: false }),
        scenarioArb,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (player, [wordLength, guess], qualifyingCount, now) => {
          // Guard: the guess length must differ from wordLength.
          expect(guess.length).not.toBe(wordLength);

          const result = applyGuess(
            player,
            guess,
            qualifyingCount,
            wordLength,
            now,
          );
          expectRejected(player, result);
        },
      ),
      { numRuns: 100 },
    );
  });
});
