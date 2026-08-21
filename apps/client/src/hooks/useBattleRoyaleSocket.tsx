import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Socket } from "socket.io-client";
import type { ClientGame } from "@/types/game";

type UseBattleRoyaleSocketProps = {
  socketRef: RefObject<Socket | null>;
  setLobby: Dispatch<SetStateAction<ClientGame | undefined>>;
};

export const useBattleRoyaleSocket = ({
  socketRef,
  setLobby,
}: UseBattleRoyaleSocketProps) => {
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const handleGuessAck = (payload: Record<string, unknown>) => {
      console.log("EMITTED");
      console.log(JSON.stringify(payload));
    };

    const handleJoinAck = (payload: ClientGame) => {
      setLobby(payload);
    };

    const handleLobbyUpdate = (payload: ClientGame) => {
      setLobby(payload);
    };

    const handleJoinError = () => {
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
  }, [setLobby, socketRef]);
};
