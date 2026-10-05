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

// --- §5.2a Cancelable deep queue --------------------------------------------
// Batch grace window (ms) before a wave of incoming attack words "cements" into
// the defender's real solve queue. Armed when the pending set goes empty ->
// non-empty and NOT reset by later attacks joining the same wave; on expiry the
// whole pending wave cements together. See ATTACK_MECHANICS.md §5.2a.
export const ATTACK_PENDING_MS = 15 * 1000;

// Hard cap on how many CEMENTED attack words a player can be carrying. Pending
// (uncemented) words do not count against this; only words that have cemented
// into the real solve cycle do. Raised from the old flat 3 now that the queue
// is a cancelable buffer rather than guaranteed one-way damage.
export const MAX_CEMENTED_ATTACK_WORDS = 5;

// --- Time-scaled starting hints ---------------------------------------------
// How many letters of a player's OWN (non-attack) word are pre-revealed when it
// first appears, decaying as the match goes on so the early game is gentler and
// the late game is pure skill/speed. Keyed by match elapsed time. Attack words
// are unaffected (they carry their own attacker-speed reveal).
//
//   0:00-2:00 -> 2 letters
//   2:00-4:00 -> 1 letter
//   4:00+     -> 0 letters
//
// Tune freely; thresholds are inclusive lower-bound, exclusive upper-bound.
export const STARTING_HINT_TIERS: ReadonlyArray<{
  untilMs: number;
  letters: number;
}> = [
  { untilMs: 2 * 60 * 1000, letters: 2 },
  { untilMs: 4 * 60 * 1000, letters: 1 },
];

/**
 * Number of letters to pre-reveal on a freshly-assigned non-attack word, based
 * on how long the match has been running. Falls through to 0 once past the last
 * tier. See STARTING_HINT_TIERS.
 */
export const getStartingHintCount = (matchElapsedMs: number): number => {
  for (const tier of STARTING_HINT_TIERS) {
    if (matchElapsedMs < tier.untilMs) {
      return tier.letters;
    }
  }
  return 0;
};

/**
 * Solve-scaled clearing: how many PENDING attack words a correct solve of the
 * player's current word removes, keyed by how many guesses it took. Earliest
 * (closest-to-cementing) pending words are removed first. `Infinity` means
 * "wipe the entire pending wave". Cemented words are never affected.
 *
 *   <= 2 guesses -> all pending
 *   3-4 guesses  -> 2
 *   >= 5 guesses -> 1
 *
 * See ATTACK_MECHANICS.md §5.2a.
 */
export const getPendingClearCount = (currentWordGuesses: number): number => {
  if (currentWordGuesses <= 2) {
    return Number.POSITIVE_INFINITY;
  }
  if (currentWordGuesses <= 4) {
    return 2;
  }
  return 1;
};

export const getGuessBonusMs = (currentWordGuesses: number): number => {
  const guessCount = Math.min(
    Math.max(currentWordGuesses, 1),
    MAX_BONUS_GUESS_TIER,
  ) as keyof typeof lifeMap;

  return lifeMap[guessCount] ?? MIN_GUESS_BONUS_MS;
};
