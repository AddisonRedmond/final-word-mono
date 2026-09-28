import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { gradeGuess } from "./round.js";

// Feature: round-based-elimination-race, Property 2: Grading feedback is consistent with the target
//
// For any target word and any guess of equal length, `gradeGuess` returns
// per-letter feedback whose length equals the word length, and `isMatch` is
// true if and only if the guess equals the target; when `isMatch` is true every
// letter's state is `correct`. Grading is treated as a parser-like transform:
// a guess equal to the target always grades as a full match, and vice versa.
//
// Validates: Requirements 4.3

describe("gradeGuess feedback consistency (Property 2)", () => {
  it("feedback length matches, isMatch iff equal, and a match is all-correct", () => {
    // Generate a target word and an equal-length guess. We draw a shared word
    // length first, then two words of exactly that length. A single-char
    // alphabet keeps collisions (and thus full matches) frequent so the
    // isMatch branch is exercised, while a wider alphabet stresses the mixed
    // correct/present/absent cases.
    const wordPairArb = fc
      .integer({ min: 1, max: 12 })
      .chain((length) => {
        const charArb = fc.constantFrom(..."abcde".split(""));
        const wordArb = fc
          .array(charArb, { minLength: length, maxLength: length })
          .map((chars) => chars.join(""));
        return fc.tuple(wordArb, wordArb);
      });

    fc.assert(
      fc.property(wordPairArb, ([target, guess]) => {
        const { isMatch, perLetter } = gradeGuess(guess, target);

        // Feedback has exactly one entry per guess position (== word length).
        expect(perLetter).toHaveLength(target.length);
        expect(guess.length).toBe(target.length);

        // isMatch is true iff the guess equals the target exactly.
        expect(isMatch).toBe(guess === target);

        // Each entry reports its own position and the guessed letter there.
        for (let i = 0; i < perLetter.length; i++) {
          expect(perLetter[i]?.index).toBe(i);
          expect(perLetter[i]?.letter).toBe(guess[i]);
        }

        // When it's a match, every letter must be "correct".
        if (isMatch) {
          for (const fb of perLetter) {
            expect(fb.state).toBe("correct");
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
