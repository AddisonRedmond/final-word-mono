import { number } from "zod";

const TOP_ROW = "QWERTYUIOP";
const MIDDLE_ROW = "ASDFGHJKL";
const BOTTOM_ROW = "ZXCVBNM";

type KeyboardProps = {
  onLetter: (letter: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  disabled?: boolean;
  className?: string;
  fullMatch?: Record<number, string>;
  partialMatch?: string[];
  noMatch?: string[];
};

type KeyboardRowProps = {
  letters: string;
  onLetter: (letter: string) => void;
  disabled?: boolean;
  fullMatch?: Record<number, string>;
  partialMatch?: string[];
  noMatch?: string[];
};

const keyBaseClass =
  "min-w-9 rounded-md px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur-sm transition active:scale-95";

const variantClasses = {
  default: "border border-white/20 bg-white/10 text-white hover:bg-white/20",
  correct:
    "border border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-500",
  present: "border border-amber-500 bg-amber-400 text-white hover:bg-amber-400",
  absent: "border border-stone-500 bg-stone-400 text-white hover:bg-stone-400",
};

const KeyboardRow = ({
  letters,
  onLetter,
  disabled,
  fullMatch,
  partialMatch,
  noMatch,
}: KeyboardRowProps) => {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {letters.split("").map((letter) => {
        let variant: keyof typeof variantClasses = "default";

        if (Object.values(fullMatch ?? {}).includes(letter)) {
          variant = "correct";
        } else if (partialMatch?.includes(letter)) {
          variant = "present";
        } else if (noMatch?.includes(letter)) {
          variant = "absent";
        }

        return (
          <button
            key={letter}
            type="button"
            onClick={() => onLetter(letter)}
            disabled={disabled}
            className={`${keyBaseClass} ${variantClasses[variant]} ${
              disabled ? "cursor-not-allowed opacity-40" : ""
            }`}
            aria-label={`Type ${letter}`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
};
const Keyboard = ({
  onLetter,
  onEnter,
  onBackspace,
  disabled = false,
  className = "",
  fullMatch,
  partialMatch,
  noMatch,
}: KeyboardProps) => {
  // console.log(Object.values(fullMatch));
  return (
    <div
      className={`flex w-full max-w-2xl flex-col gap-1.5 rounded-lg border border-white/15 bg-black/20 p-2 ${className}`}
      role="group"
      aria-label="On-screen keyboard"
    >
      <KeyboardRow
        fullMatch={fullMatch}
        letters={TOP_ROW}
        onLetter={onLetter}
        disabled={disabled}
        partialMatch={partialMatch}
        noMatch={noMatch}
      />
      <KeyboardRow
        fullMatch={fullMatch}
        letters={MIDDLE_ROW}
        onLetter={onLetter}
        disabled={disabled}
        partialMatch={partialMatch}
        noMatch={noMatch}
      />
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={onEnter}
          disabled={disabled || !onEnter}
          className={`${keyBaseClass} min-w-16 ${disabled || !onEnter ? "cursor-not-allowed opacity-40" : ""}`}
        >
          Enter
        </button>
        <KeyboardRow
          fullMatch={fullMatch}
          letters={BOTTOM_ROW}
          onLetter={onLetter}
          disabled={disabled}
          partialMatch={partialMatch}
          noMatch={noMatch}
        />
        <button
          type="button"
          onClick={onBackspace}
          disabled={disabled || !onBackspace}
          className={`${keyBaseClass} min-w-16 ${disabled || !onBackspace ? "cursor-not-allowed opacity-40" : ""}`}
          aria-label="Backspace"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default Keyboard;
