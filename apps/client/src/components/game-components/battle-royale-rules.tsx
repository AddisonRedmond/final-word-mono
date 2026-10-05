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
		title: "Last solver standing",
		body: "Up to 100 players drop into the same match at once. Everyone races to solve hidden words against a shrinking clock. Outlast everyone else and you take the win.",
		visual: (
			<TileRow
				tiles={[
					{ word: "B", variant: "correct" },
					{ word: "A", variant: "present" },
					{ word: "T", variant: "absent" },
					{ word: "T", variant: "correct" },
					{ word: "L", variant: "correct" },
					{ word: "E", variant: "present" },
				]}
			/>
		),
	},
	{
		title: "Crack the hidden word",
		body: "Each round hides a secret word. Type a guess and every letter is graded by color: green means that letter is in the exact right spot, amber means the letter is in the word but somewhere else, and grey means the letter isn't in the word at all. Use those clues to narrow it down and solve the word, then a new one appears.",
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
		title: "Race the clock",
		body: "You start with 90 seconds of life that ticks down constantly. Every word you solve banks bonus time \u2014 up to 60 seconds if you solve it fast, and less the more guesses it takes. Your life can't go above 90 seconds, so keep solving to stay alive. If your timer hits zero, you're eliminated. To ease you in, your words start with free letters revealed \u2014 two for the first couple of minutes, then one, until the match heats up and you're on your own.",
		visual: (
			<div className="mx-auto flex w-full max-w-[220px] flex-col gap-1.5">
				<div className="h-3 w-full overflow-hidden rounded-full bg-stone-300">
					<motion.div
						animate={{ width: ["35%", "90%", "60%"] }}
						className="h-full rounded-full bg-emerald-500"
						initial={{ width: "35%" }}
						transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
					/>
				</div>
				<p className="text-center text-[10px] text-gray-400 uppercase tracking-widest">
					Life timer
				</p>
			</div>
		),
	},
	{
		title: "Attack your rivals",
		body: "Solving a word doesn't just help you \u2014 it fires that word at an opponent to crack. You choose who to hit: the player in the lead, the one trailing behind, or a random rival. The faster you solved it, the fewer of its letters they get to see, making it harder on them. A rival can be stacked with up to 5 attack words at once.",
		visual: (
			<div className="flex flex-col items-center gap-2">
				<TileRow
					tiles={[
						{ word: "T", variant: "correct" },
						{ word: "R", variant: "default" },
						{ word: "A", variant: "correct" },
						{ word: "P", variant: "default" },
						{ word: "S", variant: "default" },
					]}
				/>
				<span className="rounded-sm bg-red-400 px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest">
					Incoming attack
				</span>
			</div>
		),
	},
	{
		title: "Dodge incoming attacks",
		body: "Attacks don't land instantly. A new attack word hovers over your board on a short timer before it locks in \u2014 solve your current word before the timer runs out and you shrug it off. Solve it in two guesses or less and you clear the whole incoming wave; three or four clears two; five or more clears one. Keep up and attacks stay survivable; fall behind and they lock in as words you'll have to solve.",
		visual: (
			<div className="flex flex-col items-center gap-2">
				<div className="flex justify-center gap-1.5">
					{Array.from({ length: 5 }, (_, i) => (
						<div
							className="flex h-10 w-10 items-center justify-center rounded-md border border-amber-300 border-dashed bg-amber-50/60 text-amber-400"
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative row of identical ghost tiles that never reorders
							key={i}
						>
							<span className="text-lg leading-none">?</span>
						</div>
					))}
				</div>
				<span className="rounded-sm bg-amber-400 px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest">
					Incoming &middot; solve to dodge
				</span>
			</div>
		),
	},
	{
		title: "Claim the crown",
		body: "Be the last player still alive and the win is yours. Matches also have a 10-minute limit \u2014 if time runs out first, the crown goes to whoever solved the most words, with fewest total guesses and then most life remaining breaking any ties.",
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

const BattleRoyaleRulesContent: React.FC = () => {
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
				<h2 className="mt-1 text-2xl uppercase tracking-wide">Battle Royale</h2>
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
		className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-gray-200 py-2 font-semibold text-[11px] text-gray-500 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
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
 * "How to play" button that opens a modal explaining the Battle Royale rules
 * through a small carousel. Drop it inside a GameCard alongside the play button.
 */
const BattleRoyaleRules: React.FC = () => {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<RulesButton onOpen={() => setIsOpen(true)} />

			<AnimatePresence>
				{isOpen && (
					<Modal className="max-w-2xl sm:p-8" onClose={() => setIsOpen(false)}>
						<BattleRoyaleRulesContent />
					</Modal>
				)}
			</AnimatePresence>
		</>
	);
};

export default BattleRoyaleRules;
