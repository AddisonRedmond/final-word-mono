import type {
  PlayerDisplay,
  RevealedLetters,
} from "@/types/battle-royale.types";
import OpponentTimer from "./opponent-timer";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type OpponentsProps = {
  opponents: PlayerDisplay[];
};

const GAP = 8;
const ASPECT_RATIO = 8 / 5;
const GUESS_LENGTH = 5;

const Opponents = memo(({ opponents }: OpponentsProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, []);

  const { width, height } = size;

  const opponentWidth = useMemo(() => {
    let widest = 0;

    for (let cols = 1; cols <= opponents.length; cols++) {
      const rows = Math.ceil(opponents.length / cols);

      const availableWidth = (width - GAP * (cols - 1)) / cols;
      const availableHeight = (height - GAP * (rows - 1)) / rows;

      const widthFromHeight = availableHeight * ASPECT_RATIO;

      const currentWidth = Math.min(availableWidth, widthFromHeight);

      if (currentWidth > widest) {
        widest = currentWidth;
      }
    }

    return widest;
  }, [opponents.length, width, height]);

  return (
    <div ref={ref} className="grow overflow-y-auto overflow-x-hidden">
      <div className="flex flex-wrap content-start justify-evenly gap-2">
        <AnimatePresence>
          {opponents.map((opponent) => (
            <OpponentCard
              key={opponent.name}
              opponent={opponent}
              width={opponentWidth}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});

Opponents.displayName = "Opponents";

type OpponentCardProps = {
  opponent: PlayerDisplay;
  width: number;
};

// socket.io round-trips every player through JSON each tick, so the `opponent`
// object reference is never stable - compare rendered fields instead of identity
// to let unaffected tiles skip re-rendering entirely.
const isSameRevealedLetters = (a?: RevealedLetters, b?: RevealedLetters) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[Number(key)] === b[Number(key)]);
};

const isSameQueue = (a?: RevealedLetters[], b?: RevealedLetters[]) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((entry, index) => isSameRevealedLetters(entry, b[index]));
};

const areCardPropsEqual = (
  prev: OpponentCardProps,
  next: OpponentCardProps,
) => {
  if (prev.width !== next.width) return false;

  const a = prev.opponent;
  const b = next.opponent;

  return (
    a === b ||
    (a.life === b.life &&
      isSameRevealedLetters(a.revealed_letters, b.revealed_letters) &&
      isSameQueue(a.display_queue, b.display_queue))
  );
};

const OpponentCard = memo(({ opponent, width }: OpponentCardProps) => {
  return (
    <motion.div
      initial={{
        opacity: 0,
        scale: 0.7,
      }}
      animate={{
        opacity: 1,
        scale: 1,
      }}
      exit={{
        opacity: 0,
        scale: 0.7,
      }}
      transition={{
        opacity: {
          duration: 0.2,
        },
        scale: {
          duration: 0.25,
          ease: "easeOut",
        },
      }}
      className="flex flex-col items-center justify-between gap-y-1 rounded-lg bg-zinc-100 p-1.5 shadow-md"
      style={{
        width,
        height: width / ASPECT_RATIO,
      }}
    >
      <OpponentTimer
        initials="B"
        duration={180_000}
        expiryTimestamp={opponent.life}
      />

      <div className="flex flex-col items-center gap-y-0.5">
        {opponent.display_queue?.map((item, queueIndex) => (
          <div key={queueIndex} className="flex gap-x-0.5">
            {Array.from({ length: GUESS_LENGTH }, (_, index) => (
              <div
                key={index}
                className="grid size-2 place-content-center rounded-sm bg-stone-300 text-[6px] font-semibold text-stone-700"
              >
                {item[index] ?? " "}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex gap-x-0.5">
        {Array.from({ length: GUESS_LENGTH }, (_, index) => (
          <div
            key={index}
            className="grid size-3 place-content-center rounded-sm bg-emerald-500 text-[8px] font-semibold text-white"
          >
            {opponent?.revealed_letters?.[index] ?? " "}
          </div>
        ))}
      </div>
    </motion.div>
  );
}, areCardPropsEqual);

OpponentCard.displayName = "OpponentCard";

export default Opponents;
