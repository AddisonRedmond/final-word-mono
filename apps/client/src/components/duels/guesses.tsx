import { MAX_GUESSES, type MatchResult, WORD_LENGTH } from "@/utils/duel";
import type { LetterState } from "@/utils/letter-states";
import { DuelGuessLetter } from "./duel-guess";

/**
 * Converts a MatchResult into a per-letter LetterState array so
 * DuelGuessLetter can colour each tile correctly.
 */
const matchResultToVariants = (match: MatchResult): LetterState[] => {
	return Array.from({ length: WORD_LENGTH }, (_, i) => {
		if (match.fullMatches[i] !== undefined) return "correct";
		if (match.partialMatchIndexes.includes(i)) return "present";
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
		<div className="flex min-h-0 w-full grow flex-col items-center justify-center gap-1 py-1 sm:grow-0 sm:gap-2 sm:py-2">
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
						className="flex min-h-0 w-full flex-1 justify-center gap-1 sm:flex-none sm:gap-1.5"
						key={rowIndex}
					>
						{Array.from({ length: WORD_LENGTH }, (_, letterIndex) => {
							return (
								<DuelGuessLetter
									fitHeight
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
