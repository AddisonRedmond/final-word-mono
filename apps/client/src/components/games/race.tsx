import { motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { useRaceSocket } from "@/hooks/useRaceSocket";
import { RACE_CONFIG } from "@/shared/race";
import EliminationView from "./race/elimination-view";
import LobbyView from "./race/lobby-view";
import type { RaceOpponent } from "./race/race-opponents";
import RaceOpponents from "./race/race-opponents";
import ResultView from "./race/result-view";
import RoundBoard from "./race/round-board";
import RoundTransition from "./race/round-transition";

type RaceProps = {
	/** This player's id (used to key their own row/state in the sub-views). */
	userId: string;
	/** Supabase access token used to authenticate the `/race` websocket. */
	token: string | undefined;
	/** Exit-to-menu callback from the home page; un-mounts the game view. */
	onLeave: () => void;
	/**
	 * Feature: anonymous-sign-in — reports a realtime `join:error` reason up to
	 * the home screen so a persistent guest-limit notice can be shown there after
	 * this view un-mounts (R6.5). Optional and additive.
	 */
	onJoinError?: (reason: string | undefined) => void;
};

/**
 * Race_Mode root, restructured to mirror Battle Royale's `battle-royale.tsx`
 * flanking layout: two opponent columns flank a central play area that holds
 * the timer, board, keyboard, and leave/overlay states. It holds the
 * `ClientRaceMatch` snapshot via `useRaceSocket` and switches the central view
 * on `room.phase` (Req 10.1–10.5). Race is a solo race-to-qualify with
 * independent per-player words, so the root holds and subscribes to NO
 * attack/targeting state — only the lifecycle state the hook exposes.
 */
const Race: React.FC<RaceProps> = ({ userId, token, onLeave, onJoinError }) => {
	const {
		match,
		transition,
		elimination,
		result,
		lastAck,
		joinError,
		sendGuess,
		leave,
	} = useRaceSocket({ token, onLeave });

	// Feature: anonymous-sign-in — on a match-start block, report the reason up
	// and leave the game so Race un-mounts back to the menu, exactly like Battle
	// Royale (whose socket disconnect does this implicitly). The home screen then
	// shows the single, dismissible play-limit notice for both modes.
	useEffect(() => {
		if (joinError) {
			onJoinError?.(joinError);
			onLeave();
		}
	}, [joinError, onJoinError, onLeave]);

	// Split the non-self roster into two flanking columns, matching Battle
	// Royale's even/odd split.
	const { evenOpponents, oddOpponents } = useMemo(() => {
		const evenOpponents: RaceOpponent[] = [];
		const oddOpponents: RaceOpponent[] = [];

		if (!match?.players) {
			return { evenOpponents, oddOpponents };
		}

		Object.entries(match.players).forEach(([id, player], index) => {
			if (id === userId) {
				return;
			}
			if (index % 2 === 0) {
				evenOpponents.push({ ...player, id });
			} else {
				oddOpponents.push({ ...player, id });
			}
		});

		return { evenOpponents, oddOpponents };
	}, [match?.players, userId]);

	const qualifyingCount = match
		? (RACE_CONFIG.rounds[match.room.currentRoundIndex]?.qualifyingCount ?? 1)
		: 1;

	const renderCenter = () => {
		// Feature: anonymous-sign-in — on a match-start block Race leaves (see the
		// effect above), so this view is un-mounting; show nothing rather than a
		// stuck "Connecting…". The dismissible notice shows on the home screen.
		if (joinError) {
			return null;
		}

		// No snapshot yet: we've connected/joined but haven't received the first
		// `join:ack`/`race:update`.
		if (!match) {
			return <p className="font-semibold text-sm">Connecting…</p>;
		}

		// Elimination takes precedence over the round/intermission phases: once
		// this player is out, show their placement regardless of match phase, up
		// until the match itself finishes (which shows the full result view).
		const isEliminated = match.players[userId]?.isEliminated ?? false;
		if (isEliminated && match.room.phase !== "finished") {
			return (
				<EliminationView
					elimination={elimination}
					onLeave={leave}
					player={match.players[userId]}
				/>
			);
		}

		switch (match.room.phase) {
			case "lobby":
				return <LobbyView match={match} onLeave={leave} userId={userId} />;
			case "round":
				return (
					<RoundBoard
						lastAck={lastAck}
						match={match}
						onGuess={sendGuess}
						onLeave={leave}
						userId={userId}
					/>
				);
			case "intermission":
				return <RoundTransition match={match} transition={transition} />;
			case "finished":
				return (
					<ResultView
						match={match}
						onLeave={leave}
						result={result}
						userId={userId}
					/>
				);
			default:
				return null;
		}
	};

	// Only flank the central area with opponents during the live phases; the
	// Flank the central board with opponents during the lobby and the live
	// phases (they join/leave the flanking columns in real time), matching Battle
	// Royale. The finished/overlay states read cleaner centred on their own.
	const showOpponents =
		match?.room.phase === "lobby" ||
		match?.room.phase === "round" ||
		match?.room.phase === "intermission";

	return (
		<motion.div
			animate={{ scale: 1, opacity: 100 }}
			className="flex min-h-0 w-full grow py-5"
			exit={{ scale: 0, opacity: 0 }}
			initial={{ scale: 0, opacity: 0 }}
		>
			{showOpponents ? (
				<RaceOpponents
					opponents={evenOpponents}
					qualifyingCount={qualifyingCount}
				/>
			) : (
				<div className="min-w-0 flex-1" />
			)}

			<div className="mx-5 flex flex-col items-center justify-center gap-3">
				{renderCenter()}
			</div>

			{showOpponents ? (
				<RaceOpponents
					opponents={oddOpponents}
					qualifyingCount={qualifyingCount}
				/>
			) : (
				<div className="min-w-0 flex-1" />
			)}
		</motion.div>
	);
};

export default Race;
