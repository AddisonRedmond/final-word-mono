import { useEffect, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import CountDownTimer from "../game-components/timer";
import type { Game } from "@/types/game";
type BattleRoyaleProps = {
  socketRef: RefObject<Socket | null>;
};

const BattleRoyale = ({ socketRef }: BattleRoyaleProps) => {
  const [lobby, setLobby] = useState<Game>();

  const getSocket = () => socketRef.current;

  const sendGuess = (word: string) => {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      console.warn("Cannot send guess: socket is not connected");
      return;
    }

    socket.emit("guess", { word });
  };

  const sendJoin = () => {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      console.warn("Cannot join: socket is not connected");
      return;
    }

    socket.emit("join");
  };

  const leave = () => {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      return;
    }

    socket.emit("leave", () => {
      socket.disconnect();
    });
  };

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

    sendJoin();
    return () => {
      socket.off("guess:ack", handleGuessAck);
      socket.off("join:ack", handleJoinAck);
      socket.off("lobby:update", handleLobbyUpdate);
    };
  }, [socketRef]);

  return (
    <div className="flex flex-col items-center gap-3">
      <CountDownTimer
        expiryTimestamp={lobby?.room?.startTime}
        timerTitle="Game Starting"
      />
      <div className="flex gap-2">
        <button onClick={() => leave()}>Leave</button>
      </div>

      <pre className="mt-3 max-w-md whitespace-pre-wrap wrap-break-words rounded-md bg-slate-100 p-3 text-xs text-slate-700">
        {JSON.stringify(lobby, null, 2)}
      </pre>
    </div>
  );
};

export default BattleRoyale;
