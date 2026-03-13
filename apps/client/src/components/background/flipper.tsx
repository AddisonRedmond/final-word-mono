// Flipper.tsx
"use client";

import { motion } from "motion/react";
import { useEffect, useState, useMemo } from "react";

const WORD_LIST = [
  "FINAL",
  "KILLER",
  "GENIUS",
  "CORRECT",
  "SMART",
  "HUNT",
  "WARRIOR",
  "WINS",
  "RUSH",
  "SLAY",
  "DUEL",
  "FURY",
  "BLAZE",
  "VAST",
  "ZONE",
  "MORE!",
  "VICTOR",
  "STRIKE",
  "FIGHTER",
  "DOMIN8",
  "ASSAULT",
  "THRIVE",
  "CONQUER",
];

// Helper: n unique random indexes
const getRandomIndexes = (max: number, count: number) => {
  const indexes = new Set<number>();
  while (indexes.size < count) {
    indexes.add(Math.floor(Math.random() * max));
  }
  return Array.from(indexes);
};

// Memoized Tile
// Tile.tsx
const Tile = ({
  letter,
  active,
  delay,
}: {
  letter: string;
  active: boolean;
  delay: number;
}) => {
  return (
    <div style={{ perspective: "1000px" }} className="w-[5vw] aspect-square">
      <motion.div
        animate={{ rotateY: active ? 0 : 180 }}
        transition={{ duration: 0.6, ease: "easeInOut", delay }}
        className="relative w-full h-full"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 grid place-content-center rounded-md outline-[0.5px] outline-stone-300 text-black bg-white"
          style={{ backfaceVisibility: "hidden" }}
        >
          <p className="text-[2vw] font-bold">{letter}</p>
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 grid place-content-center rounded-md bg-stone-100"
          style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}
        />
      </motion.div>
    </div>
  );
};

// Memoized Word
const Word = ({ word, active }: { word: string; active: boolean }) => {
  const letters = useMemo(() => word.split(""), [word]);
  return (
    <div className="flex gap-2">
      {letters.map((letter, i) => (
        <Tile key={i} letter={letter} active={active} delay={i * 0.07} />
      ))}
    </div>
  );
};

// Flipper.tsx
const Flipper = () => {
  const [activeWords, setActiveWords] = useState<number[]>([]);

  useEffect(() => {
    setActiveWords(getRandomIndexes(WORD_LIST.length, 3));

    const interval = setInterval(() => {
      setActiveWords(getRandomIndexes(WORD_LIST.length, 3));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="blur-[6px] fixed inset-0 -z-10 pointer-events-none flex flex-wrap justify-center items-center gap-[1vw] p-[2vw]">
      {WORD_LIST.map((word, i) => (
        <Word key={i} word={word} active={activeWords.includes(i)} />
      ))}
    </div>
  );
};
export default Flipper;
