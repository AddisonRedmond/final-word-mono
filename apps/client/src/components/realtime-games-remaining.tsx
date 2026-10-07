// Home-screen indicator of a free user's realtime play allowance for the
// current UTC day: "2 / 3 games remaining today", with a live "resets in …"
// countdown to the next UTC midnight.
//
// The allowance is a single pool SHARED across Battle Royale and Race (the game
// server counts both against one per-day counter), so this renders once near the
// realtime cards rather than per card.
//
// Renders nothing for:
//   - guests (they have the separate one-game-per-mode gate + sign-up prompt),
//   - premium users (unlimited realtime play),
//   - the loading/unknown state (avoids a flash of a wrong count).

import { useEffect, useState } from "react";
import { TIER_LIMITS } from "@/db/schema";
import { useIsGuest } from "@/hooks/useIsGuest";
import { usePremium } from "@/hooks/usePremium";
import { api } from "@/utils/api";

/** Formats milliseconds until reset as "Hh Mm" (or "Mm" under an hour). */
const formatResetIn = (ms: number): string => {
  if (ms <= 0) {
    return "soon";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const RealtimeGamesRemaining: React.FC = () => {
  const isGuest = useIsGuest();
  // Premium status resolves faster than the usage row and tells us immediately
  // whether to show the counter at all (premium = unlimited, nothing to show).
  const { isPremium } = usePremium();

  // Guests can't query this (guestProtectedProcedure) and have their own gate.
  const { data } = api.billing.realtimeUsage.useQuery(undefined, {
    enabled: !isGuest,
    // Keep in step with the server counter; refetch when the user returns.
    refetchOnWindowFocus: true,
  });

  // Live countdown to the UTC-midnight reset, recomputed each minute.
  const [resetIn, setResetIn] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.resetsAt) {
      setResetIn(null);
      return;
    }
    const target = new Date(data.resetsAt).getTime();
    const tick = () => setResetIn(formatResetIn(target - Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [data?.resetsAt]);

  // Nothing to show for guests or premium (unlimited realtime play).
  if (isGuest || isPremium || data?.isPremium) {
    return null;
  }

  // Show the free limit immediately using TIER_LIMITS as a fallback, so the
  // pill is visible before the usage row loads rather than flashing empty.
  // Once the real usage arrives it replaces the fallback.
  const limit = data?.limit ?? TIER_LIMITS.free.realtimeGamesPerDay ?? 0;
  const remaining = data?.remaining ?? limit;
  const noneLeft = remaining <= 0;

  return (
    <div
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest shadow-sm backdrop-blur-sm ${
        noneLeft
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-gray-200 bg-white/70 text-gray-600"
      }`}
    >
      <span
        className={`grid size-5 shrink-0 place-content-center rounded-md font-bold text-[11px] text-white ${
          noneLeft ? "bg-amber-400" : "bg-green-400"
        }`}
      >
        {remaining}
      </span>
      <span>/ {limit} games left today</span>
      {resetIn && <span className="text-gray-400">· resets in {resetIn}</span>}
    </div>
  );
};

export default RealtimeGamesRemaining;
