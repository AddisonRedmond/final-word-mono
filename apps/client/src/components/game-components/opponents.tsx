import type { PlayerDisplay } from "@/types/battle-royale.types";
import OpponentTimer from "./opponent-timer";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  GAP,
  GUESS_LENGTH,
  HOPPER_FONT_RATIO,
  HOPPER_TILE_RATIO,
  REVEALED_FONT_RATIO,
  REVEALED_TILE_RATIO,
  getCardHeight,
  getWidthForHeight,
  isSameQueue,
  isSameRevealedLetters,
} from "@/utils/opponents";

export type OpponentWithId = PlayerDisplay & {
  id: string;
};

type OpponentsProps = {
  opponents: OpponentWithId[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

type ContainerSize = {
  width: number;
  height: number;
};

type OpponentCardProps = {
  opponent: OpponentWithId;
  width: number;
  selected: boolean;
  onSelect: (id: string) => void;
};



const Opponents = memo(
  ({ opponents, selectedId, onSelect }: OpponentsProps) => {
    const ref = useRef<HTMLDivElement>(null);

    const activeOpponents = useMemo(
      () => opponents.filter((opponent) => !opponent.isEliminated),
      [opponents],
    );

    const [containerSize, setContainerSize] = useState<ContainerSize>({
      width: 0,
      height: 0,
    });

    useEffect(() => {
      const element = ref.current;

      if (!element) return;

      const observer = new ResizeObserver(([entry]) => {
        if (!entry) return;

        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);

        setContainerSize((previous) => {
          if (previous.width === width && previous.height === height) {
            return previous;
          }

          return {
            width,
            height,
          };
        });
      });

      observer.observe(element);

      return () => observer.disconnect();
    }, []);

    const opponentWidth = useMemo(() => {
      const count = activeOpponents.length;

      if (!count || !containerSize.width || !containerSize.height) {
        return 0;
      }

      let largestWidth = 0;

      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);

        const availableWidth =
          (containerSize.width - GAP * (columns - 1)) / columns;

        const availableHeight =
          (containerSize.height - GAP * (rows - 1)) / rows;

        const maxWidthFromHeight = getWidthForHeight(availableHeight);

        const cardWidth = Math.min(availableWidth, maxWidthFromHeight);

        largestWidth = Math.max(largestWidth, cardWidth);
      }

      return Math.max(0, largestWidth);
    }, [activeOpponents.length, containerSize.width, containerSize.height]);

    return (
      <div
        ref={ref}
        className="min-h-0 min-w-0 flex-1 overflow-auto scrollbar-gutter-stable"
      >
        <div className="flex flex-wrap content-start justify-evenly gap-2">
          <AnimatePresence mode="popLayout">
            {activeOpponents.map((opponent) => (
              <OpponentCard
                key={opponent.id}
                opponent={opponent}
                width={opponentWidth}
                selected={opponent.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    );
  },
);

Opponents.displayName = "Opponents";

const areCardPropsEqual = (
  previous: OpponentCardProps,
  next: OpponentCardProps,
) => {
  if (previous.width !== next.width || previous.selected !== next.selected) {
    return false;
  }

  const previousOpponent = previous.opponent;
  const nextOpponent = next.opponent;

  if (previousOpponent === nextOpponent) {
    return true;
  }

  return (
    previousOpponent.life === nextOpponent.life &&
    isSameRevealedLetters(
      previousOpponent.revealed_letters,
      nextOpponent.revealed_letters,
    ) &&
    isSameQueue(previousOpponent.display_queue, nextOpponent.display_queue)
  );
};

const OpponentCard = memo(
  ({ opponent, width, selected, onSelect }: OpponentCardProps) => {
    const hopperTileSize = width * HOPPER_TILE_RATIO;
    const revealedTileSize = width * REVEALED_TILE_RATIO;

    return (
      <motion.div
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
          opacity: {
            duration: 0.2,
          },
          scale: {
            duration: 0.25,
            ease: "easeOut",
          },
          layout: {
            duration: 0.25,
            ease: "easeOut",
          },
        }}
        onClick={() => onSelect(opponent.id)}
        className={`flex cursor-pointer flex-col items-center justify-between gap-y-1 rounded-lg bg-zinc-100 p-1.5 shadow-md transition-shadow ${
          selected ? "ring-2 ring-emerald-500 ring-offset-1" : ""
        }`}
        style={{
          width,
          height: getCardHeight(width),
        }}
      >
        <OpponentTimer
          initials={opponent.name}
          duration={180_000}
          expiryTimestamp={opponent.life}
        />

        <div className="flex flex-col items-center gap-y-0.5">
          <AnimatePresence initial={false}>
            {opponent.display_queue?.map((item, queueIndex) => (
              <motion.div
                key={queueIndex}
                layout
                initial={{
                  opacity: 0,
                  y: -10,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                  y: 12,
                }}
                transition={{
                  duration: 0.25,
                  ease: "easeIn",
                }}
                className="flex gap-x-0.5"
              >
                {Array.from({ length: GUESS_LENGTH }, (_, index) => (
                  <div
                    key={index}
                    className="grid place-content-center rounded-sm bg-stone-300 font-semibold text-stone-700"
                    style={{
                      width: hopperTileSize,
                      height: hopperTileSize,
                      fontSize: hopperTileSize * HOPPER_FONT_RATIO,
                    }}
                  >
                    {item[index] ?? " "}
                  </div>
                ))}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="flex gap-x-0.5">
          {Array.from({ length: GUESS_LENGTH }, (_, index) => (
            <div
              key={index}
              className="grid place-content-center rounded-sm bg-emerald-500 font-semibold text-white"
              style={{
                width: revealedTileSize,
                height: revealedTileSize,
                fontSize: revealedTileSize * REVEALED_FONT_RATIO,
              }}
            >
              {opponent.revealed_letters?.[index] ?? " "}
            </div>
          ))}
        </div>
      </motion.div>
    );
  },
  areCardPropsEqual,
);

OpponentCard.displayName = "OpponentCard";

export default Opponents;
