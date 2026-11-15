import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Socket } from "socket.io-client";
import { track } from "@/utils/posthog";
import CountDownTimer from "../game-components/timer";
import type { ClientGame, TargetMode } from "@/types/battle-royale.types.ts";
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
import ShareCode from "../game-components/share-code";
import GameCenterPanel from "../game-components/game-center-panel";
import LeaveButton from "@/components/leave-button";
import Modal from "@/components/modal";
import MobileTargetBar, {
  TopOpponents,
} from "../game-components/mobile-target-bar";
import { LogOut, Users } from "lucide-react";

type BattleRoyaleProps = {
  socketRef: RefObject<Socket | null>;
  userId: string;
  /**
   * Feature: anonymous-sign-in — reports a realtime `join:error` reason up to
   * the home screen so a persistent guest-limit notice can be shown there after
   * this view un-mounts (R6.5). Optional and additive.
   */
  onJoinError?: (reason: string | undefined) => void;
  /**
   * v1 play-with-friends — optional share code entered on the home screen. When
   * present it is sent with `join` so the player lands in that friend's room.
   */
  joinCode?: string;
};

const GUESS_LENGTH = 5;

const BattleRoyale = ({
  socketRef,
  userId,
  onJoinError,
  joinCode,
}: BattleRoyaleProps) => {
  const [lobby, setLobby] = useState<ClientGame>();
  // Feature: anonymous-sign-in — the latest `join:error` reason, reported up to
  // the home screen (below) which shows the single dismissible play-limit notice.
  const [joinError, setJoinError] = useState<string>();
  // v1 play-with-friends — set when a share-code join fell back to public
  // matchmaking, so we can tell the player they didn't land with their friend.
  const [joinNotice, setJoinNotice] = useState<string>();
  const [guess, setGuess] = useState("");
  // `targetMode` is the selection intent ("first"/"last" auto-track the live
  // leader/trailer, "random" picks one opponent, "player" locks a specific
  // opponent). `target` is always the concrete resolved opponent UUID that is
  // both highlighted in the UI and sent to the server, so what you see hit is
  // exactly who gets hit.
  const [targetMode, setTargetMode] = useState<TargetMode>("random");
  const [target, setTarget] = useState("");
  // Mobile-only: the "All" ring opens a sheet with the full opponent grid.
  const [allOpponentsOpen, setAllOpponentsOpen] = useState(false);
  const [scope, animate] = useAnimate();
  // Analytics guards so each funnel event fires at most once per match: the
  // player's first valid guess, and the game's start/finish transitions.
  const firstGuessTracked = useRef(false);
  const startedTracked = useRef(false);
  const finishedTracked = useRef(false);
  useBattleRoyaleSocket({
    socketRef,
    setLobby,
    setJoinError,
    joinCode,
    setJoinNotice,
  });

  // Feature: anonymous-sign-in — forward a join:error reason to the home screen
  // so it can show a persistent guest-limit notice once this view un-mounts.
  useEffect(() => {
    if (joinError) {
      onJoinError?.(joinError);
    }
  }, [joinError, onJoinError]);

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

    // Engagement: record the player's FIRST valid guess of this match (once).
    // Fired here, past the validity/eliminated guards, so it means a real
    // attempt was sent — the signal that separates "played" from "idled".
    if (!firstGuessTracked.current) {
      firstGuessTracked.current = true;
      track("first_guess_submitted", { mode: "battle_royale" });
    }

    // Always send the concrete resolved opponent UUID (never a policy string)
    // so the server hits exactly who the UI is highlighting.
    br.sendGuess({ guess, target, socketRef });
    setGuess("");
  }, [animate, guess, lobby?.room.isStarted, scope, socketRef, target]);

  // Picking First/Last/Random from the AttackPicker: store the mode and resolve
  // a concrete opponent UUID now. For "first"/"last" the effect below keeps the
  // resolved target in sync as lives change; "random" locks the picked UUID
  // until it is eliminated or Random is pressed again.
  const handleSelectTargetType = useCallback(
    (mode: "first" | "last" | "random") => {
      setTargetMode(mode);
      if (lobby?.players) {
        setTarget(br.determineTarget(lobby.players, userId, mode));
      }
    },
    [lobby?.players, userId],
  );

  const handleSelectOpponent = useCallback((id: string) => {
    setTargetMode("player");
    setTarget(id);
  }, []);

  // Picking an opponent from the mobile "All" sheet locks them and closes it.
  const handleSelectOpponentFromSheet = useCallback(
    (id: string) => {
      handleSelectOpponent(id);
      setAllOpponentsOpen(false);
    },
    [handleSelectOpponent],
  );

  // Funnel: a realtime match actually began / ended. Each fires once per match,
  // guarded by a ref, driven by the authoritative room flags from the server.
  useEffect(() => {
    if (lobby?.room.isStarted && !startedTracked.current) {
      startedTracked.current = true;
      track("realtime_game_started", { mode: "battle_royale" });
    }
  }, [lobby?.room.isStarted]);

  useEffect(() => {
    if (lobby?.room.isFinished && !finishedTracked.current) {
      finishedTracked.current = true;
      track("realtime_game_finished", {
        mode: "battle_royale",
        won: lobby.room.winnerId === userId,
      });
    }
  }, [lobby?.room.isFinished, lobby?.room.winnerId, userId]);

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

  // Every opponent in one list, for the mobile "All" sheet (desktop splits them
  // across the two flanking columns).
  const allOpponents = useMemo(
    () => [...evenOpponents, ...oddOpponents],
    [evenOpponents, oddOpponents],
  );

  // "42/99 remaining": everyone still alive (including you) out of the full
  // roster. Eliminated players stay in `players`, so the total is stable.
  const { playersRemaining, totalPlayers } = useMemo(() => {
    const all = Object.values(lobby?.players ?? {});
    return {
      playersRemaining: all.filter((player) => !player.isEliminated).length,
      totalPlayers: all.length,
    };
  }, [lobby?.players]);

  // Keep the resolved `target` in sync with the current roster/lives:
  // - first/last: re-resolve every update so the highlight tracks the live
  //   leader/trailer without the user re-clicking.
  // - random: keep the picked opponent, only re-roll if they were eliminated.
  // - player: keep the chosen opponent, fall back to "first" if eliminated.
  useEffect(() => {
    if (!lobby?.players) return;

    const currentTarget = target ? lobby.players[target] : undefined;
    const targetIsAlive = Boolean(currentTarget && !currentTarget.isEliminated);

    if (targetMode === "first" || targetMode === "last") {
      const resolved = br.determineTarget(lobby.players, userId, targetMode);
      if (resolved !== target) {
        setTarget(resolved);
      }
      return;
    }

    // "random" / "player": only act when the current target is gone.
    if (targetIsAlive) return;

    if (targetMode === "random") {
      setTarget(br.determineTarget(lobby.players, userId, "random"));
      return;
    }

    // "player" whose opponent was eliminated: fall back to the current leader.
    setTargetMode("first");
    setTarget(br.determineTarget(lobby.players, userId, "first"));
  }, [lobby?.players, target, targetMode, userId]);

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 100 }}
      exit={{ scale: 0, opacity: 0 }}
      className="flex w-full min-h-0 grow py-1 lg:py-5"
    >
      {/* Flanking opponent columns are desktop-only (lg+). Below that the
          target ring row + "All" sheet replace them. */}
      <Opponents
        className="hidden lg:block"
        opponents={evenOpponents}
        selectedId={target}
        onSelect={handleSelectOpponent}
      />
      <GameCenterPanel className="min-h-0 grow justify-start gap-2 lg:grow-0 lg:justify-center lg:gap-3">
        {lobby?.room.isFinished &&
          lobby.room.winnerId === userId &&
          lobby.players[userId] && (
            <Winner
              userData={lobby.players[userId]}
              gameStartTimestamp={lobby.room.startTime}
              handleLeave={() => br.leave(socketRef)}
            />
          )}

        {/* Mobile: one status row (leave, match timer, life). `lg:contents`
            dissolves the wrapper on desktop so MatchTimer and Health stack in
            the panel exactly as before. */}
        <div className="flex w-full items-center gap-x-3 lg:contents">
          <button
            aria-label="Leave game"
            className="grid size-9 shrink-0 cursor-pointer place-content-center rounded-lg text-zinc-500 outline-none hover:text-hot focus-visible:ring-2 focus-visible:ring-hot lg:hidden"
            onClick={() => br.leave(socketRef)}
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
          </button>

          {lobby?.room.isStarted && (
            <MatchTimer expiryTimestamp={lobby.room.matchEndTime} />
          )}

          {/* Mobile-only: players still alive out of everyone who started. */}
          {lobby?.room.isStarted && (
            <p
              aria-label={`${playersRemaining} of ${totalPlayers} players remaining`}
              className="flex shrink-0 items-center gap-x-1 font-semibold text-xs tabular-nums lg:hidden"
            >
              <Users aria-hidden="true" className="size-3.5 text-zinc-500" />
              {playersRemaining}/{totalPlayers}
            </p>
          )}

          {lobby?.room.isStarted && !lobby.players[userId]?.isEliminated && (
            <div className="min-w-0 grow lg:contents">
              <Health expiryTimestamp={lobby?.players[userId]?.life} />
            </div>
          )}
        </div>

        {!lobby?.room.isStarted ? (
          <>
            <CountDownTimer
              expiryTimestamp={lobby?.room?.startTime}
              timerTitle="Game Starting"
            />
            {/* v1 play-with-friends — show this room's share code before the
                match starts so a player can invite friends into the SAME game.
                A friend enters it via "Join Game" on the home screen. */}
            {lobby?.room.shareCode && <ShareCode code={lobby.room.shareCode} />}
            {/* Fallback notice: the player tried a friend's code but it was
                missing/started/full, so they were placed in a fresh game. */}
            {joinNotice === "room-unavailable" && (
              <p className="max-w-xs rounded-md bg-amber-100 px-3 py-2 text-center text-[11px] text-amber-700">
                That game couldn't be joined (it may have already started), so
                we started a new one for you.
              </p>
            )}
          </>
        ) : null}

        {lobby?.players[userId]?.isEliminated ? (
          <Eliminated
            userData={lobby.players[userId]}
            gameStartTimestamp={lobby.room.startTime}
            handleLeave={() => br.leave(socketRef)}
          />
        ) : (
          <>
            <div className="hidden text-xs text-center font-semibold lg:block">
              <p>Target</p>
              <AttackPicker
                mode={targetMode}
                onSelect={handleSelectTargetType}
              />
            </div>
            {/* Mobile target selection + a read-out of who you're hitting. */}
            {lobby?.room.isStarted && (
              <div className="flex w-full flex-col gap-y-1 lg:hidden">
                <MobileTargetBar
                  onOpenAll={() => setAllOpponentsOpen(true)}
                  onSelectMode={handleSelectTargetType}
                  players={lobby.players}
                  target={target}
                  targetMode={targetMode}
                  userId={userId}
                />
                <TopOpponents
                  onSelect={handleSelectOpponent}
                  players={lobby.players}
                  target={target}
                  userId={userId}
                />
              </div>
            )}
          </>
        )}

        <div
          className="flex min-h-0 grow items-center justify-center lg:grow-0"
          ref={scope}
        >
          {!lobby?.players[userId]?.isEliminated && (
            <GuessContainer
              fullMatches={lobby?.players[userId]?.revealed_letters}
              guess={guess}
              queue={lobby?.players[userId]?.display_queue}
              attackQueueView={lobby?.players[userId]?.attackQueueView}
              cementAt={lobby?.players[userId]?.attackCementAt}
              currentWordGuesses={lobby?.players[userId]?.currentWordGuesses}
              attackerInitials={
                lobby?.players[userId]?.currentWordIsAttack
                  ? br.getInitials(
                      lobby.players[userId]?.currentWordAttackerName ??
                        lobby.players[userId]?.lastAttackerName,
                    )
                  : undefined
              }
            />
          )}
        </div>

        {!lobby?.players[userId]?.isEliminated && (
          <BonusPreview
            currentWordGuesses={lobby?.players[userId]?.currentWordGuesses}
            currentWordIsAttack={lobby?.players[userId]?.currentWordIsAttack}
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
        <div className="hidden lg:block">
          <LeaveButton onClick={() => br.leave(socketRef)} />
        </div>
      </GameCenterPanel>
      <Opponents
        className="hidden lg:block"
        opponents={oddOpponents}
        selectedId={target}
        onSelect={handleSelectOpponent}
      />

      {allOpponentsOpen && (
        <Modal className="lg:hidden" onClose={() => setAllOpponentsOpen(false)}>
          <p className="mb-2 text-center font-semibold text-sm">
            Pick a target
          </p>
          <Opponents
            opponents={allOpponents}
            selectedId={target}
            onSelect={handleSelectOpponentFromSheet}
          />
        </Modal>
      )}
    </motion.div>
  );
};

export default BattleRoyale;
