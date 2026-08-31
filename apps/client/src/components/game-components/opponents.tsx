import type { PlayerDisplay } from "@/types/battle-royale.types";
import CircularTimer from "./opponent-timer";
import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type OpponentsProps = {
  opponents: PlayerDisplay[];
};

const GAP = 8;
const ASPECT_RATIO = 1 / 2;

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
    <motion.div ref={ref} className="grow overflow-hidden">
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
              className="flex flex-col items-center justify-between rounded-lg bg-zinc-100 shadow-md"
              style={{
                width: opponentWidth,
                height: opponentWidth / ASPECT_RATIO,
              }}
            >
              <div className="size-5">
                <CircularTimer
                  initials="B"
                  duration={180_000}
                  expiryTimestamp={opponent.life}
                />
              </div>

              <span>{opponent.name}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});


export default Opponents;