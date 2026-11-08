import { FIVE_LETTER_GUESS_WORDS as secretWords } from "@/shared/words";
import { FIVE_LETTER_WORDS as spellCheckWords } from "@/shared/spell-check-words";
import type { DuelParticipant } from "@/db/schema";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
// Spell-check against the larger lexicon so any valid English word is an
// allowed guess, while secrets are drawn only from the curated guess pool.
const validWords = new Set(spellCheckWords.map((word) => word.toUpperCase()));

/** Picks a SECRET word from the curated five-letter guess/answer pool. */
export const getRandomWord = (): string => {
  return secretWords[Math.floor(Math.random() * secretWords.length)]!;
};

/** Returns whether a five-letter guess is a real word in the spell-check lexicon. */
export const isValidDuelWord = (word: string): boolean =>
  word.length === WORD_LENGTH && validWords.has(word.toUpperCase());

// Duel status colours, consolidated to a three-colour language (plus grey for
// the not-yet-started case). The status keys are kept distinct so the derivation
// logic and labels stay granular, but they map onto a small, legible palette:
//   RED    — opt-out / non-finish end states (forfeit, declined)
//   YELLOW — in progress (started)
//   GREEN  — any played-to-an-end state (done/solved, lost — ran out of guesses)
//   GREY   — invited but not yet accepted (pending)
export const variants = {
  // End states where the player did not play to a result: gave up or never
  // joined. Both read as red.
  forfeit: "bg-red-500",
  declined: "bg-red-500",
  // Played to the end — solved or ran out of guesses. Reaching a game result is
  // the "completed" outcome, so both read as green.
  done: "bg-green-500",
  lost: "bg-green-500",
  // In progress.
  started: "bg-yellow-500",
  // Invited but has not accepted yet.
  pending: "bg-gray-400",
} as const;

export const haveAllDuelParticipantsFinished = (
  participantIds: string[],
  initiatorId: string,
  participants: DuelParticipant[],
) => {
  const otherParticipantIds = participantIds.filter(
    (userId) => userId !== initiatorId,
  );

  // Everyone invited declined.
  if (
    otherParticipantIds.length > 0 &&
    otherParticipantIds.every((userId) => {
      const participant = participants.find(
        (participant) => participant.userId === userId,
      );

      return participant?.accepted === false;
    })
  ) {
    return true;
  }

  // Otherwise, everyone needs a participant row and must
  // either have declined or finished their game.
  return participantIds.every((userId) => {
    const participant = participants.find(
      (participant) => participant.userId === userId,
    );

    if (!participant) {
      return false;
    }

    return participant.accepted === false || participant.endTime !== null;
  });
};

/** How long a duel may stay open before it is finalized automatically. */
export const DUEL_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** The moment a duel created at `createdAt` expires. */
export const duelDeadline = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + DUEL_EXPIRY_MS);

/**
 * Plans how to close out an EXPIRED duel without waiting on anyone, so partial
 * games resolve instead of hanging. Pure (no DB) so the rules sit next to
 * `determineDuelWinner` and `haveAllDuelParticipantsFinished`.
 *
 *   - Invited but never responded (no row): recorded as declined.
 *   - Already declined, or already finished/forfeited: left alone.
 *   - Accepted but unfinished: the game is ended at the deadline with
 *     `success = false` (any solve would already have set endTime). If they never
 *     opened the board and made no guesses it counts as a forfeit; if they
 *     started, it is a normal loss (ran out of time) so their effort still counts.
 *
 * Anyone who already solved keeps their result, so the usual winner rules then
 * apply: a solver beats non-solvers, and if nobody solved the duel is a draw.
 */
export const planExpiredDuel = (
  participantIds: string[],
  rows: DuelParticipant[],
): {
  declinedUserIds: string[];
  timedOut: { userId: string; forfeited: boolean }[];
} => {
  const declinedUserIds: string[] = [];
  const timedOut: { userId: string; forfeited: boolean }[] = [];

  for (const userId of participantIds) {
    const row = rows.find((participant) => participant.userId === userId);

    if (!row) {
      declinedUserIds.push(userId);
      continue;
    }
    if (row.accepted === false || row.endTime !== null) {
      continue;
    }
    timedOut.push({
      userId,
      forfeited: row.startTime === null && row.guesses.length === 0,
    });
  }

  return { declinedUserIds, timedOut };
};

export type MatchResult = {
  fullMatches: Record<number, string>;
  partialMatches: string[];
  partialMatchIndexes: number[];
  noMatch: string[];
};

export type KeyboardState = {
  correct: string[]; // green — right letter, right position
  present: string[]; // yellow — right letter, wrong position
  absent: string[]; // grey — not in word
};

/**
 * Two-pass Wordle-correct match algorithm.
 * Pass 1: lock in exact position matches and consume those letter occurrences.
 * Pass 2: for remaining positions, mark yellow if an unaccounted occurrence
 *         of that letter still exists in the word, otherwise grey.
 * Correctly handles repeated letters (e.g. GRASS, APPLE).
 */
export const calculateMatchObj = (word: string, guess: string): MatchResult => {
  const fullMatches: Record<number, string> = {};
  const partialMatches: string[] = [];
  const partialMatchIndexes: number[] = [];
  const noMatch: string[] = [];

  const remainingWordLetters: Record<string, number> = {};
  for (const letter of word) {
    remainingWordLetters[letter] = (remainingWordLetters[letter] ?? 0) + 1;
  }

  // Pass 1 — green matches.
  for (let i = 0; i < word.length; i++) {
    if (guess[i] === word[i]) {
      fullMatches[i] = word[i]!;
      remainingWordLetters[word[i]!]! -= 1;
    }
  }

  // Pass 2 — yellow / grey for non-green positions.
  for (let i = 0; i < word.length; i++) {
    if (fullMatches[i] !== undefined) continue;
    const guessedLetter = guess[i];
    if (!guessedLetter) continue;

    if ((remainingWordLetters[guessedLetter] ?? 0) > 0) {
      partialMatches.push(guessedLetter);
      partialMatchIndexes.push(i);
      remainingWordLetters[guessedLetter]! -= 1;
    } else {
      if (!noMatch.includes(guessedLetter)) noMatch.push(guessedLetter);
    }
  }

  return { fullMatches, partialMatches, partialMatchIndexes, noMatch };
};

/**
 * Derives the cumulative keyboard state from all per-guess match results.
 *
 * A letter only turns green on the keyboard once *every* occurrence of it in
 * the secret word has been placed in its correct position. Until then, if the
 * letter has been found at all (as a green or yellow in any guess) it shows
 * yellow. This is why `word` is needed: a key for a repeated letter (e.g. the
 * two W's in WIDOW) must stay yellow when only one of them has been placed,
 * even though that one placement is a green tile in the guess grid.
 */
export const buildKeyboardState = (
  matchResults: MatchResult[],
  word: string,
): KeyboardState => {
  const correct = new Set<string>();
  const present = new Set<string>();
  const absent = new Set<string>();

  // Total count of each letter in the secret word.
  const letterCounts: Record<string, number> = {};
  for (const letter of word) {
    letterCounts[letter] = (letterCounts[letter] ?? 0) + 1;
  }

  // Highest number of distinct correct positions ever found for each letter in
  // a single guess. Taking the max across guesses avoids double-counting when
  // the same position is matched in multiple guesses.
  const greenCounts: Record<string, number> = {};
  const everFound = new Set<string>();
  const everAbsent = new Set<string>();

  for (const { fullMatches, partialMatches, noMatch } of matchResults) {
    const perGuessGreens: Record<string, number> = {};
    for (const letter of Object.values(fullMatches)) {
      perGuessGreens[letter] = (perGuessGreens[letter] ?? 0) + 1;
      everFound.add(letter);
    }
    for (const [letter, count] of Object.entries(perGuessGreens)) {
      greenCounts[letter] = Math.max(greenCounts[letter] ?? 0, count);
    }
    for (const letter of partialMatches) everFound.add(letter);
    for (const letter of noMatch) everAbsent.add(letter);
  }

  for (const letter of everFound) {
    const total = letterCounts[letter] ?? 0;
    // Green only when all occurrences of the letter are placed; otherwise the
    // letter is known to be in the word but not fully placed, so it's yellow.
    if (total > 0 && (greenCounts[letter] ?? 0) >= total) {
      correct.add(letter);
    } else {
      present.add(letter);
    }
  }

  for (const letter of everAbsent) {
    if (!everFound.has(letter)) absent.add(letter);
  }

  return {
    correct: [...correct],
    present: [...present],
    absent: [...absent],
  };
};

export const determineDuelWinner = (
  participants: DuelParticipant[],
): string | null => {
  if (participants.length === 0) {
    return null;
  }

  // Don't determine a winner until everyone has finished.
  if (participants.some((participant) => participant.endTime === null)) {
    return null;
  }

  // Successful players take priority over players who failed.
  const successfulParticipants = participants.filter(
    (participant) => participant.success,
  );

  // Nobody solved the word.
  if (successfulParticipants.length === 0) {
    return null;
  }

  // Find the participant with:
  // 1. Fewest guesses
  // 2. Fastest completion time
  const sortedParticipants = [...successfulParticipants].sort((a, b) => {
    if (a.totalGuesses !== b.totalGuesses) {
      return a.totalGuesses - b.totalGuesses;
    }

    return a.endTime!.getTime() - b.endTime!.getTime();
  });

  const winner = sortedParticipants[0];

  if (!winner) {
    return null;
  }

  // If the best two players have identical guesses and completion time,
  // the duel is a draw.
  const runnerUp = sortedParticipants[1];

  if (
    runnerUp &&
    winner.totalGuesses === runnerUp.totalGuesses &&
    winner.endTime!.getTime() === runnerUp.endTime!.getTime()
  ) {
    return null;
  }

  return winner.userId;
};

