import { describe, expect, it } from "vitest";
import {
	calculateKeyboardMatches,
	type KeyboardMatches,
	mergeKeyboardMatches,
} from "./round.js";

describe("keyboard duplicate-letter rule", () => {
	it("keeps P yellow for APPLE when only one P is placed (ALPES)", () => {
		const empty: KeyboardMatches = {
			revealedLetters: {},
			partialMatches: [],
			noMatch: [],
		};
		const raw = calculateKeyboardMatches("APPLE", "ALPES");
		const merged = mergeKeyboardMatches("APPLE", empty, raw);

		// P is revealed at index 2 but a second P (index 1) is still unfound, so it
		// must stay a partial (yellow) hint even though a copy is green.
		expect(merged.revealedLetters[2]).toBe("P");
		expect(merged.partialMatches).toContain("P");
	});

	it("drops P from partials once BOTH Ps are placed", () => {
		const empty: KeyboardMatches = {
			revealedLetters: {},
			partialMatches: [],
			noMatch: [],
		};
		// AMPLE places P at index 2 only; then APPLE itself places both Ps.
		const first = mergeKeyboardMatches(
			"APPLE",
			empty,
			calculateKeyboardMatches("APPLE", "AMPLE"),
		);
		expect(first.partialMatches).toContain("P"); // one P still unfound

		const second = mergeKeyboardMatches(
			"APPLE",
			first,
			calculateKeyboardMatches("APPLE", "APPLE"),
		);
		// Both Ps revealed → no longer partial.
		expect(second.revealedLetters[1]).toBe("P");
		expect(second.revealedLetters[2]).toBe("P");
		expect(second.partialMatches).not.toContain("P");
	});
});

describe("keyboard greys every guessed letter absent from the target", () => {
	const empty: KeyboardMatches = {
		revealedLetters: {},
		partialMatches: [],
		noMatch: [],
	};

	// Regression: a guessed letter that is absent from the target must be greyed
	// even when the target letter sharing its index appears elsewhere in the
	// guess. The old target-iterating `noMatch` logic missed these, so a guess
	// like FRAME against FILED left letters uncoloured, while FILED happened to
	// colour correctly. Greying is now computed per guessed letter.
	it("greys A/R/M for FRAME vs FILED and colours the rest", () => {
		const merged = mergeKeyboardMatches(
			"FILED",
			empty,
			calculateKeyboardMatches("FILED", "FRAME"),
		);

		// F is placed correctly at index 0.
		expect(merged.revealedLetters[0]).toBe("F");
		// E is in FILED but not at index 3 → yellow.
		expect(merged.partialMatches).toContain("E");
		// R, A, M are not in FILED at all → every one must be grey (the bug left A
		// uncoloured).
		expect(merged.noMatch).toContain("R");
		expect(merged.noMatch).toContain("A");
		expect(merged.noMatch).toContain("M");
	});

	it("greys a letter absent from the target even when it sits where a present letter belongs", () => {
		// Target CIGAR, guess MAGIC: every pressed key must be bucketed.
		//   M → absent (grey)
		//   A → present in CIGAR (yellow)
		//   G → correct at index 2 (green)
		//   I → present in CIGAR (yellow)
		//   C → present in CIGAR (yellow)
		const merged = mergeKeyboardMatches(
			"CIGAR",
			empty,
			calculateKeyboardMatches("CIGAR", "MAGIC"),
		);

		expect(merged.revealedLetters[2]).toBe("G");
		expect(merged.noMatch).toContain("M");
		// No guessed letter is left without a classification: M is the only letter
		// not in the target, so it is the only grey.
		expect(merged.noMatch).toEqual(["M"]);
	});
});
