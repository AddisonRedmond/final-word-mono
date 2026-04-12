/**
 * Pure game engine functions for the Wordle-style battle royale.
 */

type LetterFeedback = "correct" | "present" | "absent";

/**
 * Computes per-letter feedback for a guess against a secret word.
 *
 * Algorithm:
 * 1. First pass: mark letters at the correct position as "correct"
 * 2. Second pass: for remaining letters, mark as "present" if the letter
 *    appears in the secret at a different position and hasn't already been
 *    accounted for by a correct or earlier present match; otherwise "absent"
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */
export function computeFeedback(
  guess: string,
  secret: string
): Array<LetterFeedback> {
  const result: LetterFeedback[] = new Array(5).fill("absent");

  // Track which secret positions are still available for "present" matching
  const secretAvailable: boolean[] = new Array(5).fill(true);

  // First pass: mark correct positions
  for (let i = 0; i < 5; i++) {
    if (guess[i] === secret[i]) {
      result[i] = "correct";
      secretAvailable[i] = false;
    }
  }

  // Second pass: mark present/absent for non-correct positions
  for (let i = 0; i < 5; i++) {
    if (result[i] === "correct") continue;

    // Look for this letter in an unaccounted secret position
    const matchIndex = secret
      .split("")
      .findIndex((ch, j) => ch === guess[i] && secretAvailable[j]);

    if (matchIndex !== -1) {
      result[i] = "present";
      secretAvailable[matchIndex] = false;
    }
  }

  return result;
}

/**
 * Randomly assigns a word from wordList to each playerId.
 * Each player gets an independently random word (duplicates allowed).
 *
 * Requirements: 1.1, 1.2, 1.4
 */
export function assignWords(
  playerIds: string[],
  wordList: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const id of playerIds) {
    result[id] = wordList[Math.floor(Math.random() * wordList.length)]!;
  }
  return result;
}

/**
 * Returns an array of position indices (0-4) that are "revealed" in an attack word,
 * based on how many guesses the attacker used:
 *   1-2 guesses → 3 revealed positions
 *   3-4 guesses → 2 revealed positions
 *   5-6 guesses → 1 revealed position
 *
 * Requirements: 13.5, 13.6
 */
export function computeRevealedPositions(
  word: string,
  guessCount: number
): number[] {
  let revealCount: number;
  if (guessCount <= 2) {
    revealCount = 3;
  } else if (guessCount <= 4) {
    revealCount = 2;
  } else {
    revealCount = 1;
  }

  // Fisher-Yates shuffle on [0,1,2,3,4] then take first revealCount
  const positions = [0, 1, 2, 3, 4];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j]!, positions[i]!];
  }
  return positions.slice(0, revealCount).sort((a, b) => a - b);
}

/**
 * Represents a single attack entry in the attack queue.
 */
export type AttackEntry = { word: string; revealedPositions: number[] };

/**
 * A queue of attack entries (max 4 before overflow behaviour kicks in).
 */
export type AttackQueue = AttackEntry[];

/**
 * Dispatches an attack from an attacker to a target's queue.
 *
 * - Computes revealedPositions via computeRevealedPositions.
 * - If queue.length < 4: appends the new entry.
 * - If queue.length >= 4 (overflow): decrements revealedPositions count by 1
 *   (minimum 0), replaces the oldest entry (index 0) with the new entry.
 *
 * Requirements: 14.1, 14.2, 14.3
 */
export function dispatchAttack(
  attackerGuessCount: number,
  word: string,
  queue: AttackQueue
): { revealedPositions: number[]; updatedQueue: AttackQueue } {
  let revealedPositions = computeRevealedPositions(word, attackerGuessCount);

  if (queue.length < 4) {
    const updatedQueue: AttackQueue = [...queue, { word, revealedPositions }];
    return { revealedPositions, updatedQueue };
  }

  // Overflow: decrement revealed count by 1 (minimum 0)
  const decremented = Math.max(0, revealedPositions.length - 1);
  revealedPositions = revealedPositions.slice(0, decremented);

  // Shift out oldest (index 0), push new entry
  const updatedQueue: AttackQueue = [
    ...queue.slice(1),
    { word, revealedPositions },
  ];
  return { revealedPositions, updatedQueue };
}

/**
 * Decrements health by deltaMs, clamped to [0, 180_000].
 *
 * Requirements: 4.2, 12.2
 */
export function applyHealthTick(healthMs: number, deltaMs: number): number {
  return Math.min(180_000, Math.max(0, healthMs - deltaMs));
}

/**
 * Adds 30_000 ms bonus for solving a word, capped at 180_000.
 *
 * Requirements: 4.3, 12.5
 */
export function applyWordSolvedBonus(healthMs: number): number {
  return Math.min(180_000, healthMs + 30_000);
}

/**
 * Subtracts 15_000 ms penalty for a failed guess, floored at 0.
 *
 * Requirements: 4.2, 12.4
 */
export function applyFailurePenalty(healthMs: number): number {
  return Math.max(0, healthMs - 15_000);
}
