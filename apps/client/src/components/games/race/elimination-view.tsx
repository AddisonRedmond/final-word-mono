import { AnimatePresence, motion } from "motion/react";
import type { EliminatedEvent } from "@/hooks/useRaceSocket";
import type { RacePlayer } from "@/types/race.types";

type EliminationViewProps = {
	/** This player's elimination outcome from `eliminated`. */
	elimination: EliminatedEvent | undefined;
	/** This player's snapshot (for the stat grid + placement fallback). */
	player: RacePlayer | undefined;
	/** Leave the match. */
	onLeave: () => void;
};

/** Turn a 1-based placement into an ordinal label ("1st", "2nd", "3rd"…). */
const ordinal = (n: number): string => {
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) {
		return `${n}th`;
	}
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
};

/**
 * Elimination view (Req 10.4), restyled to match Battle Royale's `Eliminated`
 * card: a red "ELIMINATED" header, the player name, a three-cell stat grid, and
 * a Leave button. The placement comes from the `eliminated` payload the server
 * sends when it applies elimination (Req 5.9), falling back to the snapshot's
 * persisted `player.placement` if the payload hasn't arrived yet.
 */
const EliminationView: React.FC<EliminationViewProps> = ({
	elimination,
	player,
	onLeave,
}) => {
	const placement = elimination?.placement ?? player?.placement;

	return (
		<AnimatePresence>
			<motion.div
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				initial={{ opacity: 0 }}
				transition={{ duration: 0.4 }}
			>
				<div className="relative z-10 flex h-full w-full items-center justify-center">
					<motion.div
						animate={{ scale: 1, opacity: 1 }}
						className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-red-500/70 bg-zinc-950/90 text-white shadow-2xl"
						initial={{ scale: 0.8, opacity: 0 }}
						transition={{
							delay: 0.15,
							duration: 0.5,
							type: "spring",
							stiffness: 180,
							damping: 15,
						}}
					>
						<div className="border-white/15 border-b bg-red-500 px-6 py-3 text-center font-black text-sm text-zinc-950 tracking-[0.2em]">
							ELIMINATED
						</div>
						<div className="px-6 py-7 text-center">
							<p className="font-medium text-sm text-zinc-400 uppercase tracking-[0.16em]">
								Better luck next time
							</p>
							<h2 className="wrap-break-word mt-2 font-black text-4xl text-red-400 tracking-wide">
								{player?.name ?? "You"}
							</h2>
							{placement !== undefined && (
								<p className="mt-3 font-semibold text-sm text-zinc-300">
									Final placement{" "}
									<span className="font-black text-red-400 uppercase tracking-wider">
										{ordinal(placement)}
									</span>
								</p>
							)}
							<div className="mt-7 grid grid-cols-2 divide-x divide-white/15 border-white/15 border-y py-4">
								<div className="px-2">
									<p className="font-bold text-xl tabular-nums">
										{player?.totalGuesses ?? 0}
									</p>
									<p className="mt-1 font-semibold text-[0.65rem] text-zinc-400 uppercase tracking-wider">
										Guesses
									</p>
								</div>
								<div className="px-2">
									<p className="font-bold text-emerald-300 text-xl tabular-nums">
										{player?.correctGuesses ?? 0}
									</p>
									<p className="mt-1 font-semibold text-[0.65rem] text-zinc-400 uppercase tracking-wider">
										Correct
									</p>
								</div>
							</div>
							<button
								className="mt-7 w-full rounded-md bg-red-500 px-4 py-2.5 font-bold text-sm text-zinc-950 uppercase tracking-wider transition-colors hover:bg-red-400"
								onClick={onLeave}
								type="button"
							>
								Leave
							</button>
						</div>
					</motion.div>
				</div>
			</motion.div>
		</AnimatePresence>
	);
};

export default EliminationView;
