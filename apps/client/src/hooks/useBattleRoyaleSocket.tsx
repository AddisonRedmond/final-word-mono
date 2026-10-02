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
};

export const useBattleRoyaleSocket = ({
	socketRef,
	setLobby,
	setJoinError,
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

		socket.on("guess:ack", handleGuessAck);
		socket.on("join:ack", handleJoinAck);
		socket.on("lobby:update", handleLobbyUpdate);
		socket.on("join:error", handleJoinError);
		socket.emit("join");

		return () => {
			socket.off("guess:ack", handleGuessAck);
			socket.off("join:ack", handleJoinAck);
			socket.off("lobby:update", handleLobbyUpdate);
			socket.off("join:error", handleJoinError);
		};
	}, [setLobby, setJoinError, socketRef]);
};
