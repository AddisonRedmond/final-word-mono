import { motion } from "motion/react";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const numbers = "0123456789";
const chars = [...alphabet, ...numbers];

const sizeMap = {
  sm: { tile: "w-8 text-xl",   tileHeight: 32 },
  md: { tile: "w-12 text-3xl", tileHeight: 48 },
  lg: { tile: "w-16 text-5xl", tileHeight: 64 },
};

const colorMap = {
  correct:   "bg-emerald-500 text-white border border-emerald-600",
  present:   "bg-amber-400 text-white border border-amber-500",
  "not-present": "bg-stone-400 text-white border border-stone-500",
};

type ScrollTileProps = {
  letters: string;
  theme: "correct" | "not-present" | "present";
  size?: "sm" | "md" | "lg";
};

const ScrollTile: React.FC<ScrollTileProps> = ({ letters, theme, size = "md" }) => {
  const { tile, tileHeight } = sizeMap[size];
  const colorClass = colorMap[theme];

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      exit={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex gap-2"
    >
      {letters.split("").map((letter, tileIndex) => (
        <div
          key={tileIndex}
          className={`flex aspect-square ${tile} ${colorClass} flex-col items-center overflow-hidden rounded-md font-bold shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.15)]`}
        >
          {chars.map((char, index) => (
            <motion.p
              key={`${index}letter`}
              className="flex shrink-0 items-center justify-center"
              style={{ height: tileHeight, width: tileHeight }}
              animate={{ y: -chars.indexOf(letter.toUpperCase()) * tileHeight }}
              transition={{
                duration: 0.8,
                type: "spring",
                damping: 12,
                delay: tileIndex * 0.1,
              }}
            >
              {char}
            </motion.p>
          ))}
        </div>
      ))}
    </motion.div>
  );
};

export default ScrollTile;
