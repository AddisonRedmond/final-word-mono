import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimate } from "motion/react";

import Keyboard from "@/components/game-components/keyboard";
import type { DuelParticipant } from "@/db/schema";
import * as br from "@/utils/battle-royale";
import type { KeyboardState, MatchResult } from "@/utils/duel";

import DuelGuess from "./duel-guess";
import DuelResult from "./duel-result";
import DuelTimer from "./duel-timer";
import Guesses from "./guesses";

export type DuelData = {
  duel: {
    id: string;
    initiatedBy: string;
    createdAt: Date;
    completed: boolean;
    winner: string | null;
    participants: string[];
  };
  participant: DuelParticipant[];
  matchResults: MatchResult[];
  keyboardState: KeyboardState;
  secretWord?: string;
};

type DuelBoardProps = {
  duelData: DuelData;
  currentUserId: string;
  onSubmitGuess: (guess: string) => Promise<void>;
  onClose: () => void;
  opponents: Array<{
    id: string;
    name: string;
    status: string;
    guesses: string[];
  }>;
};

const DuelBoard: React.FC<DuelBoardProps> = ({
  duelData,
  currentUserId,
  onSubmitGuess,
  onClose,
  opponents,
}) => {
  const [guess, setGuess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate();

  const currentParticipant = duelData.participant.find(
    (participant) => participant.userId === currentUserId,
  );

  const { correct, present, absent } = duelData.keyboardState;

  const isResultView = Boolean(currentParticipant?.endTime);

  const fullMatch = Object.fromEntries(
    correct.map((letter, index) => [index, letter]),
  ) as Record<number, string>;

  const onLetter = useCallback((letter: string) => {
    setGuess((prev) => (prev.length < 5 ? prev + letter.toUpperCase() : prev));
  }, []);

  const onBackspace = useCallback(() => {
    setGuess((prev) => prev.slice(0, -1));
  }, []);

  const onEnter = useCallback(async () => {
    if (guess.length !== 5 || isSubmittingRef.current) {
      return;
    }

    if (!br.isValidGuess(guess)) {
      animate(scope.current, { x: [-10, 10, -10, 10, 0] });
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await onSubmitGuess(guess);
      setGuess("");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [animate, guess, onSubmitGuess, scope]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void onEnter();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        onBackspace();
        return;
      }

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        onLetter(event.key);
      }
    },
    [onBackspace, onEnter, onLetter],
  );

  useEffect(() => {
    boardRef.current?.focus();
  }, []);

  if (!currentParticipant) {
    return null;
  }

  if (isResultView) {
    return (
      <DuelResult
        currentUserId={currentUserId}
        duelData={duelData}
        onClose={onClose}
        opponents={opponents}
      />
    );
  }

  return (
    <div
      ref={boardRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="w-full max-w-2xl space-y-2 rounded-2xl outline-none"
    >
      {currentParticipant.startTime && (
        <DuelTimer startTime={currentParticipant.startTime} />
      )}

      <Guesses
        guesses={currentParticipant.guesses}
        matchResults={duelData.matchResults}
      />

      <div ref={scope}>
        <DuelGuess guess={guess} />
      </div>

      <Keyboard
        disabled={isSubmitting}
        fullMatch={fullMatch}
        noMatch={absent}
        onBackspace={onBackspace}
        onEnter={() => void onEnter()}
        onLetter={onLetter}
        partialMatch={present}
      />
    </div>
  );
};

export default DuelBoard;