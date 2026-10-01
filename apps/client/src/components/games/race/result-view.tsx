import type { FireworksProps } from "@fireworks-js/react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useState } from "react";
import type { MatchResult } from "@/hooks/useRaceSocket";
import type { ClientRaceMatch } from "@/types/race.types";

type ResultViewProps = {
  /** Current match snapshot from the Race socket. */
  match: ClientRaceMatch;
  /** This player's id. */
  userId: string;
  /** Final match result from `match:result`. */
  result: MatchResult | undefined;
  /** Leave the match. */
  onLeave: () => void;
};

/** Turn a 1-based placement into an ordinal label ("1st", "2nd", "3rd"…). */
const ordinal = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/**
 * Match result view (Req 10.5), restyled to match Battle Royale's `Winner`
 * overlay. The winning player sees a "VICTORY" card with fireworks (loaded the
 * same lazy way as Battle Royale's `Winner`); everyone else sees a matching
 * card headed by the outcome ("Winner"/"Draw") with their own placement and the
 * full ranking.
 *
 * The winner is resolved from `result.winnerId` (falling back to
 * `room.winnerId`) to a display name via `match.players`. When the match is a
 * draw there is no winner. The full placement ranking comes from
 * `result.placements` — a winner-first list of `{ playerId, placement }`
 * entries (Req 6.6) — resolved to names, with this player's own row
 * highlighted. Own placement falls back to `match.players[userId].placement`
 * if the result payload hasn't arrived yet.
 */
const ResultView: React.FC<ResultViewProps> = ({
  match,
  userId,
  result,
  onLeave,
}) => {
  const nameFor = (id: string) => match.players[id]?.name ?? id;

  const isDraw = match.room.isDraw;
  const winnerId = result?.winnerId ?? match.room.winnerId;
  const winnerName = winnerId ? nameFor(winnerId) : undefined;
  const youWon = winnerId !== undefined && winnerId === userId;

  // Prefer the result payload's ordering; derive own placement from it, then
  // fall back to the snapshot's persisted placement. Each entry is a
  // { playerId, placement } object.
  const placements = result?.placements ?? [];
  const ownEntry = placements.find((entry) => entry.playerId === userId);
  const ownPlacement = ownEntry?.placement ?? match.players[userId]?.placement;

  const player = match.players[userId];

  const [Fireworks, setFireworks] =
    useState<ComponentType<FireworksProps> | null>(null);

  useEffect(() => {
    if (!youWon) {
      return;
    }

    let mounted = true;

    const loadFireworks = async () => {
      const { Fireworks } = await import("@fireworks-js/react");
      if (mounted) {
        setFireworks(() => Fireworks);
      }
    };

    void loadFireworks();

    return () => {
      mounted = false;
    };
  }, [youWon]);

  const headerClass = youWon
    ? "border-white/15 border-b bg-yellow-300 px-6 py-3 text-center font-black text-sm text-zinc-950 tracking-[0.2em]"
    : isDraw
      ? "border-white/15 border-b bg-stone-300 px-6 py-3 text-center font-black text-sm text-zinc-950 tracking-[0.2em]"
      : "border-white/15 border-b bg-red-400 px-6 py-3 text-center font-black text-sm text-zinc-950 tracking-[0.2em]";

  const cardBorder = youWon
    ? "border-yellow-200/70"
    : isDraw
      ? "border-stone-400/70"
      : "border-red-300/70";

  const headline = isDraw ? "Draw" : youWon ? "Victory" : "Eliminated";

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center overflow-hidden"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {youWon && Fireworks && (
          <div className="absolute inset-0 h-full w-full">
            <Fireworks
              className="absolute inset-0 h-full w-full"
              options={{
                autoresize: true,
                opacity: 0.5,
                acceleration: 1.05,
                friction: 0.97,
                gravity: 1.5,
                particles: 50,
                traceLength: 3,
                traceSpeed: 10,
                explosion: 5,
                intensity: 30,
                flickering: 50,
                hue: { min: 0, max: 360 },
                delay: { min: 30, max: 60 },
                rocketsPoint: { min: 25, max: 75 },
              }}
            />
          </div>
        )}

        <motion.div
          animate={{ scale: 1, opacity: 1 }}
          className={`relative z-10 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border ${cardBorder} bg-zinc-950/90 text-white shadow-2xl`}
          initial={{ scale: 0.8, opacity: 0 }}
          transition={{
            delay: 0.15,
            duration: 0.5,
            type: "spring",
            stiffness: 180,
            damping: 15,
          }}
        >
          <div className={headerClass}>{headline}</div>
          <div className="px-6 py-7 text-center">
            {isDraw ? (
              <p className="font-medium text-sm text-zinc-400 uppercase tracking-[0.16em]">
                No survivors
              </p>
            ) : youWon ? (
              <>
                <p className="font-medium text-sm text-zinc-400 uppercase tracking-[0.16em]">
                  You had the FINAL WORD
                </p>
                <h2 className="wrap-break-word mt-2 font-black text-4xl text-yellow-300 tracking-wide">
                  {player?.name ?? "You"}
                </h2>
              </>
            ) : (
              <>
                <p className="font-medium text-sm text-zinc-400 uppercase tracking-[0.16em]">
                  Winner
                </p>
                <h2 className="wrap-break-word mt-2 font-black text-4xl text-emerald-300 tracking-wide">
                  {winnerName ?? "—"}
                </h2>
                {ownPlacement !== undefined && (
                  <p className="mt-3 font-semibold text-sm text-zinc-300">
                    You finished{" "}
                    <span className="font-black text-emerald-300 uppercase tracking-wider">
                      {ordinal(ownPlacement)}
                    </span>
                  </p>
                )}
              </>
            )}

            <button
              className="mt-7 w-full rounded-md bg-white px-4 py-2.5 font-bold text-sm text-zinc-950 uppercase tracking-wider transition-colors hover:bg-stone-300"
              onClick={onLeave}
              type="button"
            >
              Leave
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ResultView;
