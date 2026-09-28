import type { RoundTransition as RoundTransitionPayload } from "@/hooks/useRaceSocket";
import type { ClientRaceMatch } from "@/types/race.types";
import MatchTimer from "../../game-components/match-timer";

type RoundTransitionProps = {
	/** Current match snapshot from the Race socket. */
	match: ClientRaceMatch;
	/** Latest round-end summary from `round:transition` (kept for the ended-round number). */
	transition: RoundTransitionPayload | undefined;
};

/**
 * Intermission view shown between rounds (Req 10.3).
 *
 * Any player who reaches this view has ADVANCED: an eliminated player is routed
 * to `EliminationView` by the root (`race.tsx`), which takes precedence over the
 * intermission phase. So rather than listing who advanced vs who was eliminated,
 * this simply congratulates the surviving player and counts down to the next
 * round using the shared `MatchTimer`, which counts down to the server-stamped
 * `room.nextRoundStartsAt` (clock-skew corrected).
 */
const RoundTransition: React.FC<RoundTransitionProps> = ({
	match,
	transition,
}) => {
	// `round:transition.roundIndex` is the round that just ended (0-based); the
	// next round is one higher (1-based for display).
	const nextRoundNumber =
		transition?.roundIndex !== undefined
			? transition.roundIndex + 2
			: match.room.currentRoundIndex + 1;

	return (
		<div className="flex flex-col items-center gap-5 text-center">
			<div className="flex flex-col items-center gap-1">
				<p className="font-black text-2xl text-emerald-500">You qualified!</p>
				<p className="font-semibold text-sm text-stone-500">
					Get ready for round {nextRoundNumber}
				</p>
			</div>

			<MatchTimer
				expiryTimestamp={match.room.nextRoundStartsAt}
				label="Next round in"
			/>
		</div>
	);
};

export default RoundTransition;
