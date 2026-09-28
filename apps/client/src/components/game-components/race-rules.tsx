import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import Modal from "@/components/modal";
import Tile from "@/components/tile";

type RuleSlide = {
	title: string;
	body: string;
	visual: React.ReactNode;
};

const TileRow: React.FC<{
	tiles: {
		word: string;
		variant: "correct" | "present" | "absent" | "default";
	}[];
}> = ({ tiles }) => (
	<div className="flex justify-center gap-1.5">
		{tiles.map((tile, i) => (
			<Tile
				key={i}
				revealed
				size="sm"
				variant={tile.variant}
				word={tile.word}
			/>
		))}
	</div>
);

const SLIDES: RuleSlide[] = [
	{
		title: "Round-based elimination race",
		body: "Between 4 and 32 players drop into a lobby, then the match plays out as a sequence of timed rounds. Every round is a race against the clock \u2014 qualify in time to survive, or get left behind.",
		visual: (
			<TileRow
				tiles={[
					{ word: "R", variant: "correct" },
					{ word: "A", variant: "present" },
					{ word: "C", variant: "absent" },
					{ word: "E", variant: "correct" },
				]}
			/>
		),
	},
	{
		title: "Crack your words",
		body: "Each round gives you your own independent word to solve. Type a guess and every letter is graded by color: green means the letter is in the exact right spot, amber means it's in the word but somewhere else, and grey means it isn't in the word at all. Solve enough words before the timer runs out to qualify.",
		visual: (
			<TileRow
				tiles={[
					{ word: "S", variant: "correct" },
					{ word: "O", variant: "absent" },
					{ word: "L", variant: "present" },
					{ word: "V", variant: "absent" },
					{ word: "E", variant: "correct" },
				]}
			/>
		),
	},
	{
		title: "Rounds get harder",
		body: "Round 1 hides 4-letter words \u2014 solve 3 to qualify. Round 2 steps up to 5-letter words, where 2 keeps you safe. Reach the Final Round and you're facing 6-letter words. The deeper you go, the tougher it gets.",
		visual: (
			<TileRow
				tiles={[
					{ word: "H", variant: "correct" },
					{ word: "A", variant: "present" },
					{ word: "R", variant: "absent" },
					{ word: "D", variant: "correct" },
				]}
			/>
		),
	},
	{
		title: "Survive the cut",
		body: "When a round's timer expires, the slowest players are eliminated \u2014 around 30% after Round 1 and 40% after Round 2. Hit your qualifying count in time and you live to race another round.",
		visual: (
			<div className="flex flex-col items-center gap-2">
				<TileRow
					tiles={[
						{ word: "O", variant: "absent" },
						{ word: "U", variant: "absent" },
						{ word: "T", variant: "absent" },
					]}
				/>
				<span className="rounded-sm bg-red-400 px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest">
					Eliminated
				</span>
			</div>
		),
	},
	{
		title: "Win the final",
		body: "In the Final Round the first player to correctly guess the word wins the match. If the timer expires first, the win goes to whoever made the most progress \u2014 fewest guesses breaks ties, and a total tie is a draw. One last thing: type faster than the allowed rate and an anti-spam guard briefly slows your input.",
		visual: (
			<TileRow
				tiles={[
					{ word: "W", variant: "correct" },
					{ word: "I", variant: "correct" },
					{ word: "N", variant: "correct" },
				]}
			/>
		),
	},
];

const RaceRulesContent: React.FC = () => {
	const [index, setIndex] = useState(0);
	const [direction, setDirection] = useState(0);

	const goTo = useCallback((next: number) => {
		const clamped = (next + SLIDES.length) % SLIDES.length;
		setIndex((current) => {
			setDirection(clamped > current ? 1 : -1);
			return clamped;
		});
	}, []);

	const slide = SLIDES[index] as RuleSlide;

	return (
		<div className="flex flex-col font-mono">
			<div className="mb-2 text-center">
				<span className="font-semibold text-[11px] text-green-500 uppercase tracking-widest">
					How to play
				</span>
				<h2 className="mt-1 text-2xl uppercase tracking-wide">
					Elimination Race
				</h2>
			</div>

			<div className="relative h-80 overflow-hidden">
				<AnimatePresence custom={direction} initial={false} mode="wait">
					<motion.div
						animate={{ opacity: 1, x: 0 }}
						className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-4 text-center"
						custom={direction}
						exit={{ opacity: 0, x: direction >= 0 ? -40 : 40 }}
						initial={{ opacity: 0, x: direction >= 0 ? 40 : -40 }}
						key={index}
						transition={{ duration: 0.25, ease: "easeInOut" }}
					>
						<div className="flex min-h-[48px] items-center justify-center">
							{slide.visual}
						</div>
						<h3 className="font-semibold text-lg text-stone-800 uppercase tracking-wide">
							{slide.title}
						</h3>
						<p className="max-w-md text-[13px] text-gray-500 leading-relaxed">
							{slide.body}
						</p>
					</motion.div>
				</AnimatePresence>
			</div>

			<div className="mt-2 flex items-center justify-between">
				<button
					aria-label="Previous rule"
					className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-all hover:bg-gray-100 active:scale-95"
					onClick={() => goTo(index - 1)}
					type="button"
				>
					<svg
						aria-hidden="true"
						className="h-4 w-4"
						fill="currentColor"
						viewBox="0 0 24 24"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
					</svg>
				</button>

				<div className="flex items-center gap-2">
					{SLIDES.map((_, dotIndex) => (
						<button
							aria-label={`Go to rule ${dotIndex + 1}`}
							className={`h-2 rounded-full transition-all ${
								dotIndex === index
									? "w-5 bg-green-400"
									: "w-2 bg-gray-300 hover:bg-gray-400"
							}`}
							key={dotIndex}
							onClick={() => goTo(dotIndex)}
							type="button"
						/>
					))}
				</div>

				<button
					aria-label="Next rule"
					className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-all hover:bg-gray-100 active:scale-95"
					onClick={() => goTo(index + 1)}
					type="button"
				>
					<svg
						aria-hidden="true"
						className="h-4 w-4"
						fill="currentColor"
						viewBox="0 0 24 24"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
					</svg>
				</button>
			</div>
		</div>
	);
};

const RulesButton: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
	<button
		className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 py-2 font-semibold text-[11px] text-gray-500 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
		onClick={(event) => {
			// Prevent the surrounding clickable game card from also firing.
			event.stopPropagation();
			onOpen();
		}}
		type="button"
	>
		<svg
			aria-hidden="true"
			className="h-3.5 w-3.5"
			fill="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
		</svg>
		How to play
	</button>
);

/**
 * "How to play" button that opens a modal explaining the Elimination Race rules
 * through a small carousel. Drop it inside a GameCard alongside the play button.
 */
const RaceRules: React.FC = () => {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<RulesButton onOpen={() => setIsOpen(true)} />

			<AnimatePresence>
				{isOpen && (
					<Modal className="max-w-2xl sm:p-8" onClose={() => setIsOpen(false)}>
						<RaceRulesContent />
					</Modal>
				)}
			</AnimatePresence>
		</>
	);
};

export default RaceRules;
