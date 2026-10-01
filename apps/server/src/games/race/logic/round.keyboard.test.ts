import { describe, expect, it } from "vitest";
import {
  calculateKeyboardMatches,
  mergeKeyboardMatches,
  type KeyboardMatches,
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
