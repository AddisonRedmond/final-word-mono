import { type RaceConfig, eliminationCount } from "shared/race.js";
import type { LetterFeedback, RacePlayer } from "types/race.types.js";
import { getRandomWord } from "./words.js";

// Pure Race_Mode round logic. No side effects: every function is a
// deterministic transform of its inputs (aside from assignWord, which draws a
// uniformly-random word from the shared per-length list). Race is a solo
// race-to-qualify with independent per-player words — there is no attack or
// targeting logic here.

/**
 * Draw a new target word of the requested length for a survivor at the start
 * of a round or after a correct guess.
 *
 * _Requirements: 4.1, 4.4_
 */
export const assignWord = (length: number): string => getRandomWord(length);

/**
 * Whether a guess is exactly the current round's word length. Wrong-length
 * guesses are rejected upstream without touching guess counts (Req 4.6).
 *
 * _Requirements: 4.6_
 */
export const isCorrectLength = (guess: string, length: number): boolean =>
  guess.length === length;

/** Result of grading a single guess against a survivor's assigned word. */
export type GradeResult = {
  /** True iff the guess exactly equals the target. */
  isMatch: boolean;
  /** Per-letter Wordle-style feedback, one entry per guess position. */
  perLetter: LetterFeedback[];
};

/**
 * Grade a guess against a target using the two-pass Wordle algorithm so that
 * repeated letters are handled correctly (mirrors `calculateMatchObj` in the
 * client's `utils/duel.ts`):
 *
 *   Pass 1 — lock every exact-position match as "correct" and consume that
 *            occurrence from the target's letter pool.
 *   Pass 2 — for each non-correct position, mark "present" if an unconsumed
 *            occurrence of that letter remains in the target, otherwise
 *            "absent", consuming the occurrence when marked present.
 *
 * `isMatch` is true iff the guess equals the target exactly.
 *
 * _Requirements: 4.3_
 */
export const gradeGuess = (guess: string, target: string): GradeResult => {
  const perLetter: LetterFeedback[] = new Array(guess.length);

  // Count the remaining occurrences of each target letter.
  const remaining: Record<string, number> = {};
  for (const letter of target) {
    remaining[letter] = (remaining[letter] ?? 0) + 1;
  }

  // Pass 1 — exact-position ("correct") matches.
  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i] ?? "";

    if (letter.length > 0 && letter === target[i]) {
      perLetter[i] = { index: i, letter, state: "correct" };
      remaining[letter] = (remaining[letter] ?? 0) - 1;
    }
  }

  // Pass 2 — "present" / "absent" for the remaining positions.
  for (let i = 0; i < guess.length; i++) {
    if (perLetter[i] !== undefined) {
      continue;
    }

    const letter = guess[i] ?? "";

    if (letter.length > 0 && (remaining[letter] ?? 0) > 0) {
      perLetter[i] = { index: i, letter, state: "present" };
      remaining[letter] = (remaining[letter] ?? 0) - 1;
    } else {
      perLetter[i] = { index: i, letter, state: "absent" };
    }
  }

  return { isMatch: guess === target, perLetter };
};

/**
 * Accumulated per-word keyboard hints for a survivor, mirroring Battle Royale's
 * `revealed_letters` / `partialMatches` / `noMatch`. These persist across every
 * guess of the CURRENT word and are reset when a new word is assigned.
 *
 *   - `revealedLetters`: index -> letter for every position graded `correct`.
 *   - `partialMatches`: letters known to be in the word but with at least one
 *     occurrence still NOT found at its exact position (so the keyboard key
 *     stays yellow — e.g. the second `P` in APPLE when only one P is placed).
 *   - `noMatch`: letters known to be absent from the word entirely.
 */
export type KeyboardMatches = {
  revealedLetters: Record<number, string>;
  partialMatches: string[];
  noMatch: string[];
};

/**
 * Returns true when `letter` still has at least one occurrence in `word` that
 * has NOT been revealed (found at its exact index). This is what keeps a letter
 * yellow after one of its duplicates is placed: APPLE has two `P`s, so after a
 * single `P` is revealed at index 2 the letter `P` still has an unrevealed
 * occurrence at index 1 and must remain a partial (yellow) hint, rather than
 * going fully green as if no `P`s remain.
 *
 * Ported verbatim (in behaviour) from Battle Royale's `hasUnrevealedOccurrence`
 * so the two modes grade duplicate letters identically.
 */
export const hasUnrevealedOccurrence = (
  word: string,
  letter: string,
  revealedLetters: Record<number, string>,
): boolean => {
  const normalizedWord = word.trim().toUpperCase();
  const normalizedLetter = letter.toUpperCase();

  const totalOccurrences = [...normalizedWord].filter(
    (wordLetter) => wordLetter === normalizedLetter,
  ).length;

  const revealedOccurrences = Object.entries(revealedLetters).filter(
    ([index, revealedLetter]) =>
      normalizedWord[Number(index)] === normalizedLetter &&
      revealedLetter.toUpperCase() === normalizedLetter,
  ).length;

  return revealedOccurrences < totalOccurrences;
};

/**
 * Compute the single-guess keyboard match sets for `guess` against `target`,
 * iterating over the TARGET positions exactly like Battle Royale's
 * `calculateMatchObj`:
 *   - a position where the guessed letter equals the target letter is a full
 *     (green) match at that index;
 *   - otherwise, if the guess contains the target's letter anywhere, that
 *     target letter is a partial (yellow) hint;
 *   - otherwise the guessed letter at that position is absent.
 *
 * This is the per-guess raw result. The caller merges it into the player's
 * accumulated {@link KeyboardMatches} and re-applies {@link hasUnrevealedOccurrence}
 * so a letter only stays yellow while an unfound occurrence remains.
 */
export const calculateKeyboardMatches = (
  target: string,
  guess: string,
): KeyboardMatches => {
  const normalizedTarget = target.trim().toUpperCase();
  const normalizedGuess = guess.trim().toUpperCase();

  const revealedLetters: Record<number, string> = {};
  const partialMatches: string[] = [];
  const noMatch: string[] = [];

  normalizedTarget.split("").forEach((letter, index) => {
    const guessedLetter = normalizedGuess[index];
    if (!guessedLetter) {
      return;
    }

    if (letter === guessedLetter) {
      revealedLetters[index] = letter;
      return;
    }

    if (normalizedGuess.includes(letter)) {
      partialMatches.push(letter);
      return;
    }

    noMatch.push(guessedLetter);
  });

  return { revealedLetters, partialMatches, noMatch };
};

/**
 * Merge a single guess's raw match sets into a survivor's accumulated keyboard
 * hints for the current word, applying the duplicate-letter rule so a letter
 * stays yellow only while it still has an unrevealed occurrence.
 *
 * Mirrors the accumulation Battle Royale's guess handler performs:
 *   - newly revealed positions are added to `revealedLetters`;
 *   - partials accumulate (de-duped) but are then filtered to only those with
 *     an unrevealed occurrence remaining in the target;
 *   - absents accumulate (de-duped) minus any letter currently partial.
 *
 * The input `accumulated` is not mutated; a fresh {@link KeyboardMatches} is
 * returned.
 */
export const mergeKeyboardMatches = (
  target: string,
  accumulated: KeyboardMatches,
  guessResult: KeyboardMatches,
): KeyboardMatches => {
  const revealedLetters = {
    ...accumulated.revealedLetters,
    ...guessResult.revealedLetters,
  };

  const partialMatches = [
    ...new Set([...accumulated.partialMatches, ...guessResult.partialMatches]),
  ].filter((letter) => hasUnrevealedOccurrence(target, letter, revealedLetters));

  const noMatch = [
    ...new Set([...accumulated.noMatch, ...guessResult.noMatch]),
  ].filter((letter) => !partialMatches.includes(letter));

  return { revealedLetters, partialMatches, noMatch };
};

/**
 * The subset of a survivor's per-round state that `applyGuess` reads. Kept
 * structurally compatible with `RacePlayer` (plus the server-only assigned
 * `word`) so callers can spread a player + their `RacePlayerServerData.word`
 * straight in.
 */
export type GuessApplicationInput = Pick<
  RacePlayer,
  | "completedWords"
  | "qualified"
  | "qualifiedAt"
  | "roundGuesses"
  | "totalGuesses"
  | "correctGuesses"
  | "correctLetters"
  | "isEliminated"
> & {
  /** The survivor's currently assigned target word (server-only). */
  word: string;
};

/**
 * The fields `applyGuess` may change, returned as a fresh object so callers can
 * merge them onto their own state without this helper mutating anything in
 * place. `word` is the (possibly new) assigned word after application.
 */
export type GuessApplicationResult = {
  completedWords: number;
  qualified: boolean;
  qualifiedAt?: number;
  roundGuesses: number;
  totalGuesses: number;
  correctGuesses: number;
  correctLetters: number;
  word: string;
  /** True iff the guess was graded (correct length + not eliminated). */
  accepted: boolean;
  /** True iff this guess exactly matched the assigned word. */
  isMatch: boolean;
  /** Per-letter feedback when the guess was graded, otherwise undefined. */
  feedback?: LetterFeedback[];
};

/**
 * Apply a single guess to a survivor's per-round state, purely: the input is
 * never mutated and a fresh result carrying the fields to update is returned.
 *
 * Behavior (Property 4):
 *   - Eliminated player, or guess length != round `wordLength`: reject. Counts
 *     and the assigned word are returned unchanged with `accepted: false`
 *     (Req 4.6, 4.8).
 *   - Otherwise the guess is graded (Req 4.3): `roundGuesses` and
 *     `totalGuesses` increment. On an exact match while `completedWords` is
 *     still below `qualifyingCount`, `completedWords` and `correctGuesses`
 *     increment and a fresh word of `wordLength` is assigned (Req 4.4). When
 *     `completedWords` thereby reaches `qualifyingCount`, `qualified` latches
 *     to true and `qualifiedAt` is set to `now` — exactly once; a survivor who
 *     is already qualified keeps their original `qualifiedAt` and word (Req 4.5).
 *
 * `now` is the timestamp used for a first-time qualification.
 *
 * _Requirements: 4.4, 4.5, 4.6, 4.8_
 */
export const applyGuess = (
  player: GuessApplicationInput,
  guess: string,
  qualifyingCount: number,
  wordLength: number,
  now: number,
): GuessApplicationResult => {
  const unchanged: GuessApplicationResult = {
    completedWords: player.completedWords,
    qualified: player.qualified,
    qualifiedAt: player.qualifiedAt,
    roundGuesses: player.roundGuesses,
    totalGuesses: player.totalGuesses,
    correctGuesses: player.correctGuesses,
    correctLetters: player.correctLetters,
    word: player.word,
    accepted: false,
    isMatch: false,
  };

  // Reject eliminated players and wrong-length guesses without side effects.
  if (player.isEliminated || !isCorrectLength(guess, wordLength)) {
    return unchanged;
  }

  const { isMatch, perLetter } = gradeGuess(guess, player.word);

  // Every graded guess counts toward the guess totals, and every letter graded
  // `correct` on this guess accumulates toward the player's correct-letter tally
  // (a secondary elimination-placement key).
  const roundGuesses = player.roundGuesses + 1;
  const totalGuesses = player.totalGuesses + 1;
  const correctLettersThisGuess = perLetter.filter(
    (entry) => entry.state === "correct",
  ).length;
  const correctLetters = player.correctLetters + correctLettersThisGuess;

  // A non-match, or a match once already at/over the qualifying count, does not
  // progress qualification or draw a new word.
  if (!isMatch || player.completedWords >= qualifyingCount) {
    return {
      ...unchanged,
      roundGuesses,
      totalGuesses,
      correctLetters,
      accepted: true,
      isMatch,
      feedback: perLetter,
    };
  }

  // Correct guess below the qualifying count: progress by one and draw a word.
  const completedWords = player.completedWords + 1;
  const correctGuesses = player.correctGuesses + 1;
  const word = assignWord(wordLength);

  // Latch qualification exactly once when the count is first reached. An
  // already-qualified survivor keeps their original qualifiedAt.
  const reachedNow = !player.qualified && completedWords >= qualifyingCount;
  const qualified = player.qualified || completedWords >= qualifyingCount;
  const qualifiedAt = player.qualified
    ? player.qualifiedAt
    : reachedNow
      ? now
      : player.qualifiedAt;

  return {
    completedWords,
    qualified,
    qualifiedAt,
    roundGuesses,
    totalGuesses,
    correctGuesses,
    correctLetters,
    word,
    accepted: true,
    isMatch: true,
    feedback: perLetter,
  };
};

/**
 * One survivor as ranked at round end: an `[id, player]` entry, matching how
 * the module holds players in `RaceMatch.players` (a `Map`) and how Battle
 * Royale's `rankPlayers` consumes `players.entries()`. The `id` is the stable
 * key (Supabase UUID for real players, `bot0`/`bot1`/… for bots).
 */
export type RankedSurvivor = readonly [string, RacePlayer];

/**
 * Rank round survivors into finishing order for elimination (best first).
 *
 * The ordering is a total order over the tie-break policy (Property 5):
 *   1. Every qualified survivor precedes every non-qualified survivor
 *      (Req 5.1).
 *   2. Qualified survivors are ordered by earliest `qualifiedAt` first — the
 *      survivor who reached the Qualifying_Count soonest ranks highest
 *      (Req 5.2). A missing `qualifiedAt` sorts last among the qualified.
 *   3. Non-qualified survivors are ordered by highest `completedWords` first,
 *      then fewest `roundGuesses` (Req 5.3).
 *
 * The sort is transitive (every comparison reduces to numeric/boolean
 * differences) and stable for exact ties: the input array's relative order is
 * preserved for entries that compare equal, so callers get deterministic
 * output for identical states. The input is not mutated — a fresh array is
 * returned.
 *
 * _Requirements: 5.1, 5.2, 5.3_
 */
export const rankSurvivors = (
  survivors: readonly RankedSurvivor[],
): RankedSurvivor[] => {
  // `qualifiedAt` may be undefined even when qualified; treat that as "latest
  // possible" so a genuine timestamp always ranks ahead of a missing one.
  const qualifiedAtOf = (p: RacePlayer): number =>
    p.qualifiedAt ?? Number.POSITIVE_INFINITY;

  // Array.prototype.sort is stable per spec, so equal comparisons preserve the
  // input order — this gives the "stable for exact ties" guarantee for free.
  return [...survivors].sort(([, a], [, b]) => {
    // 1. Qualified before non-qualified.
    if (a.qualified !== b.qualified) {
      return a.qualified ? -1 : 1;
    }

    if (a.qualified) {
      // 2. Among qualified: earliest qualifiedAt first.
      return qualifiedAtOf(a) - qualifiedAtOf(b);
    }

    // 3. Among non-qualified: highest completedWords first, ...
    if (a.completedWords !== b.completedWords) {
      return b.completedWords - a.completedWords;
    }

    // ... then fewest roundGuesses first.
    return a.roundGuesses - b.roundGuesses;
  });
};

/**
 * Select the survivors to eliminate at round end: the lowest-ranked suffix of
 * `ranked` (Property 6). The count comes from the shared `eliminationCount`
 * helper, which applies ceil rounding and clamps to leave at least one
 * survivor when more than one remains (and eliminates none when `n <= 1`).
 *
 * `ranked` must already be ordered best-first (as returned by `rankSurvivors`)
 * so the eliminated set is exactly the tail. Returns the ids of the eliminated
 * survivors, preserving their ranked order. `config` is accepted for signature
 * parity with the rest of the round surface; the clamping it would inform is
 * already performed inside `eliminationCount`, so it is not consulted here.
 *
 * _Requirements: 5.4_
 */
export const selectEliminated = (
  ranked: readonly RankedSurvivor[],
  pct: number,
  _config?: RaceConfig,
): string[] => {
  const count = eliminationCount(ranked.length, pct);
  if (count === 0) {
    return [];
  }

  // The lowest-ranked `count` survivors are the suffix of the best-first list.
  return ranked.slice(ranked.length - count).map(([id]) => id);
};

/** The outcome of resolving a Final_Round when its timer expires. */
export type FinalRoundResolution = {
  /**
   * The winner's id when a leader is distinguished, otherwise undefined for a
   * draw.
   */
  winnerId?: string;
  /** All survivor ids in resolved best-first order. */
  ranking: string[];
};

/**
 * Resolve the Final_Round on timer expiry with no correct guess (Property 9).
 *
 * Survivors are ranked best-first by highest `completedWords`, broken by fewest
 * `totalGuesses`; exact ties preserve input order (stable sort). The winner is
 * the top-ranked survivor unless no progress distinguishes a leader, in which
 * case the match is a draw with no winner (Req 6.4, 6.5).
 *
 * "No progress distinguishes a leader" is precisely:
 *   - there are no survivors, or
 *   - the top-ranked survivor has zero `completedWords` (no meaningful
 *     progress toward the Qualifying_Count), or
 *   - the top two survivors are exactly tied on `(completedWords,
 *     totalGuesses)`, so the tie-break policy cannot separate a leader.
 *
 * When a winner exists, `ranking[0]` is the winner and every other survivor
 * appears after them (placement > 1 in ranking order). The `ranking` is always
 * the full best-first id ordering, winner or draw. The input is not mutated —
 * ranking is computed over a fresh array.
 *
 * _Requirements: 6.3, 6.4, 6.5_
 */
export const resolveFinalRound = (
  survivors: readonly RankedSurvivor[],
): FinalRoundResolution => {
  // Best-first by highest completedWords, then fewest totalGuesses. Stable for
  // exact ties (Array.prototype.sort preserves input order per spec).
  const sorted = [...survivors].sort(([, a], [, b]) => {
    if (a.completedWords !== b.completedWords) {
      return b.completedWords - a.completedWords;
    }
    return a.totalGuesses - b.totalGuesses;
  });

  const ranking = sorted.map(([id]) => id);

  const leader = sorted[0];
  const runnerUp = sorted[1];

  // No survivors → nothing to resolve, a draw.
  if (leader === undefined) {
    return { ranking };
  }

  const [, leaderPlayer] = leader;

  // No meaningful progress: the best survivor never completed a word, so there
  // is nothing to distinguish a leader.
  if (leaderPlayer.completedWords === 0) {
    return { ranking };
  }

  // Top two exactly tied on the full tie-break policy → cannot separate a
  // leader, so declare a draw.
  if (runnerUp !== undefined) {
    const [, runnerUpPlayer] = runnerUp;
    if (
      runnerUpPlayer.completedWords === leaderPlayer.completedWords &&
      runnerUpPlayer.totalGuesses === leaderPlayer.totalGuesses
    ) {
      return { ranking };
    }
  }

  return { winnerId: leader[0], ranking };
};
