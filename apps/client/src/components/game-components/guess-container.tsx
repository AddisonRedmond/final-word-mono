import { ChevronRight, Swords } from "lucide-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { memo, useEffect } from "react";
import { useTimer } from "react-timer-hook";
import { useServerClockStore } from "@/state/server-clock-store";
import type {
	QueuedAttackView,
	RevealedLetters,
} from "@/types/battle-royale.types";
import { flatTileClasses, tileStateClasses } from "@/utils/letter-states";
import GuessTiles, { type TileSlot } from "./guess-tiles";

type GuessContainerProps = {
	guess: string;
	// Letter reveals for each CEMENTED queued word, in consume order. Pending
	// words carry no letters (that would leak the answer) and are rendered as
	// ghost rows driven by `attackQueueView` + `cementAt` instead.
	queue?: RevealedLetters[];
	// §5.2a — pending/cemented slot metadata (letterless). Pending entries at the
	// front render ghosted under the cement countdown; cemented entries render
	// solid and align with `queue`.
	attackQueueView?: QueuedAttackView[];
	// §5.2a — server timestamp (ms) the current pending wave cements. Drives the
	// single batch countdown shown over the pending rows. Undefined = no wave.
	cementAt?: number;
	fullMatches?: Record<number, string>;
	currentWordGuesses?: number;
	// Initials of the attacker who sent the current word, shown as a badge when
	// the word being guessed arrived as an attack. Undefined = not an attack word.
	attackerInitials?: string;
};

const GUESS_LENGTH = 5;

// Pending (uncemented) attack words render ghosted/dashed to read as "escapable
// if you solve in time". No letters are ever shown for a pending word.
const pendingTileClass =
	"border border-dashed border-stone-400/60 bg-stone-100/40 text-stone-500";

// An empty tile whose letter is already known: outlined in lime, not filled.
const knownTileClass =
	"bg-lime/10 text-lime shadow-[inset_0_0_0_2px_var(--color-lime),0_0_14px_rgba(182,255,46,0.25)]";

// Small countdown over the pending wave: solve your current word before this
// hits 0 and the pending words vanish; otherwise they cement into the queue.
const CementCountdown: React.FC<{ cementAt: number }> = memo(({ cementAt }) => {
	const offsetMs = useServerClockStore((state) => state.offsetMs);
	const clientExpiry = cementAt - offsetMs;

	const { totalSeconds, restart } = useTimer({
		autoStart: true,
		expiryTimestamp: new Date(clientExpiry),
	});

	useEffect(() => {
		restart(new Date(clientExpiry), true);
	}, [clientExpiry, restart]);

	return (
		<p className="text-center font-semibold text-[0.65rem] text-amber-600 uppercase tracking-wider">
			Incoming · {Math.max(totalSeconds, 0)}s
		</p>
	);
});

CementCountdown.displayName = "CementCountdown";

// A single ghosted pending row (no letters — the word is hidden while pending).
const PendingRow: React.FC = memo(() => (
	// Faded well below the current row so it never reads as the word to guess.
	<div className="my-1 flex justify-between gap-x-1 px-2 font-semibold text-lg opacity-35">
		{Array.from({ length: GUESS_LENGTH }, (_, index) => (
			<div
				className={`grid size-14 place-content-center rounded-md ${pendingTileClass}`}
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row that never reorders
				key={index}
			>
				<Swords className="size-4 opacity-50" />
			</div>
		))}
	</div>
));

PendingRow.displayName = "PendingRow";

// static content, never re-renders when guess changes. Renders the CEMENTED
// words (with their revealed letters) as solid hopper rows.
const HopperQueue: React.FC<{ queue?: RevealedLetters[] }> = memo(
	({ queue }) => {
		return (
			<>
				{queue?.map((item, rowIndex) => {
					const hopperWord = Array.from(
						{ length: GUESS_LENGTH },
						(_, index) => {
							return item?.[index] ?? "";
						},
					);

					return (
						<div
							// Queued, not current: faded so the active row below stands out.
							className="my-1 flex justify-between gap-x-1 px-2 font-semibold text-lg opacity-45"
							// biome-ignore lint/suspicious/noArrayIndexKey: cemented rows are positional and consumed front-first; a letter-based key would collide across identical reveals
							key={rowIndex}
						>
							{hopperWord.map((letter, letterIndex) => (
								<div
									className={`grid size-14 place-content-center rounded-md ${flatTileClasses.default}`}
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
	attackQueueView,
	cementAt,
	fullMatches,
	attackerInitials,
}) => {
	// The active row: an untouched tile is dark; a tile whose letter is known
	// (revealed) gets a lime outline, a small HINT label, and the letter in the
	// top-right corner; a typed letter fills the tile lime. The known letter
	// stays in that corner the whole time, so typing over it doesn't move it.
	const slots: TileSlot[] = Array.from(
		{ length: GUESS_LENGTH },
		(_, index) => {
			const letter = guess.at(index) ?? "";
			const known = fullMatches?.[index];

			return {
				letter,
				cornerHint: known,
				label: known ? "HINT" : undefined,
				tileClassName: letter
					? tileStateClasses.correct
					: known
						? knownTileClass
						: tileStateClasses.default,
			};
		},
	);

	const pendingCount =
		attackQueueView?.filter((entry) => !entry.cemented).length ?? 0;

	return (
		<LazyMotion features={domAnimation} strict>
			<div className="flex items-end gap-2">
				<div className="relative isolate">

					{/* Pending wave: a single batch countdown over ghosted rows that
              vanish if the player solves their current word in time. */}
					{pendingCount > 0 && (
						<div className="px-2 pt-1">
							{typeof cementAt === "number" && (
								<CementCountdown cementAt={cementAt} />
							)}
							{Array.from({ length: pendingCount }, (_, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: identical, orderless ghost rows
								<PendingRow key={index} />
							))}
						</div>
					)}

					{/* Cemented words: solid rows with any bled-in letter hints. */}
					<HopperQueue queue={queue} />

					{/* Label sits directly on the row being guessed, not above the
					    queue, so it labels the right word. */}
					<p className="mt-1 text-center font-semibold text-[10px] text-gray-500 uppercase tracking-[0.25em]">
						Your word
					</p>

					{/* Badge pinned to the active guess row so it reads as "this word
              you're working on was sent by <attacker>". */}
					<div className="relative z-10 p-2">
						{/* Points at the row you're actually guessing. Sits in the
						    row's padding so it never shifts the tiles or overflows a
						    narrow phone. */}
						<ChevronRight
							aria-hidden="true"
							className="absolute top-1/2 -left-2.5 size-4 -translate-y-1/2 text-lime"
							strokeWidth={3}
						/>
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
