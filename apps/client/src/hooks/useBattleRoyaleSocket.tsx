import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
} from "react";
import type { Socket } from "socket.io-client";
import {
	type BroadcastInput,
	initialReducerState,
	reduceEnvelope,
	type ReducerState,
} from "@/shared/broadcast-reducer";
import type {
	ClientBattleRoyalePlayer,
	ClientBattleRoyaleRoom,
	ClientGame,
} from "@/types/battle-royale.types";

type UseBattleRoyaleSocketProps = {
	socketRef: RefObject<Socket | null>;
	setLobby: Dispatch<SetStateAction<ClientGame | undefined>>;
	/**
	 * Feature: anonymous-sign-in — optional sink for the `join:error` reason so
	 * the UI can map `guest-mode-limit` to the guest sign-up prompt (R6.5).
	 * Optional and additive: omitting it leaves the pre-existing disconnect-only
	 * behavior unchanged, and removing the guest feature is a single-edit cleanup.
	 */
	setJoinError?: Dispatch<SetStateAction<string | undefined>>;
	/**
	 * v1 play-with-friends — optional share code. When present it is sent with
	 * `join` so the server routes this socket into that specific public room
	 * instead of the open-lobby scan. Omitted for a normal public join.
	 */
	joinCode?: string;
	/**
	 * v1 play-with-friends — optional sink for the `join:notice` reason. The
	 * server emits `room-unavailable` when a share-code join falls back to normal
	 * matchmaking (the coded room was missing/started/full), so the UI can tell
	 * the player they didn't land with their friend. Unlike `join:error`, a
	 * notice does NOT tear down the socket — the player is still in a game.
	 */
	setJoinNotice?: Dispatch<SetStateAction<string | undefined>>;
};

export const useBattleRoyaleSocket = ({
	socketRef,
	setLobby,
	setJoinError,
	joinCode,
	setJoinNotice,
}: UseBattleRoyaleSocketProps) => {
	// Sequence-aware reducer state (realtime-broadcast-scaling task 7.2). Held in
	// a ref so it persists across `join:ack` / `lobby:update` events without
	// re-rendering; the rendered snapshot flows into the lobby via `setLobby`.
	// Reset to a fresh base whenever the subscribed socket changes so a new
	// connection starts from `initialReducerState()`.
	const reducerRef = useRef<
		ReducerState<ClientBattleRoyaleRoom, ClientBattleRoyalePlayer>
	>(initialReducerState<ClientBattleRoyaleRoom, ClientBattleRoyalePlayer>());

	useEffect(() => {
		const socket = socketRef.current;
		if (!socket) {
			return;
		}

		// Fresh connection → fresh reducer base (no stale seq/resync carried over).
		reducerRef.current = initialReducerState<
			ClientBattleRoyaleRoom,
			ClientBattleRoyalePlayer
		>();

		const handleGuessAck = (payload: Record<string, unknown>) => {};

		/**
		 * Feed one state broadcast (keyframe/delta envelope when the delta flag is
		 * on, or a bare full Trimmed_Snapshot when it is off) through the pure
		 * sequence-aware reducer, adopt the new state, and render the reduced
		 * snapshot. On a detected Sequence_Number gap the reducer asks for a
		 * resync; we emit it and the server replies with a fresh keyframe on this
		 * same `lobby:update` event (Req 4.4). One-in-flight is enforced by the
		 * reducer. `removedPlayers` deletions happen in `applyDelta`, so the
		 * rendered opponents view tracks the authoritative field (Req 4.6).
		 */
		const handleBroadcast = (
			input: BroadcastInput<ClientBattleRoyaleRoom, ClientBattleRoyalePlayer>,
		) => {
			const { state, effect } = reduceEnvelope(reducerRef.current, input);
			reducerRef.current = state;
			if (state.snapshot !== undefined) {
				setLobby(state.snapshot);
			}
			if (effect === "request-resync") {
				socket.emit("resync");
			}
		};

		// `join:ack` carries a keyframe (flag on) or a bare full snapshot (flag
		// off); `lobby:update` carries a keyframe or a delta (flag on) or a bare
		// snapshot (flag off). Both ride the reducer so the client stays correct
		// in either mode and detects gaps (Req 4.1–4.6, 4.8).
		const handleJoinAck = handleBroadcast;
		const handleLobbyUpdate = handleBroadcast;

		const handleJoinError = (payload?: { reason?: string }) => {
			// Feature: anonymous-sign-in — surface the error reason so the UI can map
			// `guest-mode-limit` to the guest sign-up prompt (R6.5). The socket is
			// still torn down, as before.
			setJoinError?.(payload?.reason);
			socket.disconnect();
		};

		const handleJoinNotice = (payload?: { reason?: string }) => {
			// v1 play-with-friends — a share-code join fell back to normal
			// matchmaking (coded room missing/started/full). Surface the reason; the
			// socket stays connected because the player IS in a game.
			setJoinNotice?.(payload?.reason);
		};

		socket.on("guess:ack", handleGuessAck);
		socket.on("join:ack", handleJoinAck);
		socket.on("lobby:update", handleLobbyUpdate);
		socket.on("join:error", handleJoinError);
		socket.on("join:notice", handleJoinNotice);
		// Send the share code with the join when the player is trying to join a
		// friend's room; omit it entirely for a normal public join.
		socket.emit("join", joinCode ? { code: joinCode } : undefined);

		return () => {
			socket.off("guess:ack", handleGuessAck);
			socket.off("join:ack", handleJoinAck);
			socket.off("lobby:update", handleLobbyUpdate);
			socket.off("join:error", handleJoinError);
			socket.off("join:notice", handleJoinNotice);
		};
	}, [setLobby, setJoinError, socketRef, joinCode, setJoinNotice]);
};
