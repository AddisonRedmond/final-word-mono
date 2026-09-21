import words from "./words";
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
  absent: string[];  // grey — not in word
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
 * A letter only shows green once all its occurrences in the word are placed —
 * ensured by removing it from `present` when it appears in `correct`.
 */
export const buildKeyboardState = (matchResults: MatchResult[]): KeyboardState => {
  const correct = new Set<string>();
  const present = new Set<string>();
  const absent = new Set<string>();

  for (const { fullMatches, partialMatches, noMatch } of matchResults) {
    for (const letter of Object.values(fullMatches)) correct.add(letter);
    for (const letter of partialMatches) present.add(letter);
    for (const letter of noMatch) absent.add(letter);
  }

  for (const letter of correct) present.delete(letter);

  return {
    correct: [...correct],
    present: [...present],
    absent: [...absent],
  };
};
