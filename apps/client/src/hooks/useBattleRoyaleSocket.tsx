import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
} from "react";
import type { Socket } from "socket.io-client";
import type { ClientGame } from "@/types/battle-royale.types";

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
	useEffect(() => {
		const socket = socketRef.current;
		if (!socket) {
			return;
		}

		const handleGuessAck = (payload: Record<string, unknown>) => {};

		const handleJoinAck = (payload: ClientGame) => {
			setLobby(payload);
		};

		const handleLobbyUpdate = (payload: ClientGame) => {
			setLobby(payload);
		};

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
