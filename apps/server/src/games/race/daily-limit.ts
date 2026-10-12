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

import {
  canStartRealtimeGame,
  recordRealtimeGameStart,
} from "../realtime-daily-limit.js";

/**
 * Returns whether the player may start a Race match.
 *
 * Players are gated by the shared free-tier realtime limit
 * (`canStartRealtimeGame`): free accounts get a fixed number of realtime games
 * per UTC day SHARED across Race and Battle Royale; premium is unlimited. A
 * block maps to the `daily-limit` `join:error` reason in the join handler.
 */
export const canStartMatch = async (userId: string): Promise<boolean> => {
  // Free: 3/UTC-day shared across modes, premium unlimited.
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
