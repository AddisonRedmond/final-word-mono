"use client";

import { motion } from "motion/react";
import { memo, useEffect, useState } from "react";

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
] as const;

const ACTIVE_WORD_COUNT = 3;
const FLIP_INTERVAL = 5000;

// Returns a set of unique random word indexes.
const getRandomIndexes = (max: number, count: number) => {
  const indexes = new Set<number>();

  while (indexes.size < count) {
    indexes.add(Math.floor(Math.random() * max));
  }

  return indexes;
};

type TileProps = {
  letter: string;
  active: boolean;
  delay: number;
};

const Tile = memo(({ letter, active, delay }: TileProps) => {
  return (
    <div
      className="aspect-square w-[5vw]"
      style={{ perspective: "1000px" }}
    >
      <motion.div
        animate={{ rotateY: active ? 0 : 180 }}
        transition={{
          duration: 0.6,
          ease: "easeInOut",
          delay,
        }}
        className="relative size-full will-change-transform"
        style={{ transformStyle: "preserve-3d" }}
      >
        <div
          className="absolute inset-0 grid place-content-center rounded-md bg-white text-black outline-[0.5px] outline-stone-300"
          style={{ backfaceVisibility: "hidden" }}
        >
          <span className="text-[2vw] font-bold">{letter}</span>
        </div>

        <div
          className="absolute inset-0 rounded-md bg-stone-100"
          style={{
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
          }}
        />
      </motion.div>
    </div>
  );
});

Tile.displayName = "Tile";

type WordProps = {
  word: string;
  active: boolean;
};

const Word = memo(({ word, active }: WordProps) => {
  return (
    <div className="flex gap-2">
      {word.split("").map((letter, index) => (
        <Tile
          key={`${word}-${index}`}
          letter={letter}
          active={active}
          delay={index * 0.07}
        />
      ))}
    </div>
  );
});

Word.displayName = "Word";

const Flipper = () => {
  const [activeWords, setActiveWords] = useState<Set<number>>(
    () => getRandomIndexes(WORD_LIST.length, ACTIVE_WORD_COUNT),
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveWords(
        getRandomIndexes(WORD_LIST.length, ACTIVE_WORD_COUNT),
      );
    }, FLIP_INTERVAL);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
      <div className="flex size-full flex-wrap items-center justify-center gap-[1vw] p-[2vw] blur-[6px]">
        {WORD_LIST.map((word, index) => (
          <Word
            key={word}
            word={word}
            active={activeWords.has(index)}
          />
        ))}
      </div>
    </div>
  );
};

export default Flipper;