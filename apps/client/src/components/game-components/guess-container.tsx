import { memo } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { Swords } from "lucide-react";
import type { RevealedLetters } from "@/types/battle-royale.types";

type TileVariant = "default" | "correct" | "present" | "absent" | "hopper";
type GuessContainerProps = {
  guess: string;
  queue?: RevealedLetters[];
  fullMatches?: Record<number, string>;
  currentWordGuesses?: number;
  // Initials of the attacker who sent the current word, shown as a badge when
  // the word being guessed arrived as an attack. Undefined = not an attack word.
  attackerInitials?: string;
};
const variantClasses: Record<TileVariant, string> = {
  default: "bg-amber-50 text-stone-800 border border-amber-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
  hopper: "bg-stone-200 text-black border border-stone-300",
};

const Max_Guesses = 8;
// static content, never re-renders when guess changes
const HopperQueue: React.FC<{ queue?: RevealedLetters[] }> = memo(
  ({ queue }) => {
    return (
      <>
        {queue?.map((item, i) => {
          const hopperWord = Array.from(
            { length: GUESS_LENGTH },
            (_, index) => {
              return item?.[index] ?? "";
            },
          );

          return (
            <div
              className="flex gap-x-1 px-2 justify-between my-1 text-lg font-semibold"
              key={Object.values(item).join("")}
            >
              {hopperWord.map((letter, letterIndex) => {
                return (
                  <GuessLetter
                    key={`${letterIndex}`}
                    letter={letter}
                    variant="hopper"
                  />
                );
              })}
            </div>
          );
        })}
      </>
    );
  },
);

const GuessLetter = memo(function GuessLetter({
  letter,
  variant = "default",
  match,
}: {
  letter?: string;
  variant?: TileVariant;
  match?: string;
}) {
  return (
    <div
      className={`grid size-14 place-content-center rounded-md relative ${variantClasses[variant]}`}
    >
      <p className="absolute text-xs top-0.5 right-0.5">{match}</p>
      <AnimatePresence>
        {letter && (
          <m.p
            key="letter"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
          >
            {letter}
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
});

const GUESS_LENGTH = 5;

const GuessContainer: React.FC<GuessContainerProps> = ({
  guess = "",
  queue,
  fullMatches,
  currentWordGuesses = 0,
  attackerInitials,
}) => {
  const guessLetters = Array.from(
    { length: GUESS_LENGTH },
    (_, index) => guess.at(index) ?? "",
  );

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="flex items-end gap-2">
        <div className="relative isolate rounded-md border border-white/30 bg-white/10 shadow-lg backdrop-blur-md">
          <HopperQueue queue={queue} />

          {/* Badge pinned to the active guess row so it reads as "this word
              you're working on was sent by <attacker>". */}
          <div className="relative z-10 flex items-center justify-evenly gap-x-1 p-2 text-xl font-bold">
            {attackerInitials && (
              <div
                className="absolute -top-2 -right-2 z-20 flex items-center gap-x-1 rounded-full bg-red-500 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-white shadow-md"
                title={`Attack word from ${attackerInitials}`}
              >
                <Swords className="size-3" />
                {attackerInitials}
              </div>
            )}

            {guessLetters.map((letter, index) => (
              <GuessLetter
                key={index}
                letter={letter}
                match={fullMatches?.[index]}
                variant="correct"
              />
            ))}
          </div>
        </div>
      </div>
    </LazyMotion>
  );
};

export default GuessContainer;
