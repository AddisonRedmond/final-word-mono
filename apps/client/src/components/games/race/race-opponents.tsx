import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";
import type { RacePlayer } from "@/types/race.types";
import { getInitials } from "@/utils/opponents";

export type RaceOpponent = RacePlayer & { id: string };

type RaceOpponentsProps = {
	/** Non-self players to render in this flanking column. */
	opponents: RaceOpponent[];
	/** Words needed to qualify this round; drives the progress bar. */
	qualifyingCount: number;
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
		const active = opponents.filter((opponent) => !opponent.isEliminated);

		return (
			<div className="scrollbar-gutter-stable min-h-0 min-w-0 flex-1 overflow-auto p-1">
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
									className="flex w-28 flex-col items-center gap-y-1.5 rounded-lg bg-zinc-100 p-2 shadow-md"
									exit={{ opacity: 0, scale: 0.7 }}
									initial={{ opacity: 0, scale: 0.7 }}
									key={opponent.id}
									layout
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
