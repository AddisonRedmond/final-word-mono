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
    className={`mx-5 flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-400 bg-zinc-100/75 px-2 shadow-xl ${className}`}
  >
    {children}
  </div>
);

export default GameCenterPanel;
