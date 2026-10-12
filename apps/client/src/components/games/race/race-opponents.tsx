import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { RacePlayer } from "@/types/race.types";
import {
	GAP,
	getInitials,
	getRaceCardHeight,
	getRaceWidthForHeight,
	MAX_RACE_OPPONENT_WIDTH,
} from "@/utils/opponents";

export type RaceOpponent = RacePlayer & { id: string };

type RaceOpponentsProps = {
	/** Non-self players to render in this flanking column. */
	opponents: RaceOpponent[];
	/** Words needed to qualify this round; drives the progress bar. */
	qualifyingCount: number;
};

type ContainerSize = {
	width: number;
	height: number;
};

/**
 * Race-specific flanking opponents grid. Visually mirrors Battle Royale's
 * opponent cards (rounded zinc-100 card, shadow, initials badge) but renders
 * Race data: a thin progress bar of `completedWords / qualifyingCount` in place
 * of Battle Royale's life bar, plus a "Qualified" tick when the opponent has
 * qualified. Eliminated opponents are filtered out, matching Battle Royale.
 *
 * Purely presentational — Race has no attacks, so there is no selection or
 * targeting.
 */
const RaceOpponents = memo(
	({ opponents, qualifyingCount }: RaceOpponentsProps) => {
		const ref = useRef<HTMLDivElement>(null);

		const active = useMemo(
			() => opponents.filter((opponent) => !opponent.isEliminated),
			[opponents],
		);

		const [containerSize, setContainerSize] = useState<ContainerSize>({
			width: 0,
			height: 0,
		});

		// Measure the column so cards can grow to fill it (matching Battle
		// Royale), re-measuring on resize.
		useEffect(() => {
			const element = ref.current;
			if (!element) return;

			const observer = new ResizeObserver(([entry]) => {
				if (!entry) return;

				const width = Math.round(entry.contentRect.width);
				const height = Math.round(entry.contentRect.height);

				setContainerSize((previous) =>
					previous.width === width && previous.height === height
						? previous
						: { width, height },
				);
			});

			observer.observe(element);
			return () => observer.disconnect();
		}, []);

		// Pick the card width that best fills the column: try every column count
		// and keep the layout yielding the largest card, bounded by both the
		// available width and the width implied by the available height. Then
		// clamp to the max so a small field doesn't dwarf the player's board.
		const cardWidth = useMemo(() => {
			const count = active.length;
			if (!count || !containerSize.width || !containerSize.height) {
				return 0;
			}

			let largestWidth = 0;
			for (let columns = 1; columns <= count; columns++) {
				const rows = Math.ceil(count / columns);
				const availableWidth =
					(containerSize.width - GAP * (columns - 1)) / columns;
				const availableHeight =
					(containerSize.height - GAP * (rows - 1)) / rows;
				const maxWidthFromHeight = getRaceWidthForHeight(availableHeight);
				largestWidth = Math.max(
					largestWidth,
					Math.min(availableWidth, maxWidthFromHeight),
				);
			}

			return Math.min(MAX_RACE_OPPONENT_WIDTH, Math.max(0, largestWidth));
		}, [active.length, containerSize.width, containerSize.height]);

		const cardHeight = cardWidth ? getRaceCardHeight(cardWidth) : undefined;

		return (
			<div
				className="scrollbar-gutter-stable min-h-0 min-w-0 flex-1 overflow-auto p-1"
				ref={ref}
			>
				<div className="flex flex-wrap content-start justify-evenly gap-2">
					<AnimatePresence mode="popLayout">
						{active.map((opponent) => {
							const denominator = Math.max(1, qualifyingCount);
							const progress = Math.min(
								1,
								opponent.completedWords / denominator,
							);

							return (
								<motion.div
									animate={{ opacity: 1, scale: 1 }}
									className="flex min-w-0 flex-col items-center justify-between gap-y-1.5 rounded-lg bg-zinc-100 p-2 shadow-md"
									exit={{ opacity: 0, scale: 0.7 }}
									initial={{ opacity: 0, scale: 0.7 }}
									key={opponent.id}
									layout
									style={
										cardWidth
											? { width: cardWidth, height: cardHeight }
											: undefined
									}
									transition={{ duration: 0.25, ease: "easeOut" }}
								>
									<div className="flex w-full items-center justify-between gap-x-1">
										<span className="font-semibold text-[9px] leading-none">
											{getInitials(opponent.name)}
										</span>
										{opponent.qualified && (
											<span className="grid size-4 place-content-center rounded-full bg-emerald-500 text-white">
												<Check className="size-3" />
											</span>
										)}
									</div>

									<div className="w-full rounded-full bg-zinc-200/70 p-0.5">
										<div
											className="h-2 rounded-full bg-emerald-400 transition-all duration-500 ease-linear"
											style={{ width: `${progress * 100}%` }}
										/>
									</div>

									<p className="font-semibold text-[0.65rem] text-stone-600 tabular-nums">
										{Math.min(opponent.completedWords, qualifyingCount)} /{" "}
										{qualifyingCount}
									</p>
								</motion.div>
							);
						})}
					</AnimatePresence>
				</div>
			</div>
		);
	},
);

RaceOpponents.displayName = "RaceOpponents";

export default RaceOpponents;
