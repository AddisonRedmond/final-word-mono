import { MAX_GUESSES, WORD_LENGTH, type MatchResult } from "@/utils/duel";
import { DuelGuessLetter } from "./duel-guess";

type TileVariant = "default" | "correct" | "present" | "absent";

/**
 * Converts a MatchResult into a per-letter TileVariant array so
 * DuelGuessLetter can colour each tile correctly.
 */
const matchResultToVariants = (
  match: MatchResult,
): TileVariant[] => {
  return Array.from({ length: WORD_LENGTH }, (_, i) => {
    if (match.fullMatches[i] !== undefined) return "correct";
    if (match.partialMatchIndexes.includes(i))
      return "present";
    return "absent";
  });
};

const Guesses: React.FC<{ guesses: string[]; matchResults: MatchResult[] }> = ({
  guesses,
  matchResults,
}) => {
  return (
    // Grow to fill the space between the timer and the keyboard. `min-h-0`
    // lets this flex child actually shrink below its content size so the whole
    // board scales down to fit the viewport instead of overflowing/scrolling.
    <div className="flex min-h-0 w-full grow flex-col items-center justify-center gap-1 py-1 sm:gap-2 sm:py-2">
      {Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
        const guess = guesses[rowIndex] ?? "";
        const match = matchResults[rowIndex];
        const variants =
          match && guess ? matchResultToVariants(match) : undefined;

        return (
          // Each row shares the available height equally (`flex-1 min-h-0`),
          // so the rows collectively shrink to fit. Tiles size from the row
          // height, keeping them square.
          <div
            key={rowIndex}
            className="flex min-h-0 w-full flex-1 justify-center gap-1"
          >
            {Array.from({ length: WORD_LENGTH }, (_, letterIndex) => {
              return (
                <DuelGuessLetter
                  key={letterIndex}
                  fitHeight
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
