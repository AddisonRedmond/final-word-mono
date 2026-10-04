import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimate } from "motion/react";

import Keyboard from "@/components/game-components/keyboard";
import type { DuelParticipant } from "@/db/schema";
import { useKeyboardLayoutStore } from "@/state/keyboard-layout-store";
import {
  isValidDuelWord,
  type KeyboardState,
  type MatchResult,
} from "@/utils/duel";

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
  onArchive?: () => void;
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
  onArchive,
  opponents,
}) => {
  const [guess, setGuess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [scope, animate] = useAnimate();

  // Persisted preference for which side Enter/Delete sit on in the keyboard.
  const swapActionKeys = useKeyboardLayoutStore(
    (state) => state.swapActionKeys,
  );

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

    // Validate against the duel word list (the same list the server checks)
    // so an invalid spelling shakes the guess row instead of being silently
    // rejected server-side. Mirrors the Battle Royale invalid-guess shake.
    if (!isValidDuelWord(guess)) {
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

  // Listen on the window instead of relying on the board div holding focus.
  // The board mounts inside an animated modal, so a one-shot element focus is
  // unreliable (the modal can grab focus after mount). A window listener lets
  // the player start typing immediately without clicking the grid first.
  // Matches the input handling in Battle Royale.
  useEffect(() => {
    // Only drive the on-board keyboard while actually playing. Once the
    // participant has finished, the result view is shown and should not capture
    // keystrokes.
    if (isResultView) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isResultView, onBackspace, onEnter, onLetter]);

  if (!currentParticipant) {
    return null;
  }

  if (isResultView) {
    return (
      <DuelResult
        currentUserId={currentUserId}
        duelData={duelData}
        onArchive={onArchive}
        onClose={onClose}
        opponents={opponents}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-2xl grow flex-col gap-2 outline-none">
      {currentParticipant.startTime && (
        <DuelTimer startTime={currentParticipant.startTime} />
      )}

      {/* The guesses history + current guess take the middle; `mt-auto` on the
          keyboard below pushes it to the bottom when the board fills a
          full-screen mobile modal. */}
      <Guesses
        guesses={currentParticipant.guesses}
        matchResults={duelData.matchResults}
      />

      <div ref={scope}>
        <DuelGuess guess={guess} />
      </div>

      <Keyboard
        className="mt-auto"
        disabled={isSubmitting}
        fullMatch={fullMatch}
        noMatch={absent}
        onBackspace={onBackspace}
        onEnter={() => void onEnter()}
        onLetter={onLetter}
        partialMatch={present}
        swapActionKeys={swapActionKeys}
      />
    </div>
  );
};

export default DuelBoard;