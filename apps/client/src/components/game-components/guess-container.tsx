import { memo } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import type { RevealedLetters } from "@/types/battle-royale.types";

type TileVariant = "default" | "correct" | "present" | "absent" | "hopper";
type GuessContainerProps = {
  guess: string;
  queue?: RevealedLetters[];
  fullMatches?: Record<number, string>;
};
const variantClasses: Record<TileVariant, string> = {
  default: "bg-amber-50 text-stone-800 border border-amber-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
  hopper: "bg-stone-200 text-black border border-stone-300",
};

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
      <AnimatePresence>
        {
          <m.p key="match" className="absolute text-xs top-0.5 right-0.5">
            {match}
          </m.p>
        }
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
}) => {
  const guessLetters = Array.from(
    { length: GUESS_LENGTH },
    (_, index) => guess.at(index) ?? "",
  );

  return (
    <LazyMotion features={domAnimation} strict>
      <div>
        <div className="relative isolate overflow-hidden rounded-md border border-white/30 bg-white/10 shadow-lg backdrop-blur-md">
          <HopperQueue queue={queue} />
          <div className="relative z-10 flex items-center justify-evenly gap-x-1 p-2 text-xl font-bold">
            {guessLetters.map((letter, index) => (
              <GuessLetter
                key={index}
                letter={letter}
                match={fullMatches?.[index]}
              />
            ))}
          </div>
        </div>
      </div>
    </LazyMotion>
  );
};

export default GuessContainer;
