import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { memo } from "react";
import { type LetterState, tileStateClasses } from "@/utils/letter-states";

/**
 * Canonical Wordle-tile styling shared across every game mode. Battle Royale,
 * Race, and any future mode render their guess rows through {@link GuessTiles},
 * so the tile look-and-feel can only be changed in one place and never drifts
 * between modes.
 */
export type TileSlot = {
	/** The letter shown on the tile ("" renders an empty tile). */
	letter?: string;
	/** Grading state that drives the tile colour. */
	state?: LetterState;
	/** Small hint pinned to the tile's top-right corner (e.g. a known letter). */
	cornerHint?: string;
	/**
	 * Replaces the state-derived tile classes for this slot. Opt-in, for a mode
	 * (Battle Royale's current word) that wants its own look; other modes leave
	 * it unset and keep the shared styling.
	 */
	tileClassName?: string;
	/** Tiny caption at the bottom of the tile, shown while it's empty. */
	label?: string;
};

type GuessTilesProps = {
	slots: TileSlot[];
	className?: string;
};

/**
 * A single row of graded guess tiles. Purely presentational: callers map their
 * mode-specific state (an in-progress guess, per-letter feedback, revealed
 * letters, …) into {@link TileSlot}s and this component renders them with the
 * shared styling and pop-in animation.
 */
const GuessTiles = memo<GuessTilesProps>(({ slots, className = "" }) => {
	return (
		<LazyMotion features={domAnimation} strict>
			<div className={`flex items-center justify-evenly gap-2 ${className}`}>
				{slots.map((slot, index) => (
					<div
						className={`relative grid size-14 place-content-center rounded-lg font-display text-xl uppercase ${
							slot.tileClassName ?? tileStateClasses[slot.state ?? "default"]
						}`}
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row that never reorders, so the index is a stable key
						key={index}
					>
						{slot.cornerHint && (
							<p className="absolute top-0.5 right-0.5 text-xs">
								{slot.cornerHint}
							</p>
						)}
						{!slot.letter && slot.label && (
							<span
								aria-hidden="true"
								className="absolute bottom-1 left-0 w-full text-center font-bold font-sans text-[7px] tracking-[0.15em] opacity-80"
							>
								{slot.label}
							</span>
						)}
						<AnimatePresence>
							{slot.letter && (
								<m.p
									animate={{ scale: 1 }}
									exit={{ scale: 0 }}
									initial={{ scale: 0 }}
									key="letter"
								>
									{slot.letter}
								</m.p>
							)}
						</AnimatePresence>
					</div>
				))}
			</div>
		</LazyMotion>
	);
});

GuessTiles.displayName = "GuessTiles";

export default GuessTiles;
