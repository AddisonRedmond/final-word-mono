import { memo } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";

type TileVariant = "default" | "correct" | "present" | "absent";

type GuessContainerProps = {
  guess: string;
  variants?: TileVariant[];
};

const GUESS_LENGTH = 5;

const variantClasses: Record<TileVariant, string> = {
  default: "bg-stone-50 text-stone-800 border border-stone-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
};

export const DuelGuessLetter = memo(function GuessLetter({
  letter,
  variant = "default",
  fitHeight = false,
}: {
  letter?: string;
  variant?: TileVariant;
  /**
   * When true the tile sizes from the available row height (`h-full`) and
   * stays square via aspect-ratio. Used by the guesses history grid so the
   * whole board can shrink to fit the viewport. When false (the live typing
   * row) the tile is width-driven (`w-1/5`) as before.
   */
  fitHeight?: boolean;
}) {
  const sizeClass = fitHeight
    ? "h-full max-h-14 aspect-square"
    : "aspect-square w-1/5 sm:aspect-auto sm:h-14";

  return (
    <div
      className={`relative grid ${sizeClass} place-content-center rounded-md text-base sm:text-xl ${variantClasses[variant]}`}
    >
      <LazyMotion features={domAnimation} strict>
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
      </LazyMotion>
    </div>
  );
});

const DuelGuess = memo(function GuessContainer({
  guess,
  variants,
}: GuessContainerProps) {
  const guessLetters = Array.from(
    { length: GUESS_LENGTH },
    (_, index) => guess.at(index) ?? "",
  );

  return (
    <div className="relative isolate rounded-md border border-white/30 bg-white/10 p-2 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-evenly gap-x-1 text-xl font-bold">
        {guessLetters.map((letter, index) => (
          <DuelGuessLetter
            key={index}
            letter={letter}
            variant={variants?.[index] ?? "default"}
          />
        ))}
      </div>
    </div>
  );
});

export default DuelGuess;
