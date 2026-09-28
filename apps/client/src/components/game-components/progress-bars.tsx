import { domAnimation, LazyMotion, m } from "motion/react";

type ProgressBarsProps = {
	/** Total number of segments to render (e.g. the round's qualifying count). */
	total: number;
	/** How many segments are filled (e.g. words completed this round). */
	filled: number;
	/** Optional accessible label describing what the bars represent. */
	label?: string;
};

/**
 * A row of segmented progress bars: `total` slots, the first `filled` of which
 * animate to full. Used for Race round progress — three empty bars that each
 * fill (left-to-right) as the player completes a word toward the round's
 * Qualifying_Count, replacing the plain "N / M" text.
 *
 * Purely presentational and mode-agnostic, so other game modes can reuse it for
 * any "X of Y steps done" indicator.
 */
const ProgressBars: React.FC<ProgressBarsProps> = ({
	total,
	filled,
	label,
}) => {
	const clampedTotal = Math.max(0, Math.floor(total));
	const clampedFilled = Math.max(0, Math.min(filled, clampedTotal));

	return (
		<LazyMotion features={domAnimation} strict>
			<div
				aria-label={label}
				aria-valuemax={clampedTotal}
				aria-valuemin={0}
				aria-valuenow={clampedFilled}
				className="flex items-center gap-1.5"
				role="progressbar"
			>
				{Array.from({ length: clampedTotal }, (_, index) => {
					const isFilled = index < clampedFilled;
					return (
						<div
							className="h-2.5 w-10 overflow-hidden rounded-full bg-white/15 shadow-inner"
							// Fixed-length positional row of segments; index is a stable key.
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar row that never reorders
							key={index}
						>
							<m.div
								animate={{ width: isFilled ? "100%" : "0%" }}
								className="h-full rounded-full bg-emerald-400"
								data-filled={isFilled}
								initial={{ width: "0%" }}
								transition={{ duration: 0.45, ease: "easeOut" }}
							/>
						</div>
					);
				})}
			</div>
		</LazyMotion>
	);
};

export default ProgressBars;
