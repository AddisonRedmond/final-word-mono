import { memo, useId } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";

type TileVariant = "default" | "correct" | "present" | "absent" | "hopper";
type GuessContainerProps = {
  guess: string;
  queue?: string[];
};
const variantClasses: Record<TileVariant, string> = {
  default: "bg-amber-50 text-stone-800 border border-amber-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
  hopper: "bg-stone-200 text-black border border-stone-300",
};

// static content, never re-renders when guess changes
const HopperQueue: React.FC<{ queue?: string[] }> = memo(({ queue }) => {
  return (
    <>
      {queue?.map((item, i) => (
        <div
          className="flex gap-x-1 px-2 justify-between my-1 text-lg font-semibold"
          key={i}
        >
          {item.split("").map((letter) => {
            return (
              <GuessLetter key={useId()} letter={letter} variant="hopper" />
            );
          })}
        </div>
      ))}
    </>
  );
});

const GuessLetter = memo(function GuessLetter({
  letter,
  variant = "default",
}: {
  letter?: string;
  variant?: TileVariant;
}) {
  return (
    <div
      className={`grid size-14 place-content-center rounded-md ${variantClasses[variant]}`}
    >
      <AnimatePresence>
        {letter && (
          <m.p
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
              <GuessLetter key={index} letter={letter} />
            ))}
          </div>
        </div>
      </div>
    </LazyMotion>
  );
};

export default GuessContainer;
