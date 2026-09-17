import { DuelGuessLetter } from "./duel-guess";

const MAX_GUESSES = 5;
const WORD_LENGTH = 5;

const Guesses: React.FC<{ guesses: string[] }> = ({ guesses }) => {
  return (
    <div className="flex w-full flex-col items-center gap-2 py-2">
      {Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
        const guess = guesses[rowIndex] ?? "";

        return (
          <div key={rowIndex} className="flex gap-1 w-full">
            {Array.from({ length: WORD_LENGTH }, (_, letterIndex) => (
              <DuelGuessLetter
                key={letterIndex}
                letter={guess.at(letterIndex) ?? ""}
                variant="default"
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default Guesses;