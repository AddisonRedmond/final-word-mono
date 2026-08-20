import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Socket } from "socket.io-client";
import type { Game } from "@/types/game";

type UseBattleRoyaleSocketProps = {
  socketRef: RefObject<Socket | null>;
  setLobby: Dispatch<SetStateAction<Game | undefined>>;
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

    const handleJoinAck = (payload: Game) => {
      setLobby(payload);
    };

    const handleLobbyUpdate = (payload: Game) => {
      setLobby(payload);
    };

    socket.on("guess:ack", handleGuessAck);
    socket.on("join:ack", handleJoinAck);
    socket.on("lobby:update", handleLobbyUpdate);
    socket.emit("join");

    return () => {
      socket.off("guess:ack", handleGuessAck);
      socket.off("join:ack", handleJoinAck);
      socket.off("lobby:update", handleLobbyUpdate);
    };
  }, [setLobby, socketRef]);
};
