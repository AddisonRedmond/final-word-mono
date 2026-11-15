import { LayoutGrid } from "lucide-react";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { getServerNow } from "@/state/server-clock-store";
import type {
  ClientBattleRoyalePlayer,
  TargetMode,
} from "@/types/battle-royale.types";
import { determineTarget, getInitials } from "@/utils/battle-royale";
import { flatTileClasses } from "@/utils/letter-states";

const LIFE_DURATION_MS = 90_000;
const GUESS_LENGTH = 5;

const RING_SIZE = 56;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type Players = Record<string, ClientBattleRoyalePlayer>;

type MobileTargetBarProps = {
  players: Players;
  userId: string;
  targetMode: TargetMode;
  /** Concrete opponent id currently being attacked. */
  target: string;
  onSelectMode: (mode: "first" | "last" | "random") => void;
  onOpenAll: () => void;
};

/**
 * The progress arc of a ring: how much of an opponent's life timer is left.
 * Driven by a small interval writing straight to the DOM so the rings animate
 * without re-rendering React every tick.
 */
const LifeArc = memo(({ expiry }: { expiry: number }) => {
  const ref = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const arc = ref.current;
    if (!arc) return;

    const update = () => {
      const remaining = Math.max(0, expiry - getServerNow());
      const progress = Math.min(1, remaining / LIFE_DURATION_MS);
      arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    };

    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [expiry]);

  return (
    <circle
      ref={ref}
      cx={RING_SIZE / 2}
      cy={RING_SIZE / 2}
      r={RING_RADIUS}
      fill="none"
      stroke="currentColor"
      strokeWidth={RING_STROKE}
      strokeLinecap="round"
      strokeDasharray={RING_CIRCUMFERENCE}
      className="text-emerald-400 transition-[stroke-dashoffset] duration-300 ease-linear"
      style={{ strokeDashoffset: 0 }}
    />
  );
});

LifeArc.displayName = "LifeArc";

type TargetRingProps = {
  /** Caption under the ring (the targeting mode, e.g. "First"). */
  caption: string;
  ariaLabel: string;
  selected: boolean;
  onClick: () => void;
  /** The opponent this ring currently resolves to, if any. */
  player?: ClientBattleRoyalePlayer;
  /** Shown in the ring when there's no opponent to display. */
  fallback?: ReactNode;
};

const TargetRing = ({
  caption,
  ariaLabel,
  selected,
  onClick,
  player,
  fallback,
}: TargetRingProps) => (
  <button
    aria-label={ariaLabel}
    aria-pressed={selected}
    className="flex min-w-14 cursor-pointer flex-col items-center gap-y-1 rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    onClick={onClick}
    type="button"
  >
    <span
      className={`relative grid place-content-center rounded-full transition-colors ${
        selected ? "bg-emerald-500/20 ring-2 ring-emerald-400" : "bg-zinc-100/60"
      }`}
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 -rotate-90 text-zinc-300"
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        width={RING_SIZE}
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
        />
        {player && <LifeArc expiry={player.life} />}
      </svg>
      <span className="relative font-display text-sm text-ink uppercase">
        {player ? getInitials(player.name) : fallback}
      </span>
    </span>
    <span
      className={`font-semibold text-[11px] uppercase tracking-wide ${
        selected ? "text-ink" : "text-zinc-500"
      }`}
    >
      {caption}
    </span>
  </button>
);

/**
 * Mobile replacement for the flanking opponent columns + the First/Random/Last
 * pill picker: one row of four rings.
 *
 * - First / Random / Last: set the targeting mode. First and Last show the
 *   opponent they currently resolve to (live); Random shows whoever was rolled.
 * - All: opens the full opponent grid to lock a specific player. While a
 *   specific player is locked, this ring shows them.
 *
 * Each ring's arc is that opponent's remaining life timer.
 */
const MobileTargetBar = ({
  players,
  userId,
  targetMode,
  target,
  onSelectMode,
  onOpenAll,
}: MobileTargetBarProps) => {
  const firstId = useMemo(
    () => determineTarget(players, userId, "first"),
    [players, userId],
  );
  const lastId = useMemo(
    () => determineTarget(players, userId, "last"),
    [players, userId],
  );

  const aliveCount = useMemo(
    () =>
      Object.entries(players).filter(
        ([id, player]) => id !== userId && !player.isEliminated,
      ).length,
    [players, userId],
  );

  const randomPlayer = targetMode === "random" ? players[target] : undefined;
  const lockedPlayer = targetMode === "player" ? players[target] : undefined;

  return (
    <div
      aria-label="Choose who to attack"
      className="flex w-full items-start justify-around"
      role="group"
    >
      <TargetRing
        ariaLabel="Attack the leader"
        caption="First"
        onClick={() => onSelectMode("first")}
        player={firstId ? players[firstId] : undefined}
        selected={targetMode === "first"}
      />
      <TargetRing
        ariaLabel="Attack a random opponent"
        caption="Random"
        fallback="?"
        onClick={() => onSelectMode("random")}
        player={randomPlayer}
        selected={targetMode === "random"}
      />
      <TargetRing
        ariaLabel="Attack the trailing player"
        caption="Last"
        onClick={() => onSelectMode("last")}
        player={lastId ? players[lastId] : undefined}
        selected={targetMode === "last"}
      />
      <TargetRing
        ariaLabel={`Pick a specific opponent (${aliveCount} alive)`}
        caption="All"
        fallback={<LayoutGrid aria-hidden="true" className="size-5" />}
        onClick={onOpenAll}
        player={lockedPlayer}
        selected={targetMode === "player"}
      />
    </div>
  );
};

type TopOpponentsProps = {
  players: Players;
  userId: string;
  /** Concrete opponent id currently being attacked. */
  target: string;
  onSelect: (id: string) => void;
};

const TOP_COUNT = 3;

type RowProps = {
  rank?: number;
  player: ClientBattleRoyalePlayer;
  selected: boolean;
  onClick: () => void;
};

/**
 * One opponent as a compact row: rank, initials, their revealed letters
 * (green) and the attack words already queued against them (small rows).
 */
const OpponentRow = memo(({ rank, player, selected, onClick }: RowProps) => (
  <button
    aria-label={`Target ${getInitials(player.name)}`}
    aria-pressed={selected}
    className={`flex h-9 w-full cursor-pointer touch-manipulation select-none items-center gap-x-2 rounded-lg px-2 text-left transition-colors ${
      selected
        ? "bg-emerald-500/20 ring-2 ring-emerald-400"
        : "bg-zinc-100/60"
    }`}
    onClick={onClick}
    type="button"
  >
    <span className="w-3 shrink-0 text-center font-semibold text-[10px] text-zinc-500 tabular-nums">
      {rank ?? ""}
    </span>
    <span className="w-6 shrink-0 font-display text-[11px] text-zinc-600 uppercase">
      {getInitials(player.name)}
    </span>

    <div className="flex shrink-0 gap-x-0.5">
      {Array.from({ length: GUESS_LENGTH }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row
          key={index}
          className={`grid size-6 place-content-center rounded-sm font-semibold text-xs ${flatTileClasses.correct}`}
        >
          {player.revealed_letters?.[index] ?? " "}
        </div>
      ))}
    </div>

    <div className="flex min-w-0 flex-1 items-center justify-end gap-x-2 overflow-x-auto [scrollbar-width:none]">
      {player.display_queue?.map((word, wordIndex) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: queue rows are positional
          key={wordIndex}
          className="flex shrink-0 gap-x-px"
        >
          {Array.from({ length: GUESS_LENGTH }, (_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional tile row
              key={index}
              className={`grid size-3.5 place-content-center rounded-[2px] font-semibold text-[9px] ${flatTileClasses.default}`}
            >
              {word[index] ?? " "}
            </div>
          ))}
        </div>
      ))}
    </div>
  </button>
));

OpponentRow.displayName = "OpponentRow";

/**
 * The top 3 living opponents (most life first) as tappable rows, so you can see
 * the leaders' letters and incoming words and lock one with a tap. If the
 * current target isn't in the top 3 (Last, Random, or a pick from the All
 * sheet) it takes the last slot so you always see who you're about to hit.
 */
const TopOpponents = memo(
  ({ players, userId, target, onSelect }: TopOpponentsProps) => {
    const rows = useMemo(() => {
      const ranked = Object.entries(players)
        .filter(([id, player]) => id !== userId && !player.isEliminated)
        .sort(([, a], [, b]) => b.life - a.life)
        .map(([id, player], index) => ({ id, player, rank: index + 1 }));

      const top = ranked.slice(0, TOP_COUNT);
      const targetRow = ranked.find((row) => row.id === target);

      if (targetRow && !top.some((row) => row.id === target)) {
        top[TOP_COUNT - 1] = targetRow;
      }
      return top;
    }, [players, userId, target]);

    return (
      <div className="flex min-h-[7.5rem] w-full flex-col gap-y-1">
        {rows.map(({ id, player, rank }) => (
          <OpponentRow
            key={id}
            onClick={() => onSelect(id)}
            player={player}
            rank={rank}
            selected={id === target}
          />
        ))}
      </div>
    );
  },
);

TopOpponents.displayName = "TopOpponents";

export { TopOpponents };
export default MobileTargetBar;
