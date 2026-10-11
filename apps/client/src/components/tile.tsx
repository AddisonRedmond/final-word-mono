import { memo } from "react";
import { motion } from "motion/react";

interface TileProps {
  word: string;
  revealed?: boolean;
  guess?: string | string[];
  variant?: "default" | "correct" | "present" | "absent" | "champion";
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

const alphabetIndexes = new Map(
  alphabet.map((letter, index) => [letter, index]),
);

const variantClasses = {
  default: "bg-amber-50 text-stone-800 border border-amber-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
  // Champion cosmetic: a warm gold face with a brighter gold ring. Paired with
  // the sparkle overlay (see <Tile>) when the player won their last realtime
  // game.
  champion:
    "bg-gradient-to-br from-amber-300 to-yellow-500 text-white border border-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.55)]",
} as const;

const sizeClasses = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
} as const;

const sizeDimensions = {
  sm: { width: 40, height: 40 },
  md: { width: 56, height: 56 },
  lg: { width: 80, height: 80 },
} as const;

export const SlotTile = memo<SlotTileProps>(
  ({
    letters,
    tileClassName,
    revealed = true,
    desktopOnly = false,
    tileSize,
  }) => {
    return (
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        className={`flex gap-2 ${desktopOnly ? "hidden sm:flex" : ""}`}
      >
        {letters.split("").map((letter, index) => {
          const isRevealed = Array.isArray(revealed)
            ? (revealed[index] ?? false)
            : revealed;

          const letterIndex = alphabetIndexes.get(letter.toUpperCase()) ?? 0;

          const className =
            typeof tileClassName === "function"
              ? tileClassName(index, isRevealed)
              : tileClassName;

          return (
            <motion.div
              key={index}
              initial={tileSize}
              animate={tileSize}
              transition={{
                duration: 0.25,
                ease: "easeInOut",
              }}
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
                className="h-full w-full will-change-transform"
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
  },
);

SlotTile.displayName = "SlotTile";

// Fixed sparkle positions (percent of the overlay box) + per-star timing so the
// twinkle looks organic rather than synchronized. Kept module-level so the
// array identity is stable across renders.
const SPARKLES = [
  { top: "-8%", left: "6%", size: 10, delay: 0, duration: 1.6 },
  { top: "18%", left: "92%", size: 8, delay: 0.5, duration: 1.9 },
  { top: "72%", left: "-6%", size: 9, delay: 0.9, duration: 1.7 },
  { top: "96%", left: "70%", size: 7, delay: 0.3, duration: 2.1 },
  { top: "40%", left: "48%", size: 6, delay: 1.2, duration: 1.5 },
] as const;

/**
 * A twinkling sparkle layer for the champion tiles. Absolutely positioned over
 * the tile row and non-interactive (`pointer-events-none`). Each star pulses its
 * scale/opacity on its own loop; `motion` honours the user's reduced-motion
 * setting, so the animation is skipped for those who opt out — the gold face
 * still shows.
 */
const Sparkles: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
    {SPARKLES.map((s, i) => (
      <motion.svg
        key={i}
        className="absolute text-yellow-100 drop-shadow-[0_0_4px_rgba(253,224,71,0.9)]"
        style={{ top: s.top, left: s.left, width: s.size, height: s.size }}
        viewBox="0 0 24 24"
        fill="currentColor"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1, 0], opacity: [0, 1, 0] }}
        transition={{
          duration: s.duration,
          delay: s.delay,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        {/* Four-point sparkle/star. */}
        <path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" />
      </motion.svg>
    ))}
  </div>
);

const Tile = memo<TileProps>(
  ({ word, revealed = false, guess, variant = "default", size = "md" }) => {
    const letters = word.toUpperCase();

    const guesses = Array.isArray(guess)
      ? guess
      : letters.split("").map(() => guess ?? "");

    const letterRevealed = letters
      .split("")
      .map(
        (letter, index) => revealed || guesses[index]?.toUpperCase() === letter,
      );

    const slot = (
      <SlotTile
        letters={letters}
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

    // Champion tiles get a sparkle layer over the row. The relative wrapper
    // confines the absolutely-positioned sparkles to this tile row.
    if (variant === "champion") {
      return (
        <div className="relative inline-block">
          {slot}
          <Sparkles />
        </div>
      );
    }

    return slot;
  },
);

Tile.displayName = "Tile";

export default Tile;
