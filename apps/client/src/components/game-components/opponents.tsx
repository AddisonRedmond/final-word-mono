import type { PlayerDisplay } from "@/types/game";
import CircularTimer from "./opponent-timer";
import { useEffect, useRef, useState } from "react";

type OpponentsProps = {
  opponents: PlayerDisplay[];
};

const GAP = 8;
const ASPECT_RATIO = 1 / 2;

const Opponents: React.FC<OpponentsProps> = ({ opponents }) => {
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

  /*
   * Find the number of columns that gives us the
   * largest possible opponent while still fitting
   * everything inside the container.
   */
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
    <div ref={ref} className="grow overflow-hidden">
      <div className="flex flex-wrap content-start justify-evenly gap-2">
        {opponents.map((opponent) => (
          <div
            key={opponent.name}
            className="flex flex-col items-center justify-between rounded-lg bg-zinc-100 shadow-md"
            style={{
              width: opponentWidth,
              height: opponentWidth / ASPECT_RATIO,
            }}
          >
            <div className="size-5">
              <CircularTimer initials="B" duration={120} remaining={60} />
            </div>

            <span>{opponent.name}</span>

            {/* opponent data goes here */}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Opponents;
