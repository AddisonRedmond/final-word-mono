import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import type { Socket } from "socket.io-client";
import CountDownTimer from "../game-components/timer";
import type {
  ClientGame,
  PlayerDisplay,
  TargetType,
} from "@/types/battle-royale.types.ts";
import { useBattleRoyaleSocket } from "@/hooks/useBattleRoyaleSocket";
import * as br from "@/utils/battle-royale";
import { motion } from "motion/react";
import GuessContainer from "../game-components/guess-container";
import Health from "../game-components/health";
import Keyboard from "../game-components/keyboard";
import Eliminated from "../game-components/eliminated";
import AttackPicker from "../game-components/attack-picker";
import Opponents from "../game-components/opponents";

type BattleRoyaleProps = {
  socketRef: RefObject<Socket | null>;
  userId: string;
};

const GUESS_LENGTH = 5;

const BattleRoyale = ({ socketRef, userId }: BattleRoyaleProps) => {
  const [lobby, setLobby] = useState<ClientGame>();
  const [guess, setGuess] = useState("");
  const [target, setTarget] = useState<TargetType>("random");
  useBattleRoyaleSocket({ socketRef, setLobby });

  const handleLetter = useCallback((letter: string) => {
    if (!/^[A-Z]$/.test(letter)) {
      return;
    }
    setGuess((prev) =>
      prev.length < GUESS_LENGTH ? prev + letter.toUpperCase() : prev,
    );
  }, []);

  const handleBackspace = useCallback(() => {
    setGuess((prev) => prev.slice(0, -1));
  }, []);

  const handleEnter = useCallback(() => {
    if (!lobby?.room.isStarted) {
      return;
    }
    // calculate target bafore sending
    console.log(br.determineTarget(lobby.players, target));
    br.sendGuess({ guess, target, socketRef });
    setGuess("");
  }, [guess, lobby?.room.isStarted, socketRef, target]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        handleEnter();
        return;
      }

      if (e.key === "Backspace") {
        handleBackspace();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        handleLetter(e.key.toUpperCase());
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleBackspace, handleEnter, handleLetter]);

  const { oddOpponents, evenOpponents } = useMemo(() => {
    const oddOpponents: PlayerDisplay[] = [];
    const evenOpponents: PlayerDisplay[] = [];

    if (!lobby?.players) {
      return {
        oddOpponents,
        evenOpponents,
      };
    }

    Object.entries(lobby.players).forEach(([id, player], index) => {
      if (id === userId) return;

      if (index % 2 === 0) {
        evenOpponents.push(player);
      } else {
        oddOpponents.push(player);
      }
    });

    return {
      oddOpponents,
      evenOpponents,
    };
  }, [lobby?.players, userId]);
  console.log(lobby?.players);
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 100 }}
      exit={{ scale: 0, opacity: 0 }}
      className="flex w-full grow py-5"
    >
      <Opponents opponents={evenOpponents} />
      <div className="flex flex-col items-center gap-3 mx-5 justify-center">
        <div className="flex gap-2">
          <button onClick={() => br.leave(socketRef)}>Leave</button>
        </div>
        {!lobby?.room.isStarted ? (
          <CountDownTimer
            expiryTimestamp={lobby?.room?.startTime}
            timerTitle="Game Starting"
          />
        ) : (
          !lobby.players[userId]?.isEliminated && (
            <Health expiryTimestamp={lobby?.players[userId]?.life} />
          )
        )}

        {lobby?.players[userId]?.isEliminated && (
          <Eliminated playerdata={lobby.players[userId]} />
        )}
        <div className="text-xs text-center font-semibold">
          <p>Target</p>
          <AttackPicker target={target} setTarget={setTarget} />
        </div>
        <GuessContainer
          fullMatches={lobby?.players[userId]?.revealed_letters}
          guess={guess}
          queue={lobby?.players[userId]?.display_queue}
        />

        {!lobby?.players[userId]?.isEliminated && (
          <Keyboard
            onLetter={handleLetter}
            onBackspace={handleBackspace}
            onEnter={handleEnter}
            disabled={!lobby?.room.isStarted}
            fullMatch={lobby?.players[userId]?.revealed_letters}
            partialMatch={lobby?.players[userId]?.partialMatches}
            noMatch={lobby?.players[userId]?.noMatch}
          />
        )}

        {/* <pre className="mt-3 max-w-md whitespace-pre-wrap wrap-break-words rounded-md bg-slate-100 p-3 text-xs text-slate-700">
          {JSON.stringify(lobby, null, 2)}
        </pre> */}
      </div>
      <Opponents opponents={oddOpponents} />
    </motion.div>
  );
};

export default BattleRoyale;
