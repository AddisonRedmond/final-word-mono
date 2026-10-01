import { WORDS_BY_LENGTH } from "shared/words.js";

// Race_Mode word source. Reuses the shared per-length word lists (relocated
// from the client) so there is a single source of truth for the 4/5/6-letter
// vocabularies. Unlike Battle Royale, there are no attack-word bonus lists.

/**
 * Select a uniformly-random word of the requested length from the shared
 * per-length list. Falls back to a length-appropriate placeholder if no list
 * is configured for that length (should not happen for validated Race_Config
 * word lengths of 4, 5, or 6).
 */
export const getRandomWord = (length: number): string => {
  const list = WORDS_BY_LENGTH[length];

  if (!list || list.length === 0) {
    return "?".repeat(length);
  }

  const randomIndex = Math.floor(Math.random() * list.length);

  return list[randomIndex] ?? "?".repeat(length);
};
