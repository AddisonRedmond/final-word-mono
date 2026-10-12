import { describe, expect, it, vi } from "vitest";

// `battle-royale.ts` transitively imports `db` (via stats). `checkWord` /
// `calculateMatchObj` don't touch it, but the import graph does, so mock `db`
// to a no-op surface before importing the module under test.
vi.mock("db", () => ({
	db: {},
}));

const { checkWord } = await import("./battle-royale.js");

// Regression coverage for the keyboard match sets `checkWord` returns.
//
// `fullMatches` (greens, by index) feeds both the keyboard and the attack
// index-bleed; `partialMatches` (yellows) and `noMatch` (greys) drive keyboard
// colouring. The bug: `noMatch` was derived while iterating the WORD, pushing a
// guessed letter only when the word letter sharing its index was absent from
// the guess — so a guessed letter genuinely absent from the word could fall
// through and never be greyed (e.g. the `A` in FRAME against FILED). Greys are
// now computed per guessed letter against the whole word.
describe("checkWord keyboard match sets", () => {
	it("greys every guessed letter absent from the word (FRAME vs FILED)", () => {
		const { fullMatches, partialMatches, noMatch } = checkWord(
			"FRAME",
			"FILED",
		);

		// F is correctly placed at index 0.
		expect(fullMatches[0]).toBe("F");
		// E is in FILED but not at index 3 → yellow.
		expect(partialMatches).toContain("E");
		// R, A, M are not in FILED at all → every one must be grey (the bug left A
		// uncoloured).
		expect(noMatch).toContain("R");
		expect(noMatch).toContain("A");
		expect(noMatch).toContain("M");
	});

	it("greys only the truly-absent letter (MAGIC vs CIGAR)", () => {
		// Target CIGAR, guess MAGIC: M absent; A/I/C present; G correct at index 2.
		const { fullMatches, noMatch } = checkWord("MAGIC", "CIGAR");

		expect(fullMatches[2]).toBe("G");
		expect(noMatch).toEqual(["M"]);
	});

	it("keeps a duplicate letter yellow while a copy is unplaced (ALPES vs APPLE)", () => {
		// Guessing ALPES against APPLE (A·L·P·E·S vs A·P·P·L·E): A and the P at
		// index 2 land green; the still-unplaced P at word index 1 surfaces as a
		// partial so the keyboard can keep P yellow while a copy is unfound.
		const { fullMatches, partialMatches } = checkWord("ALPES", "APPLE");

		expect(fullMatches[0]).toBe("A");
		expect(fullMatches[2]).toBe("P");
		expect(partialMatches).toContain("P");
	});

	it("flags an exact guess as a match with every letter green", () => {
		const { isMatch, fullMatches, noMatch, partialMatches } = checkWord(
			"APPLE",
			"APPLE",
		);

		expect(isMatch).toBe(true);
		expect(Object.values(fullMatches)).toEqual(["A", "P", "P", "L", "E"]);
		expect(noMatch).toEqual([]);
		expect(partialMatches).toEqual([]);
	});
});
