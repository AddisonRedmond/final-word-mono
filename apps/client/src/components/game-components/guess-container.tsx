import { Swords } from "lucide-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { memo } from "react";
import type { RevealedLetters } from "@/types/battle-royale.types";
import GuessTiles, { type TileSlot } from "./guess-tiles";

type GuessContainerProps = {
	guess: string;
	queue?: RevealedLetters[];
	fullMatches?: Record<number, string>;
	currentWordGuesses?: number;
	// Initials of the attacker who sent the current word, shown as a badge when
	// the word being guessed arrived as an attack. Undefined = not an attack word.
	attackerInitials?: string;
};

const GUESS_LENGTH = 5;

// The hopper queue keeps its own muted "hopper" tile look, which is not part of
// the shared graded-tile palette used for the active row.
const hopperTileClass = "bg-stone-200 text-black border border-stone-300";

// static content, never re-renders when guess changes
const HopperQueue: React.FC<{ queue?: RevealedLetters[] }> = memo(
	({ queue }) => {
		return (
			<>
				{queue?.map((item) => {
					const hopperWord = Array.from(
						{ length: GUESS_LENGTH },
						(_, index) => {
							return item?.[index] ?? "";
						},
					);

					return (
						<div
							className="my-1 flex justify-between gap-x-1 px-2 font-semibold text-lg"
							key={Object.values(item).join("")}
						>
							{hopperWord.map((letter, letterIndex) => (
								<div
									className={`grid size-14 place-content-center rounded-md ${hopperTileClass}`}
									// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row that never reorders, so the index is a stable key
									key={letterIndex}
								>
									<AnimatePresence>
										{letter && (
											<m.p
												animate={{ scale: 1 }}
												exit={{ scale: 0 }}
												initial={{ scale: 0 }}
												key="letter"
											>
												{letter}
											</m.p>
										)}
									</AnimatePresence>
								</div>
							))}
						</div>
					);
				})}
			</>
		);
	},
);

HopperQueue.displayName = "HopperQueue";

const GuessContainer: React.FC<GuessContainerProps> = ({
	guess = "",
	queue,
	fullMatches,
	attackerInitials,
}) => {
	// The active row always renders in the "correct" (green) style in Battle
	// Royale, with any known letter pinned to the tile corner.
	const slots: TileSlot[] = Array.from(
		{ length: GUESS_LENGTH },
		(_, index) => ({
			letter: guess.at(index) ?? "",
			state: "correct",
			cornerHint: fullMatches?.[index],
		}),
	);

	return (
		<LazyMotion features={domAnimation} strict>
			<div className="flex items-end gap-2">
				<div className="relative isolate rounded-md border border-white/30 bg-white/10 shadow-lg backdrop-blur-md">
					<HopperQueue queue={queue} />

					{/* Badge pinned to the active guess row so it reads as "this word
              you're working on was sent by <attacker>". */}
					<div className="relative z-10 p-2">
						{attackerInitials && (
							<div
								className="absolute -top-2 -right-2 z-20 flex items-center gap-x-1 rounded-full bg-red-500 px-2 py-0.5 font-bold text-[0.65rem] text-white uppercase tracking-wider shadow-md"
								title={`Attack word from ${attackerInitials}`}
							>
								<Swords className="size-3" />
								{attackerInitials}
							</div>
						)}

						<GuessTiles slots={slots} />
					</div>
				</div>
			</div>
		</LazyMotion>
	);
};

export default GuessContainer;
