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

import { db, eq, raceStats } from "db";

import { guestModeGate } from "../guest-mode-gate.js";
import logger from "../../utils/logger.js";

/**
 * Optional registered-user daily cap, read from the `DAILY_GAME_LIMIT` env var.
 * Unset or non-positive => dormant (registered users are never gated), which
 * preserves the beta behavior. Set to a positive integer (e.g. 3) to enforce a
 * per-user cap on realtime games.
 *
 * NOTE: enforcement currently counts the lifetime `gamesPlayed` aggregate, not a
 * rolling 24h window — enough to exercise/trigger the `daily-limit` client
 * notice. Swapping in true 24h-windowed counting is a change to this one spot.
 */
const registeredDailyLimit = (): number | null => {
  const raw = Number(process.env.DAILY_GAME_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
};

/**
 * Returns whether the player may start a match against their daily usage.
 *
 * Dormant beta implementation: always permits (Req 11.2).
 *
 * Future enforcing implementation: return `false` only when the
 * Daily_Game_Counter is available and the player has reached the daily limit
 * (Req 11.3); fail open (return `true`) on any counter-backend error.
 *
 * Guest (anonymous) players additionally pass through the shared one-game-per-
 * mode gate (R6.1, R6.2): the decision delegates to `guestModeGate` against
 * this mode's `raceStats` row. Registered users are never gated (R6.8) and
 * short-circuit to `true` without reading any stats — preserving the dormant
 * beta behavior.
 */
export const canStartMatch = async (
  userId: string,
  isAnonymous: boolean, // from socket.data.isAnonymous via the join handler
): Promise<boolean> => {
  // Registered users: gated only when DAILY_GAME_LIMIT is set (otherwise the
  // dormant beta behavior, Req 11.2, R6.8 — permit without reading stats).
  if (!isAnonymous) {
    const limit = registeredDailyLimit();
    if (limit === null) return true;
    try {
      const rows = await db
        .select({ gamesPlayed: raceStats.gamesPlayed })
        .from(raceStats)
        .where(eq(raceStats.userId, userId))
        .limit(1);
      const played = rows[0]?.gamesPlayed ?? 0;
      // Block once the user has reached the configured limit.
      return played < limit;
    } catch (error) {
      // Fail open: a stats outage must never block play (Req 11.3 policy).
      logger.error(
        { userId, err: error instanceof Error ? error.message : error },
        "race daily-limit stats read failed; failing open (ALLOW)",
      );
      return true;
    }
  }
  // Guests: one game per mode, derived from this mode's stats row (R6.1, R6.2).
  return guestModeGate(userId, raceStats);
};

/**
 * Records a match start against the player's daily usage.
 *
 * Dormant beta implementation: no-op (Req 11.1).
 *
 * Future enforcing implementation: increment the Daily_Game_Counter for the
 * player; swallow/log backend errors rather than throwing so a counter outage
 * never breaks the game loop.
 */
export const recordMatchStart = async (_userId: string): Promise<void> => {}; // Req 11.1
