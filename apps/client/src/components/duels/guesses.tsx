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
    // Mobile: grow to fill the space between the timer and the keyboard and
    // let the rows share that height (so the board scales to the viewport
    // instead of scrolling). Desktop (auto-height modal): don't grow — the
    // rows take their natural fixed-tile height and stack normally.
    <div className="flex w-full flex-col items-center justify-center gap-1 py-1 min-h-0 grow sm:grow-0 sm:gap-2 sm:py-2">
      {Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
        const guess = guesses[rowIndex] ?? "";
        const match = matchResults[rowIndex];
        const variants =
          match && guess ? matchResultToVariants(match) : undefined;

        return (
          // Mobile: each row shares the available height equally (`flex-1
          // min-h-0`) so the rows collectively shrink to fit. Desktop: rows
          // take their natural (fixed-tile) height instead.
          <div
            key={rowIndex}
            className="flex w-full justify-center gap-1 min-h-0 flex-1 sm:flex-none sm:gap-1.5"
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
