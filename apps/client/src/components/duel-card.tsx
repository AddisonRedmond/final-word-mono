import { LoaderCircle, Zap } from "lucide-react";
import GameCard from "./game-card";
import Link from "next/link";
import { useAuthStore } from "@/state/auth-store";
import { api } from "@/utils/api";

const PlayButton = () => (
  <Link href="/duels">
    <button className="flex items-center gap-2 w-full justify-center bg-green-400 hover:bg-green-300 active:scale-95 transition-all rounded-md py-2 text-white text-xs font-bold uppercase tracking-widest">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-3 h-3"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      Play
    </button>
  </Link>
);

// Quick Duel shortcut: deep-links to the duels page with a flag that triggers
// matchmaking on arrival (see `duels.tsx`). Kept as a link rather than calling
// the mutation here because a MATCHED caller must be routed into the duel
// board, which only the duels page can open — so matchmaking runs there.
//
// Disabled while the user is already waiting in the matchmaking queue. "Am I in
// the queue?" is SERVER state (the `duel_queue` table), so we read it from the
// shared `isInDuelQueue` tRPC query — the same one the duels page uses — rather
// than mirroring it into a client store, which would just risk drifting from
// the source of truth. React Query shares the cached result across both places.
const QuickDuelButton = () => {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: isInQueue } = api.duels.isInDuelQueue.useQuery(undefined, {
    enabled: Boolean(currentUserId),
    refetchOnWindowFocus: true,
  });

  // When queued, a navigating <Link> would let the user leave anyway, so render
  // a plain disabled button (no link) that reflects the waiting state instead.
  // Clearly distinct from the active button: amber "waiting" colour, a spinning
  // loader, a pulsing live dot, and explicit text so it's obvious at a glance
  // that matchmaking is already running.
  if (isInQueue) {
    return (
      <button
        type="button"
        disabled
        aria-label="Already searching for a quick duel opponent"
        className="flex items-center justify-center gap-2 w-full rounded-md border-2 border-amber-400 border-dashed bg-amber-50 py-2 text-amber-700 text-xs font-bold uppercase tracking-widest cursor-not-allowed"
      >
        <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        Finding opponent
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
      </button>
    );
  }

  return (
    <Link href="/duels?quick=1">
      <button className="flex items-center gap-2 w-full justify-center bg-blue-400 hover:bg-blue-300 active:scale-95 transition-all rounded-md py-2 text-white text-xs font-bold uppercase tracking-widest">
        <Zap className="w-3 h-3" aria-hidden="true" />
        Quick Duel
      </button>
    </Link>
  );
};
const DuelCard: React.FC = () => {
  return (
    <GameCard
      desc="Up to 5 opponents. Fewest guesses wins"
      title="Head to head"
      badge="1v1+"
      badgeVariant="gray"
      tiles={[
        { word: "D", variant: "correct" },
        { word: "U", variant: "present" },
        { word: "E", variant: "absent" },
        { word: "L", variant: "correct" },
      ]}
    >
      <div className="flex w-full flex-col gap-2">
        <PlayButton />
        <QuickDuelButton />
      </div>
    </GameCard>
  );
};

export default DuelCard;
