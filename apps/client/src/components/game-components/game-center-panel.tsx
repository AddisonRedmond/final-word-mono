import type { ReactNode } from "react";

type GameCenterPanelProps = {
  children: ReactNode;
  /** Extra classes appended to the panel (e.g. a mode-specific tweak). */
  className?: string;
};

/**
 * The central play-area container used by the realtime game modes (Battle
 * Royale, Race): the styled column that sits between the two flanking opponent
 * columns and holds the timer, board, keyboard, and overlay/leave states.
 *
 * Extracted from `battle-royale.tsx` so both modes share one look — a raised,
 * translucent, rounded panel — instead of each hand-rolling the wrapper. Layout
 * (flex column, centered, gap) lives here too so the modes only supply content.
 */
const GameCenterPanel = ({ children, className = "" }: GameCenterPanelProps) => (
  <div
    // Mobile-first: below `lg` the panel is full-bleed (no card chrome, no side
    // margins) because the opponent columns are replaced by a compact target
    // bar and every pixel of width goes to the board. From `lg` up it is the
    // original raised, translucent card between the flanking columns.
    className={`flex w-full min-w-0 flex-col items-center justify-center gap-3 px-2 lg:mx-5 lg:w-auto lg:rounded-xl lg:border lg:border-zinc-400 lg:bg-zinc-100/75 lg:shadow-xl ${className}`}
  >
    {children}
  </div>
);

export default GameCenterPanel;
