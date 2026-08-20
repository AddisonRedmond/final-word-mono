import { motion } from "motion/react";

interface TileProps {
  word: string;
  revealed?: boolean;
  guess?: string | string[];
  variant?: "default" | "correct" | "present" | "absent";
  size?: "sm" | "md" | "lg";
}

interface SlotTileProps {
  letters: string;
  tileClassName: string | ((index: number, isRevealed: boolean) => string);
  revealed?: boolean | boolean[];
  desktopOnly?: boolean;
  tileSize?: { width: number; height: number };
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

export const SlotTile: React.FC<SlotTileProps> = ({
  letters,
  tileClassName,
  revealed = true,
  desktopOnly = false,
  tileSize,
}) => (
  <motion.div
    initial={{ scale: 0, opacity: 0 }}
    exit={{ scale: 0, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    className={`flex gap-2 ${desktopOnly ? "hidden sm:flex" : ""}`}
  >
    {letters.split("").map((letter, index) => {
      const isRevealed = Array.isArray(revealed)
        ? (revealed[index] ?? false)
        : revealed;
      const letterIndex = Math.max(alphabet.indexOf(letter.toUpperCase()), 0);
      const className =
        typeof tileClassName === "function"
          ? tileClassName(index, isRevealed)
          : tileClassName;

      return (
        <motion.div
          key={index}
          initial={tileSize}
          animate={tileSize}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className={`${className} overflow-hidden rounded-md`}
        >
          <motion.div
            initial={{ y: 0, opacity: 0 }}
            animate={{
              y: isRevealed ? `-${letterIndex * 100}%` : 0,
              opacity: isRevealed ? 1 : 0,
            }}
            transition={{
              duration: 0.8,
              type: "spring",
              damping: 12,
              delay: isRevealed ? index * 0.1 : 0,
            }}
            className="h-full w-full"
          >
            {alphabet.map((alphabetLetter) => (
              <p
                key={alphabetLetter}
                className="flex h-full items-center justify-center font-bold uppercase select-none"
              >
                {alphabetLetter}
              </p>
            ))}
          </motion.div>
        </motion.div>
      );
    })}
  </motion.div>
);

const Tile: React.FC<TileProps> = ({
  word,
  revealed = false,
  guess,
  variant = "default",
  size = "md",
}) => {
  const guesses = Array.isArray(guess)
    ? guess
    : word.split("").map(() => guess || "");

  // Map variant to classes
  const variantClasses = {
    default: "bg-amber-50 text-stone-800 border border-amber-200/60",
    correct: "bg-emerald-500 text-white border border-emerald-600",
    present: "bg-amber-400 text-white border border-amber-500",
    absent: "bg-stone-400 text-white border border-stone-500",
  };

  // Map size to classes
  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  };

  const sizeDimensions = {
    sm: { width: 40, height: 40 },
    md: { width: 56, height: 56 },
    lg: { width: 80, height: 80 },
  };

  const letterRevealed = word.split("").map(
    (letter, index) =>
      revealed || guesses[index]?.toUpperCase() === letter.toUpperCase(),
  );

  return (
    <SlotTile
      letters={word}
      revealed={letterRevealed}
      tileSize={sizeDimensions[size]}
      tileClassName={(_, isRevealed) =>
        `${sizeClasses[size]} ${
          isRevealed
            ? variantClasses[variant]
            : "border border-gray-300 bg-gray-100"
        }`
      }
    />
  );
};

export default Tile;
