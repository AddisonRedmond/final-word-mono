import type { PlayerDisplay } from "@/types/battle-royale.types";
import OpponentTimer from "./opponent-timer";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CARD_HEADER_HEIGHT,
  CARD_ROW_GAP,
  CARD_SECTION_GAP,
  CARD_TILE_FONT_RATIO,
  CARD_TILE_GAP,
  GAP,
  GUESS_LENGTH,
  MAX_OPPONENT_WIDTH,
  MAX_QUEUE_ROWS,
  getCardHeight,
  getCardTileSize,
  getInitials,
  getWidthForHeight,
  isSameQueue,
  isSameRevealedLetters,
} from "@/utils/opponents";
import type { RevealedLetters } from "@/types/battle-royale.types";

// Spare pixels left when fitting cards to the column (see `opponentWidth`).
const FIT_MARGIN = 4;

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

        // Round DOWN: rounding to nearest can report a container up to half a
        // pixel bigger than it is, and the layout below fills it exactly.
        const width = Math.floor(entry.contentRect.width);
        const height = Math.floor(entry.contentRect.height);

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

      // Size cards against a slightly smaller box. Filling the container
      // exactly leaves zero slack, so any sub-pixel rounding (fractional
      // container size, scrollbar gutter, DPR scaling) makes the content a
      // fraction of a pixel too big and a scrollbar appears even though
      // everything "fits". A few spare pixels absorb that.
      const usableWidth = containerSize.width - FIT_MARGIN;
      const usableHeight = containerSize.height - FIT_MARGIN;

      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);

        const availableWidth = (usableWidth - GAP * (columns - 1)) / columns;

        const availableHeight = (usableHeight - GAP * (rows - 1)) / rows;

        const maxWidthFromHeight = getWidthForHeight(availableHeight);

        const cardWidth = Math.min(availableWidth, maxWidthFromHeight);

        largestWidth = Math.max(largestWidth, cardWidth);
      }

      // Clamp to the cap so a small field (1-3 opponents) doesn't inflate each
      // card to fill the column and dwarf the player's own board. With a large
      // field the computed width is already below the cap, so this is a no-op.
      // Whole pixels, rounded down, so the total can never creep past the box.
      return Math.floor(
        Math.min(MAX_OPPONENT_WIDTH, Math.max(0, largestWidth)),
      );
    }, [activeOpponents.length, containerSize.width, containerSize.height]);

    return (
      <div
        ref={ref}
        className="min-h-0 min-w-0 flex-1 overflow-auto scrollbar-gutter-stable p-1"
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

const MIN_LEGIBLE_TILE = 7;

/**
 * One row of the mini board: five tiles, lime where the letter is known and
 * dark where it isn't. `queued` rows (attack words waiting behind the current
 * one) are dimmed slightly so the current word reads first.
 */
const BoardRow = ({
  letters,
  tileSize,
  queued = false,
}: {
  letters?: RevealedLetters;
  tileSize: number;
  queued?: boolean;
}) => (
  <div
    className={`flex ${queued ? "opacity-70" : ""}`}
    style={{ gap: CARD_TILE_GAP }}
  >
    {Array.from({ length: GUESS_LENGTH }, (_, index) => {
      const letter = letters?.[index];
      return (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row
          key={index}
          className={`grid place-content-center rounded-[3px] font-display leading-none ${
            letter ? "bg-lime text-ink" : "bg-white/6"
          }`}
          style={{
            width: tileSize,
            height: tileSize,
            fontSize: tileSize * CARD_TILE_FONT_RATIO,
          }}
        >
          {/* Below ~7px a glyph is an unreadable smudge; the lime fill alone
              shows the letter is known. */}
          {tileSize >= MIN_LEGIBLE_TILE ? (letter ?? "") : ""}
        </div>
      );
    })}
  </div>
);

const OpponentCard = memo(
  ({ opponent, width, selected, onSelect }: OpponentCardProps) => {
    const tileSize = getCardTileSize(width);
    // The initials chip lives up top; the life bar further down tints it too.
    const chipRef = useRef<HTMLSpanElement>(null);
    // The card reserves room for MAX_QUEUE_ROWS; never draw past it.
    const queue = opponent.display_queue?.slice(0, MAX_QUEUE_ROWS) ?? [];

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
        className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-panel-2/80 p-1 shadow-lg transition-[box-shadow,border-color] ${
          selected
            ? "border-lime shadow-[0_0_12px_rgba(182,255,46,0.35)] ring-1 ring-lime"
            : "border-white/10 hover:border-white/25"
        }`}
        style={{
          width,
          height: getCardHeight(width),
          gap: CARD_SECTION_GAP,
        }}
      >
        {/* Initials, above the word they're on. */}
        <div
          className="flex shrink-0 items-center"
          style={{ height: CARD_HEADER_HEIGHT }}
        >
          <span
            ref={chipRef}
            className="rounded-[3px] bg-graphite px-1 font-display text-[7px] text-white/80 uppercase leading-[11px] transition-colors"
          >
            {getInitials(opponent.name)}
          </span>
        </div>

        {/* The word they're guessing now. */}
        <BoardRow letters={opponent.revealed_letters} tileSize={tileSize} />

        {/* Life bar, doubling as the divider between the current word and
            the attack words queued behind it. */}
        <OpponentTimer
          chipRef={chipRef}
          duration={90_000}
          expiryTimestamp={opponent.life}
        />

        <div className="flex flex-col" style={{ gap: CARD_ROW_GAP }}>
          <AnimatePresence initial={false}>
            {queue.map((item, queueIndex) => (
              <motion.div
                // biome-ignore lint/suspicious/noArrayIndexKey: queue rows are positional and consumed front-first
                key={queueIndex}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <BoardRow letters={item} queued tileSize={tileSize} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  },
  areCardPropsEqual,
);

OpponentCard.displayName = "OpponentCard";

export default Opponents;
