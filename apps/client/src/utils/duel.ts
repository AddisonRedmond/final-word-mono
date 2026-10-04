import { FIVE_LETTER_WORDS as words } from "@/shared/words";
import type { DuelParticipant } from "@/db/schema";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
const validWords = new Set(words.map((word) => word.toUpperCase()));

export const getRandomWord = (): string => {
  return words[Math.floor(Math.random() * words.length)]!;
};

/** Returns whether a five-letter guess exists in the canonical duel word list. */
export const isValidDuelWord = (word: string): boolean =>
  word.length === WORD_LENGTH && validWords.has(word.toUpperCase());

export const variants = {
  forfeit: "bg-red-500",
  // A participant who played to the end but didn't solve the word (ran out of
  // guesses). Distinct from `forfeit` (gave up) and `declined` (never started).
  lost: "bg-orange-500",
  started: "bg-yellow-500",
  done: "bg-green-500",
  declined: "bg-stone-500",
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

