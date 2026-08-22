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
  getLetterStateClass: (letter: string) => string;
};

const keyBaseClass =
  "min-w-9 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20 active:scale-95";

const variantClasses = {
  default: "border-white/20 bg-white/10 text-white hover:bg-white/20",
  correct: "border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-500",
  present: "border-amber-500 bg-amber-400 text-white hover:bg-amber-400",
  absent: "border-stone-500 bg-stone-400 text-white hover:bg-stone-400",
};

const toLetterSet = (values: string[] | undefined): Set<string> => {
  const letters = values
    ?.map((letter) => letter.toUpperCase())
    .filter((char) => /^[A-Z]$/.test(char));

  return new Set(letters);
};

const KeyboardRow = ({
  letters,
  onLetter,
  disabled,
  getLetterStateClass,
}: KeyboardRowProps) => {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {letters.split("").map((letter) => (
        <button
          key={letter}
          type="button"
          onClick={() => onLetter(letter)}
          disabled={disabled}
          className={`${keyBaseClass} ${getLetterStateClass(letter)} ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          aria-label={`Type ${letter}`}
        >
          {letter}
        </button>
      ))}
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
  const fullMatchSet = toLetterSet(Object.values(fullMatch ?? {}));
  const partialMatchSet = toLetterSet(partialMatch);
  const noMatchSet = toLetterSet(noMatch);

  const getLetterStateClass = (letter: string): string => {
    if (fullMatchSet.has(letter)) {
      return variantClasses.correct;
    }

    if (partialMatchSet.has(letter)) {
      return variantClasses.present;
    }

    if (noMatchSet.has(letter)) {
      return variantClasses.absent;
    }

    return variantClasses.default;
  };

  return (
    <div
      className={`flex w-full max-w-2xl flex-col gap-1.5 rounded-lg border border-white/15 bg-black/20 p-2 ${className}`}
      role="group"
      aria-label="On-screen keyboard"
    >
      <KeyboardRow
        letters={TOP_ROW}
        onLetter={onLetter}
        disabled={disabled}
        getLetterStateClass={getLetterStateClass}
      />
      <KeyboardRow
        letters={MIDDLE_ROW}
        onLetter={onLetter}
        disabled={disabled}
        getLetterStateClass={getLetterStateClass}
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
          letters={BOTTOM_ROW}
          onLetter={onLetter}
          disabled={disabled}
          getLetterStateClass={getLetterStateClass}
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
