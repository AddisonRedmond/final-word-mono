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
};

type GuessTilesProps = {
	slots: TileSlot[];
	className?: string;
};

/**
 * Tile edge length. Below `lg` the tile scales with the viewport so a 5-tile row
 * fits a narrow phone (width term) and a stack of queued rows fits a short one
 * (dvh term), clamped to 40px-56px. From `lg` up it's the fixed 56px (size-14).
 * `size-14` stays as the base class (tests and desktop rely on it); `max-lg:`
 * overrides it on smaller screens.
 */
export const boardTileSizeClass =
	"size-14 max-lg:size-[clamp(2.5rem,min(calc((100vw_-_4.5rem)/5),7.5dvh),3.5rem)]";

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
						className={`relative grid ${boardTileSizeClass} place-content-center rounded-lg font-display text-xl uppercase ${
							tileStateClasses[slot.state ?? "default"]
						}`}
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row that never reorders, so the index is a stable key
						key={index}
					>
						{slot.cornerHint && (
							<p className="absolute top-0.5 right-0.5 text-xs">
								{slot.cornerHint}
							</p>
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
