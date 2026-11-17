import { Bot, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ClientRacePlayer } from "@/types/race.types";
import {
	GAP,
	getInitials,
	getRaceCardHeight,
	getRaceRevealTileSize,
	getRaceWidthForHeight,
	MAX_RACE_OPPONENT_WIDTH,
	RACE_HEADER_HEIGHT,
	RACE_SECTION_GAP,
	RACE_TILE_GAP,
} from "@/utils/opponents";

// Spare pixels left when fitting cards to the column, so sub-pixel rounding
// can't push the grid a fraction past the column and show a scrollbar.
const FIT_MARGIN = 4;
// Below ~7px a glyph is an unreadable smudge; the lime fill alone shows it.
const MIN_LEGIBLE_TILE = 7;

// Opponent cards render off the trimmed broadcast player (ClientRacePlayer),
// not the full authoritative RacePlayer — the dropped server-only fields are
// never on the wire.
export type RaceOpponent = ClientRacePlayer & { id: string };

type RaceOpponentsProps = {
	/** Non-self players to render in this flanking column. */
	opponents: RaceOpponent[];
	/** Words needed to qualify this round; drives the progress bar. */
	qualifyingCount: number;
	/** Letters in the current word; sets how many reveal tiles each card shows. */
	wordLength?: number;
	/**
	 * Render a robot icon instead of each opponent's initials. Used by the
	 * client-side PRACTICE mode, where every opponent is a bot and showing a
	 * robot makes that honest (vs. the live game, which shows real players'
	 * initials). Defaults to initials.
	 */
	showBotIcon?: boolean;
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
	({
		opponents,
		qualifyingCount,
		wordLength = 5,
		showBotIcon = false,
	}: RaceOpponentsProps) => {
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

				// Round DOWN so the measured column is never bigger than it is.
				const width = Math.floor(entry.contentRect.width);
				const height = Math.floor(entry.contentRect.height);

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

			const usableWidth = containerSize.width - FIT_MARGIN;
			const usableHeight = containerSize.height - FIT_MARGIN;

			let largestWidth = 0;
			for (let columns = 1; columns <= count; columns++) {
				const rows = Math.ceil(count / columns);
				const availableWidth = (usableWidth - GAP * (columns - 1)) / columns;
				const availableHeight = (usableHeight - GAP * (rows - 1)) / rows;
				const maxWidthFromHeight = getRaceWidthForHeight(
					availableHeight,
					wordLength,
				);
				largestWidth = Math.max(
					largestWidth,
					Math.min(availableWidth, maxWidthFromHeight),
				);
			}

			// Whole pixels, rounded down, so the total can't creep past the box.
			return Math.floor(
				Math.min(MAX_RACE_OPPONENT_WIDTH, Math.max(0, largestWidth)),
			);
		}, [active.length, containerSize.width, containerSize.height, wordLength]);

		const cardHeight = cardWidth
			? getRaceCardHeight(cardWidth, wordLength)
			: undefined;

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

							// Found letters = the helper's free reveals plus the opponent's
							// own correct positions on their current word.
							const revealed = {
								...(opponent.hintRevealed ?? {}),
								...(opponent.revealedLetters ?? {}),
							};
							const tileSize = getRaceRevealTileSize(cardWidth || 100, wordLength);

							return (
								<motion.div
									animate={{ opacity: 1, scale: 1 }}
									className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-panel-2/80 p-1 shadow-lg ${
										opponent.qualified ? "border-lime/60" : "border-white/10"
									}`}
									exit={{ opacity: 0, scale: 0.7 }}
									initial={{ opacity: 0, scale: 0.7 }}
									key={opponent.id}
									layout
									style={{
										...(cardWidth ? { width: cardWidth, height: cardHeight } : {}),
										gap: RACE_SECTION_GAP,
									}}
									transition={{ duration: 0.25, ease: "easeOut" }}
								>
									{/* Header: who, round progress bar, and words solved. */}
									<div
										className="flex w-full shrink-0 items-center gap-x-1"
										style={{ height: RACE_HEADER_HEIGHT }}
									>
										{showBotIcon ? (
											<Bot
												aria-label="Bot opponent"
												className="size-2.75 shrink-0 text-gray-500"
											/>
										) : (
											<span className="shrink-0 rounded-[3px] bg-graphite px-1 font-display text-[7px] text-white/80 uppercase leading-[11px]">
												{getInitials(opponent.name)}
											</span>
										)}
										{/* Round progress, inline with the initials. */}
										<div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
											<div
												className="h-full rounded-full bg-lime transition-all duration-500 ease-linear"
												style={{ width: `${progress * 100}%` }}
											/>
										</div>
										{opponent.qualified ? (
											<span
												aria-label="Qualified"
												role="img"
												className="grid size-2.75 shrink-0 place-content-center rounded-full bg-lime text-ink"
											>
												<Check className="size-2" strokeWidth={4} />
											</span>
										) : (
											<span className="truncate font-semibold text-[7px] text-gray-500 tabular-nums leading-none">
												{Math.min(opponent.completedWords, qualifyingCount)}/
												{qualifyingCount}
											</span>
										)}
									</div>

									<div
										aria-label="Letters found in current word"
										className="flex"
										role="img"
										style={{ gap: RACE_TILE_GAP }}
									>
										{Array.from({ length: wordLength }, (_, index) => {
											const letter = revealed[index];
											return (
												<div
													className={`grid place-content-center rounded-[3px] font-display leading-none ${
														letter ? "bg-lime text-ink" : "bg-white/[0.06]"
													}`}
													// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row
													key={index}
													style={{
														width: tileSize,
														height: tileSize,
														fontSize: tileSize * 0.62,
													}}
												>
													{tileSize >= MIN_LEGIBLE_TILE ? (letter ?? "") : ""}
												</div>
											);
										})}
									</div>

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
