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
import { motion, useAnimate } from "motion/react";
import GuessContainer from "../game-components/guess-container";
import Health from "../game-components/health";
import Keyboard from "../game-components/keyboard";
import Eliminated from "../game-components/eliminated";
import AttackPicker from "../game-components/attack-picker";
import Opponents from "../game-components/opponents";
import type { OpponentWithId } from "../game-components/opponents";
import MatchTimer from "../game-components/match-timer";
import BonusPreview from "../game-components/bonus-preview";
import Winner from "../game-components/winner";

type BattleRoyaleProps = {
  socketRef: RefObject<Socket | null>;
  userId: string;
};

const GUESS_LENGTH = 5;

const BattleRoyale = ({ socketRef, userId }: BattleRoyaleProps) => {
  // TODO: make the attack select show who youre selecting when you're attacking
  const [lobby, setLobby] = useState<ClientGame>();
  const [guess, setGuess] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("random");
  const [target, setTarget] = useState("");
  const [scope, animate] = useAnimate();
  useBattleRoyaleSocket({ socketRef, setLobby });

  const handleLetter = useCallback((letter: string) => {
    if (!/^[A-Z]$/.test(letter) || lobby?.players[userId]?.isEliminated) {
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
    if (lobby.players[userId]?.isEliminated) return;

    if (!br.isValidGuess(guess)) {
      animate(scope.current, { x: [-10, 10, -10, 10, 0] });
      return;
    }

    br.sendGuess({ guess, target: targetType, socketRef });
    setGuess("");
  }, [animate, guess, lobby?.room.isStarted, scope, socketRef, targetType]);

  const isPolicyTarget = (
    value: TargetType,
  ): value is "first" | "last" | "random" =>
    value === "first" || value === "last" || value === "random";

  const handleSelectTargetType = useCallback(
    (type: TargetType) => {
      setTargetType(type);
      if (lobby?.players) {
        setTarget(br.determineTarget(lobby.players, userId, type));
      }
    },
    [lobby?.players, userId],
  );

  const handleSelectOpponent = useCallback((id: string) => {
    setTargetType(id);
    setTarget(id);
  }, []);

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
    if (!lobby?.players) return;

    const currentTarget = lobby.players[target];
    if (currentTarget && !currentTarget.isEliminated) return;

    // stale target: re-resolve from policy, or fall back to "first" if it was a specific player
    if (isPolicyTarget(targetType)) {
      setTarget(br.determineTarget(lobby.players, userId, targetType));
      return;
    }

    setTargetType("first");
    setTarget(br.determineTarget(lobby.players, userId, "first"));
  }, [lobby?.players, target, targetType, userId]);

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
        onSelect={handleSelectOpponent}
      />
      <div className="flex flex-col items-center gap-3 mx-5 justify-center">
        {lobby?.room.isFinished &&
          lobby.room.winnerId === userId &&
          lobby.players[userId] && (
            <Winner
              userData={lobby.players[userId]}
              gameStartTimestamp={lobby.room.startTime}
              handleLeave={() => br.leave(socketRef)}
            />
          )}

        {lobby?.room.isStarted && (
          <MatchTimer expiryTimestamp={lobby.room.matchEndTime} />
        )}

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
          <Eliminated
            userData={lobby.players[userId]}
            gameStartTimestamp={lobby.room.startTime}
            handleLeave={() => br.leave(socketRef)}
          />
        ) : (
          <div className="text-xs text-center font-semibold">
            <p>Target</p>
            <AttackPicker target={targetType} setTarget={handleSelectTargetType} />
          </div>
        )}

        <div ref={scope}>
          <GuessContainer
            fullMatches={lobby?.players[userId]?.revealed_letters}
            guess={guess}
            queue={lobby?.players[userId]?.display_queue}
            currentWordGuesses={lobby?.players[userId]?.currentWordGuesses}
          />
        </div>

        {!lobby?.players[userId]?.isEliminated && (
          <BonusPreview
            currentWordGuesses={lobby?.players[userId]?.currentWordGuesses}
            hasQueuedAttack={
              (lobby?.players[userId]?.display_queue?.length ?? 0) > 0
            }
          />
        )}

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
      </div>
      <Opponents
        opponents={oddOpponents}
        selectedId={target}
        onSelect={handleSelectOpponent}
      />
    </motion.div>
  );
};

export default BattleRoyale;
