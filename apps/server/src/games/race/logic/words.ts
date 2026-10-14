import { WORDS_BY_LENGTH } from "shared/words.js";

// Race_Mode SECRET word source. Draws from the shared per-length GUESS word
// lists (`words.ts`) — the curated answer pool — so secrets are fair, common
// words. Guess spell-checking is a separate concern handled client-side against
// the larger `spell-check-words.ts` lexicon. Unlike Battle Royale, there are no
// attack-word bonus lists.

/**
 * Select a uniformly-random SECRET word of the requested length from the shared
 * per-length guess-word list. Falls back to a length-appropriate placeholder if
 * no list is configured for that length (should not happen for validated
 * Race_Config word lengths of 4, 5, or 6).
 */
export const getRandomWord = (length: number): string => {
  const list = WORDS_BY_LENGTH[length];

  if (!list || list.length === 0) {
    return "?".repeat(length);
  }

  const randomIndex = Math.floor(Math.random() * list.length);

  return list[randomIndex] ?? "?".repeat(length);
};
