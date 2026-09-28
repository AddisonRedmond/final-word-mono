import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { env } from "@/env";
import { useServerClockStore } from "@/state/server-clock-store";
import type { ClientRaceMatch, LetterFeedback } from "@/types/race.types";

/**
 * Payloads for the Race lifecycle events, matching the server broadcast
 * contract (see design "Socket Contract"). Race is a solo race-to-qualify with
 * independent per-player words: there are NO attack/targeting events or fields.
 */
export type RoundTransition = {
	roundIndex: number;
	advanced: string[];
	eliminated: string[];
};

export type EliminatedEvent = { placement: number };

/** One entry of the `match:result` placements list, as sent by the server. */
export type ResultPlacement = { playerId: string; placement: number };

export type MatchResult = {
	winnerId?: string;
	// Winner-first ranking over the full field (bots included), each entry a
	// { playerId, placement } object (NOT a bare id string).
	placements: ResultPlacement[];
};

export type GuessAck = {
	isMatch: boolean;
	perLetter: LetterFeedback[];
	throttled?: boolean;
};

type UseRaceSocketProps = {
	/** Supabase access token used to authenticate the `/race` websocket. */
	token: string | undefined;
	/**
	 * Invoked when the player leaves the match so the parent can un-mount the
	 * game view (mirrors Battle Royale's disconnect-driven exit).
	 */
	onLeave?: () => void;
};

export type UseRaceSocketResult = {
	/** Current lobby/match snapshot from `join:ack` / `race:update`. */
	match: ClientRaceMatch | undefined;
	/** Latest round-end summary from `round:transition`. */
	transition: RoundTransition | undefined;
	/** This player's elimination outcome from `eliminated`. */
	elimination: EliminatedEvent | undefined;
	/** Final match result from `match:result`. */
	result: MatchResult | undefined;
	/** Latest per-letter grading feedback from `guess:ack`. */
	lastAck: GuessAck | undefined;
	/** Whether the underlying socket is currently connected. */
	isConnected: boolean;
	/** Emit a guess for the player's current word. */
	sendGuess: (guess: string) => void;
	/** Leave the current lobby/match. */
	leave: () => void;
};

/**
 * Connects to the `/race` namespace, emits `join` on mount, and manages the
 * client-side Race state from the server events. Parallels
 * `useBattleRoyaleSocket` for the connection/subscription/cleanup pattern only;
 * it intentionally subscribes to no attack-related events and holds no
 * attack-related state.
 */
export const useRaceSocket = ({
	token,
	onLeave,
}: UseRaceSocketProps): UseRaceSocketResult => {
	const socketRef = useRef<Socket | null>(null);

	const [match, setMatch] = useState<ClientRaceMatch>();
	const [transition, setTransition] = useState<RoundTransition>();
	const [elimination, setElimination] = useState<EliminatedEvent>();
	const [result, setResult] = useState<MatchResult>();
	const [lastAck, setLastAck] = useState<GuessAck>();
	const [isConnected, setIsConnected] = useState(false);

	useEffect(() => {
		if (!token) {
			return;
		}

		const base = env.NEXT_PUBLIC_WS_URL;
		const socket = io(`${base}/race`, {
			path: "/socket.io",
			auth: { token },
			transports: ["websocket"],
		});
		socketRef.current = socket;

		const handleConnect = () => {
			setIsConnected(true);
			// Correct for client/server clock skew so round timers and countdowns
			// reflect the server's clock before we render them.
			void useServerClockStore.getState().sync(socket);
			socket.emit("join");
		};

		const handleDisconnect = () => {
			setIsConnected(false);
		};

		const handleJoinAck = (payload: ClientRaceMatch) => {
			setMatch(payload);
		};

		const handleRaceUpdate = (payload: ClientRaceMatch) => {
			setMatch(payload);
		};

		const handleRoundTransition = (payload: RoundTransition) => {
			setTransition(payload);
		};

		const handleEliminated = (payload: EliminatedEvent) => {
			setElimination(payload);
		};

		const handleMatchResult = (payload: MatchResult) => {
			setResult(payload);
		};

		const handleGuessAck = (payload: GuessAck) => {
			setLastAck(payload);
		};

		const handleJoinError = () => {
			socket.disconnect();
		};

		socket.on("connect", handleConnect);
		socket.on("disconnect", handleDisconnect);
		socket.on("join:ack", handleJoinAck);
		socket.on("race:update", handleRaceUpdate);
		socket.on("round:transition", handleRoundTransition);
		socket.on("eliminated", handleEliminated);
		socket.on("match:result", handleMatchResult);
		socket.on("guess:ack", handleGuessAck);
		socket.on("join:error", handleJoinError);

		return () => {
			socket.off("connect", handleConnect);
			socket.off("disconnect", handleDisconnect);
			socket.off("join:ack", handleJoinAck);
			socket.off("race:update", handleRaceUpdate);
			socket.off("round:transition", handleRoundTransition);
			socket.off("eliminated", handleEliminated);
			socket.off("match:result", handleMatchResult);
			socket.off("guess:ack", handleGuessAck);
			socket.off("join:error", handleJoinError);
			socket.disconnect();
			socketRef.current = null;
			useServerClockStore.getState().reset();
		};
	}, [token]);

	const sendGuess = useCallback((guess: string) => {
		const socket = socketRef.current;
		if (!socket?.connected) {
			console.warn("Cannot send guess: socket is not connected");
			return;
		}
		socket.emit("guess", { guess });
	}, []);

	const leave = useCallback(() => {
		const socket = socketRef.current;
		if (socket?.connected) {
			// Mirror Battle Royale: tell the server we're leaving, then disconnect
			// in the ack callback. The server `leave` handler accepts an optional
			// ack `(response) => void`, so passing one is compatible.
			socket.emit("leave", () => {
				socket.disconnect();
			});
		}
		// Always notify the parent so the UI exits even if the socket is already
		// gone (e.g. connection dropped before the user clicked Leave).
		onLeave?.();
	}, [onLeave]);

	return {
		match,
		transition,
		elimination,
		result,
		lastAck,
		isConnected,
		sendGuess,
		leave,
	};
};
