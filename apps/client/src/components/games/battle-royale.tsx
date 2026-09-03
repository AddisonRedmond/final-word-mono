import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import type { Socket } from "socket.io-client";
import CountDownTimer from "../game-components/timer";
import type { ClientGame, TargetType } from "@/types/battle-royale.types.ts";
import { useBattleRoyaleSocket } from "@/hooks/useBattleRoyaleSocket";
import * as br from "@/utils/battle-royale";
import { motion } from "motion/react";
import GuessContainer from "../game-components/guess-container";
import Health from "../game-components/health";
import Keyboard from "../game-components/keyboard";
import Eliminated from "../game-components/eliminated";
import AttackPicker from "../game-components/attack-picker";
import Opponents from "../game-components/opponents";
import type { OpponentWithId } from "../game-components/opponents";
import Tile from "../tile";

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
    const oddOpponents: OpponentWithId[] = [];
    const evenOpponents: OpponentWithId[] = [];

    if (!lobby?.players) {
      return {
        oddOpponents,
        evenOpponents,
      };
    }

    Object.entries(lobby.players).forEach(([id, player], index) => {
      if (id === userId) return;

      if (index % 2 === 0) {
        evenOpponents.push({ ...player, id });
      } else {
        oddOpponents.push({ ...player, id });
      }
    });

    return {
      oddOpponents,
      evenOpponents,
    };
  }, [lobby?.players, userId]);

  useEffect(() => {
    if (lobby?.players[userId]?.isEliminated) {
      setTarget("first");
    }
  }, [lobby?.players, userId]);

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 100 }}
      exit={{ scale: 0, opacity: 0 }}
      className="flex w-full min-h-0 grow py-5"
    >
      <Opponents
        opponents={evenOpponents}
        selectedId={target}
        onSelect={setTarget}
      />
      <div className="flex flex-col items-center gap-3 mx-5 justify-center">
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

        {lobby?.players[userId]?.isEliminated ? (
          <Eliminated playerdata={lobby.players[userId]} />
        ) : (
          <div className="text-xs text-center font-semibold">
            <p>Target</p>
            <AttackPicker target={target} setTarget={setTarget} />
          </div>
        )}

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
        <div className="flex gap-2">
          <button
            onClick={() => br.leave(socketRef)}
            className="p-2 cursor-pointer rounded-md shadow-lg flex text-xs gap-x-0.5 font-semibold"
          >
            <p className="rounded-md aspect-square  p-1 bg-red-300">L</p>
            <p className=" rounded-md aspect-square p-1 bg-red-300">E</p>
            <p className=" rounded-md aspect-square p-1 bg-red-300">A</p>
            <p className="rounded-md aspect-square p-1 bg-red-300">V</p>
            <p className="rounded-md aspect-square p-1 bg-red-300">E</p>
          </button>
        </div>
        {/* <pre className="mt-3 max-w-md whitespace-pre-wrap wrap-break-words rounded-md bg-slate-100 p-3 text-xs text-slate-700">
          {JSON.stringify(lobby?.players[userId], null, 2)}
        </pre> */}
      </div>
      <Opponents
        opponents={oddOpponents}
        selectedId={target}
        onSelect={setTarget}
      />
    </motion.div>
  );
};

export default BattleRoyale;
