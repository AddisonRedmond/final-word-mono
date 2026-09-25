// bonus life (ms) awarded for guessing the active word correctly, keyed by
// how many attempts it took. Guess counts beyond the highest tier fall back to
// the lowest bonus (see MAX_BONUS_GUESS_TIER / MIN_GUESS_BONUS_MS below).
export const lifeMap = {
  1: 60 * 1000,
  2: 60 * 1000,
  3: 45 * 1000,
  4: 45 * 1000,
  5: 30 * 1000,
  6: 30 * 1000,
  7: 15 * 1000,
  8: 15 * 1000,
} as const;

// highest guess-count tier defined in lifeMap; anything above this clamps to it
export const MAX_BONUS_GUESS_TIER = 8;

// smallest bonus in lifeMap, used as a fallback so the function never returns
// undefined for out-of-range guess counts
export const MIN_GUESS_BONUS_MS = lifeMap[MAX_BONUS_GUESS_TIER];

// flat bonus (ms) awarded for correctly guessing an incoming attack word
export const ATTACK_WORD_BONUS_MS = 10 * 1000;

// hard cap (ms) on how long a match can run before a winner is picked by score
export const MATCH_TIME_LIMIT_MS = 10 * 60 * 1000;

export const getGuessBonusMs = (currentWordGuesses: number): number => {
  const guessCount = Math.min(
    Math.max(currentWordGuesses, 1),
    MAX_BONUS_GUESS_TIER,
  ) as keyof typeof lifeMap;

  return lifeMap[guessCount] ?? MIN_GUESS_BONUS_MS;
};
