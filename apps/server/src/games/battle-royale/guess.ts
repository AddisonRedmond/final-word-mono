import type { TargetType } from "types/battle-royale.types.js";
import { games, serverOnlyData } from "./state.js";

/** Gathers the state needed to process a guess for a given player. */
export const getGuessContext = (
  roomId: string,
  userId: string,
  payload: { word: string; target: TargetType },
) => {
  const game = games.get(roomId);
  const roomServerOnlyData = serverOnlyData.get(roomId);
  const player = game?.players.get(userId);
  const targetWord = roomServerOnlyData?.playerData[userId]?.word;
  const guessedWord = payload?.word;

  return {
    game,
    roomServerOnlyData,
    player,
    targetWord,
    guessedWord,
  };
};

/**
 * Returns true when `letter` still has at least one unrevealed occurrence in
 * `word`, given the letters already revealed to the player.
 */
export const hasUnrevealedOccurrence = (
  word: string,
  letter: string,
  revealedLetters: Record<number, string>,
) => {
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
