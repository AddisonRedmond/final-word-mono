import { useState, useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useWsStore } from "@/state/useWsStore";
import { useGameStore } from "@/state/useGameStore";
import { useAuth, useAuthStore } from "@/state/useAuthStore";
import { env } from "@/env.js";
import type { ClientMessage } from "types";
import ScrollTile from "../scroll-tile";
import { AttackQueueIndicator } from "./AttackQueueIndicator";
import GameBoard from "./GameBoard";
import GameKeyboard from "./GameKeyboard";
import { GameOverScreen } from "./GameOverScreen";
import { OpponentPanel } from "./OpponentPanel";
import { TargetSelector } from "./TargetSelector";
import OpponentsContainer from "./opponent/OpponentContainer";

type LobbyState = Extract<ClientMessage, { type: "lobby_state" }>;

interface BattleRoyaleProps {
  onLeave: () => void;
}

const WS_URL = env.NEXT_PUBLIC_WS_URL;

export default function BattleRoyale({ onLeave }: BattleRoyaleProps) {
  const status = useWsStore((s) => s.status);
  const sendMessage = useWsStore((s) => s.sendMessage);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [phase, setPhase] = useState<"lobby" | "playing">("lobby");

  const user = useAuth();
  const myUserId = user?.uid ?? null;

  const gameStore = useGameStore();
  const {
    guesses,
    feedbacks,
    currentInput,
    revealedPositions,
    activeWordIsAttack,
    attackQueueSize,
    opponents,
    targetMode,
    targetUserId,
    gameOver,
    setInput,
    deleteLetter,
    submitGuess,
  } = gameStore;

  useWebSocket({
    url: WS_URL,
    onOpen: () => {
      useWsStore.getState().sendMessage({ type: "find_or_create_lobby" });
    },
    onMessage: (msg: ClientMessage) => {
      switch (msg.type) {
        case "lobby_state":
          setLobby(msg);
          break;
        case "game_started":
          useGameStore
            .getState()
            .setGameStarted(
              msg.lobbyId,
              useAuthStore.getState().user?.uid ?? "",
              msg.players,
            );
          setPhase("playing");
          break;
        case "guess_result":
          gameStore.applyGuessResult(msg);
          break;
        case "game_state_update":
          gameStore.applyGameStateUpdate(msg);
          break;
        case "player_health_update":
          gameStore.applyHealthUpdate(msg);
          break;
        case "attack_word":
          gameStore.applyAttackWord(msg);
          break;
        case "game_over":
          gameStore.applyGameOver(msg);
          break;
      }
    },
  });

  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!lobby) return;

    const tick = () => {
      const secs = Math.max(
        0,
        Math.ceil((lobby.beginAtCountdown - Date.now()) / 1000),
      );
      setCountdown(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lobby?.beginAtCountdown]);

  const handlePlayAgain = () => {
    gameStore.reset();
    setPhase("lobby");
    sendMessage({ type: "find_or_create_lobby" });
  };

  const header = (
    <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
      <h1 className="font-mono text-lg uppercase tracking-widest">
        Battle Royale
      </h1>
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs text-gray-400 uppercase tracking-widest">
          {status === "open" ? (
            <span className="text-green-400">● Connected</span>
          ) : status === "connecting" ? (
            <span className="text-yellow-400">● Connecting…</span>
          ) : (
            <span className="text-red-400">● Disconnected</span>
          )}{" "}
        </span>
        <button
          onClick={onLeave}
          className="font-mono text-xs text-gray-400 hover:text-white uppercase tracking-widest transition-colors"
        >
          ← Leave
        </button>
      </div>
    </div>
  );

  // if (phase === "lobby") {
  //   return (
  //     <div className="flex flex-col h-screen">
  //       {header}
  //       <div className="flex flex-col grow items-center justify-center gap-6">
  //         {status !== "open" ? (
  //           <p className="font-mono text-sm text-gray-400">
  //             {status === "connecting"
  //               ? "Connecting to server…"
  //               : "Disconnected"}{" "}
  //           </p>
  //         ) : (
  //           <>
  //             <p className="font-mono text-xs text-gray-400 uppercase tracking-widest">
  //               Game starts in
  //             </p>
  //             {countdown !== null ? (
  //               <ScrollTile
  //                 letters={String(countdown)}
  //                 theme="present"
  //                 size="lg"
  //               />
  //             ) : (
  //               <p className="font-mono text-sm text-gray-400">Waiting…</p>
  //             )}{" "}
  //           </>
  //         )}{" "}
  //       </div>
  //     </div>
  //   );
  // }

  // if (gameOver !== null) {
  //   return (
  //     <div className="flex flex-col h-screen">
  //       {header}
  //       <GameOverScreen
  //         gameOver={gameOver}
  //         myUserId={myUserId}
  //         onPlayAgain={handlePlayAgain}
  //       />
  //     </div>
  //   );
  // }

  return (
    <div className="flex flex-col h-screen">
      {header}
      <div className="flex h-screen">
        <OpponentsContainer>
          <p>Opponent</p>
        </OpponentsContainer>
        {/* Left: game board + keyboard */}
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <AttackQueueIndicator count={attackQueueSize} />
          <GameBoard
            guesses={guesses}
            feedbacks={feedbacks}
            currentInput={currentInput}
            revealedPositions={revealedPositions}
            isAttackWord={activeWordIsAttack}
          />
          <GameKeyboard
            guesses={guesses}
            feedbacks={feedbacks}
            onLetter={setInput}
            onEnter={() => submitGuess(sendMessage)}
            onDelete={deleteLetter}
            disabled={false}
          />
        </div>
        {/* Right: opponents + targeting */}
        <OpponentsContainer>
          <p>Opponent</p>
        </OpponentsContainer>
      </div>
    </div>
  );
}
