// bonus life (ms) awarded for guessing the active word correctly, keyed by
// how many attempts it took (capped at the 10-guess tier)
export const lifeMap = {
  1: 60 * 1000,
  2: 60 * 1000,
  3: 45 * 1000,
  4: 45 * 1000,
  5: 30 * 1000,
  6: 30 * 1000,
  7: 15 * 1000,
  8: 15 * 1000,
  9: 10 * 1000,
  10: 10 * 1000,
} as const;

// flat bonus (ms) awarded for correctly guessing an incoming attack word
export const ATTACK_WORD_BONUS_MS = 10 * 1000;

// hard cap (ms) on how long a match can run before a winner is picked by score
export const MATCH_TIME_LIMIT_MS = 10 * 60 * 1000;

export const getGuessBonusMs = (currentWordGuesses: number) => {
  const guessCount = Math.min(
    Math.max(currentWordGuesses, 1),
    10,
  ) as keyof typeof lifeMap;

  return lifeMap[guessCount];
};
