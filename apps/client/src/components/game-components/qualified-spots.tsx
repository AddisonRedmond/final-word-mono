import { CheckCircle2 } from "lucide-react";

type QualifiedSpotsProps = {
	/** How many players have qualified this round (completed the word target). */
	qualified: number;
	/** Total advancing spots this round (alive - eliminated). */
	totalSpots: number;
};

/**
 * Compact "N / M qualified" indicator for the in-round Race view. `N` is how
 * many players have hit the round's Qualifying_Count so far; `M` is the number
 * of advancing spots this round (the field size minus the round's percentage
 * elimination). Note qualifying isn't the only way to advance — if fewer than
 * `M` players qualify, the top-ranked non-qualified players fill the remaining
 * spots — so this reads as "how many have locked in a spot via the word target,
 * out of the spots available".
 */
const QualifiedSpots: React.FC<QualifiedSpotsProps> = ({
	qualified,
	totalSpots,
}) => {
	return (
		<div
			aria-label={`${qualified} of ${totalSpots} qualifying spots filled`}
			className="flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-600 text-xs tabular-nums"
			role="status"
		>
			<CheckCircle2 className="size-3.5" />
			<span>
				{qualified} / {totalSpots} qualified
			</span>
		</div>
	);
};

export default QualifiedSpots;
