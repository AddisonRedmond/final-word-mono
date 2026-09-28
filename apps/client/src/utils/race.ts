import { WORDS_BY_LENGTH } from "@/shared/words";

// Race client-side guess validation, mirroring Battle Royale's
// `utils/battle-royale.ts` `isValidGuess`. Battle Royale is fixed at 5-letter
// words, so it hardcodes the length and a single 5-letter dictionary; Race has
// per-round word lengths (4/5/6), so validation is length-aware and checks the
// matching shared per-length list — the same vocabulary the server draws target
// words from (`shared/words`), so a word the client accepts is one the server
// could have assigned.

/** Case-insensitive, trimmed, upper-cased form used for dictionary lookups. */
const normalizeGuess = (word: string): string => word.trim().toUpperCase();

// Build a lookup Set per length once, from the shared per-length lists, so
// validation is O(1) rather than scanning the array on every keystroke/submit.
const wordSetsByLength: Record<number, Set<string>> = Object.fromEntries(
	Object.entries(WORDS_BY_LENGTH).map(([length, words]) => [
		Number(length),
		new Set(words.map((word) => word.toUpperCase())),
	]),
);

/**
 * Whether `word` is a legal guess for a round of the given `length`: it must be
 * exactly `length` letters (A–Z only) AND appear in the shared dictionary for
 * that length. Falls back to a length/charset-only check if no dictionary is
 * configured for the length (should not happen for Race's 4/5/6 lengths).
 *
 * Parallels Battle Royale's `isValidGuess`, which does the same length + regex
 * + dictionary check for its single 5-letter list.
 */
export const isValidGuess = (word: string, length: number): boolean => {
	const normalized = normalizeGuess(word);

	if (normalized.length !== length || !/^[A-Z]+$/.test(normalized)) {
		return false;
	}

	const dictionary = wordSetsByLength[length];
	if (!dictionary) {
		// No list for this length: accept any correctly-shaped word rather than
		// blocking play (the server still grades against its assigned word).
		return true;
	}

	return dictionary.has(normalized);
};
