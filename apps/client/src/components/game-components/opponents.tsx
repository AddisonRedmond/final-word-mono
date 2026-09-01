import type { PlayerDisplay } from "@/types/battle-royale.types";
import OpponentTimer from "./opponent-timer";
import { memo, useEffect, useRef, useState } from "react";
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

  let opponentWidth = 0;

  for (let cols = 1; cols <= opponents.length; cols++) {
    const rows = Math.ceil(opponents.length / cols);

    const availableWidth = (width - GAP * (cols - 1)) / cols;
    const availableHeight = (height - GAP * (rows - 1)) / rows;

    const widthFromHeight = availableHeight * ASPECT_RATIO;

    const currentWidth = Math.min(availableWidth, widthFromHeight);

    if (currentWidth > opponentWidth) {
      opponentWidth = currentWidth;
    }
  }

  return (
    <motion.div ref={ref} className="grow overflow-y-auto overflow-x-hidden">
      <div className="flex flex-wrap content-start justify-evenly gap-2">
        <AnimatePresence>
          {opponents.map((opponent) => (
            <motion.div
              key={opponent.name}
              layout
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
                layout: {
                  duration: 0.3,
                  ease: "easeInOut",
                },
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
                width: opponentWidth,
                height: opponentWidth / ASPECT_RATIO,
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
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

export default Opponents;
