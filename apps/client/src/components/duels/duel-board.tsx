import { useEffect, useState } from "react";
import type { DuelParticipant } from "@/db/schema";
import Keyboard from "@/components/game-components/keyboard";
import DuelGuess from "./duel-guess";
import Guesses from "./guesses";
import DuelTimer from "./duel-timer";

type DuelBoardProps = {
  duelData: DuelParticipant;
};

const DuelBoard: React.FC<DuelBoardProps> = ({ duelData }) => {
  const [guess, setGuess] = useState("");

  const onLetter = (letter: string) => {
    setGuess((prev) => (prev.length < 5 ? prev + letter.toUpperCase() : prev));
  };

  const onEnter = () => {
    // TODO: submit guess
  };

  const onBackspace = () => {
    setGuess((prev) => prev.slice(0, -1));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Enter") {
        onEnter();
      } else if (e.key === "Backspace") {
        onBackspace();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        onLetter(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="w-full max-w-2xl rounded-2xl space-y-2">
      {duelData.startTime && <DuelTimer startTime={duelData.startTime} />}
      <Guesses guesses={duelData.guesses} />
      <DuelGuess guess={guess} />
      <Keyboard
        onLetter={onLetter}
        onEnter={onEnter}
        onBackspace={onBackspace}
      />
    </div>
  );
};

export default DuelBoard;
