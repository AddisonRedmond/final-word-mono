/**
 * Daily-limit seam for Race_Mode.
 *
 * This module is the single point of interaction with the Feature 1
 * Daily_Game_Counter (Req 11.4). All Daily_Game_Counter reads and writes are
 * isolated here so that enabling enforcement when Feature 1 ships requires a
 * change to this file ONLY — no Match or Round logic changes.
 *
 * During the beta period the counter does not exist yet, so the implementation
 * is dormant: `canStartMatch` always permits and `recordMatchStart` is a no-op.
 * This keeps Race_Mode unlimited and free during beta (Req 11.2).
 *
 * Fail-open policy for the future enforcing implementation:
 * `startMatch` awaits these functions defensively. The beta no-op cannot fail.
 * When a real Daily_Game_Counter implementation lands, it MUST fail open on
 * infrastructure errors — if the counter backend is unreachable or errors,
 * `canStartMatch` should resolve to `true` and `recordMatchStart` should
 * swallow the error rather than throw. A counter outage must never block play
 * or crash the game loop; the only intended way a player is blocked is when the
 * counter is available AND the player has genuinely reached the daily limit
 * (Req 11.3).
 */

import { raceStats } from "db";

import { guestModeGate } from "../guest-mode-gate.js";
import {
  canStartRealtimeGame,
  recordRealtimeGameStart,
} from "../realtime-daily-limit.js";

/**
 * Returns whether the player may start a Race match.
 *
 * Guests (`isAnonymous`) delegate to the shared one-game-per-mode gate
 * (`guestModeGate` against this mode's `raceStats` row, R6.1, R6.2) — unchanged.
 *
 * Registered users are gated by the shared free-tier realtime limit
 * (`canStartRealtimeGame`): free accounts get a fixed number of realtime games
 * per UTC day SHARED across Race and Battle Royale; premium is unlimited. This
 * replaces the old dormant lifetime-`gamesPlayed` stub (which could not express
 * a per-day limit). A block maps to the `daily-limit` `join:error` reason in
 * the join handler.
 *
 * NOTE: this seam is consulted at TWO points for Race (see `handlers.ts`): once
 * at join with the real `isAnonymous` (the gate), and once per real player at
 * match start pinned to `isAnonymous = false`. The match-start consultation is
 * post-admission, so the authoritative block is the join-time one; recording
 * (not re-blocking) is what matters at start, via `recordMatchStart`.
 */
export const canStartMatch = async (
  userId: string,
  isAnonymous: boolean, // from socket.data.isAnonymous via the join handler
): Promise<boolean> => {
  // Guests: one game per mode, derived from this mode's stats row (R6.1, R6.2).
  if (isAnonymous) {
    return guestModeGate(userId, raceStats);
  }

  // Registered users: free 3/UTC-day shared across modes, premium unlimited.
  return canStartRealtimeGame(userId);
};

/**
 * Records a Race match start against the shared realtime daily counter. Called
 * once per real player when a match actually starts (via `startMatch`'s seam).
 * No-op for premium; swallows errors so a counter outage never breaks the game
 * loop.
 */
export const recordMatchStart = async (userId: string): Promise<void> => {
  await recordRealtimeGameStart(userId);
};
