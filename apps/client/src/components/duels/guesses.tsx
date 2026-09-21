import type { MatchResult } from "@/utils/duel";
import { DuelGuessLetter } from "./duel-guess";

type TileVariant = "default" | "correct" | "present" | "absent";

const MAX_GUESSES = 5;
const WORD_LENGTH = 5;

/**
 * Converts a MatchResult into a per-letter TileVariant array so
 * DuelGuessLetter can colour each tile correctly.
 */
const matchResultToVariants = (
  match: MatchResult,
  guess: string,
): TileVariant[] => {
  return Array.from({ length: WORD_LENGTH }, (_, i) => {
    if (match.fullMatches[i] !== undefined) return "correct";
    if (match.partialMatches.includes(guess[i]?.toUpperCase() ?? ""))
      return "present";
    return "absent";
  });
};

const Guesses: React.FC<{ guesses: string[]; matchResults: MatchResult[] }> = ({
  guesses,
  matchResults,
}) => {
  return (
    <div className="flex w-full flex-col items-center gap-2 py-2">
      {Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
        const guess = guesses[rowIndex] ?? "";
        const match = matchResults[rowIndex];
        const variants =
          match && guess ? matchResultToVariants(match, guess) : undefined;

        return (
          <div key={rowIndex} className="flex gap-1 w-full">
            {Array.from({ length: WORD_LENGTH }, (_, letterIndex) => {
         
              return (
                <DuelGuessLetter
                  key={letterIndex}
                  letter={guess.at(letterIndex)}
                  variant={variants?.[letterIndex] ?? "default"}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default Guesses;
