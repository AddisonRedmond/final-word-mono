/**
 * Daily-limit seam for Battle_Royale_Mode.
 *
 * Battle Royale had no daily-limit seam before the guest (anonymous) feature;
 * this module is introduced additively so the one-game-per-mode rule can cover
 * Battle Royale the same way it covers Race, keeping all match-start gating in
 * one place (R9.4). Every export carries a `guest`/`anon`-adjacent identifier so
 * the whole feature is greppable and removable in one pass.
 *
 * Behaviour mirrors Race's seam (`race/daily-limit.ts`):
 *   - Registered users (`!isAnonymous`) are never gated (R6.8).
 *   - Guests are allowed ONE realtime Battle Royale game, derived from this
 *     mode's own `battle_royale_stats` row via the shared `guestModeGate`
 *     (R6.1, R6.2, R6.4).
 *
 * Because the gate reads the *mode's own* stats table, a guest blocked in
 * Battle Royale can still start Race and vice versa (R6.4).
 *
 * Fail-open policy: `guestModeGate` resolves to `true` on any stats-store error
 * so a counter/stats outage never blocks play or crashes the game loop.
 */

import { battleRoyaleStats, db, eq } from "db";

import { guestModeGate } from "../guest-mode-gate.js";
import logger from "../../utils/logger.js";

/**
 * Optional registered-user daily cap, read from the `DAILY_GAME_LIMIT` env var.
 * Unset or non-positive => dormant (registered users never gated). Set to a
 * positive integer (e.g. 3) to enforce a per-user cap. See the Race seam for the
 * note on lifetime-vs-24h counting; this mirrors it against `battle_royale_stats`.
 */
const registeredDailyLimit = (): number | null => {
  const raw = Number(process.env.DAILY_GAME_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
};

/**
 * Returns whether the player may start a Battle Royale match.
 *
 * Registered users (`!isAnonymous`) always return `true` without reading stats
 * (R6.8). Guests delegate to `guestModeGate(userId, battleRoyaleStats)`, which
 * allows exactly one game per mode (R6.1, R6.2, R6.4).
 */
export const canStartMatch = async (
  userId: string,
  isAnonymous: boolean, // from socket.data.isAnonymous via the join handler
): Promise<boolean> => {
  // Registered users: gated only when DAILY_GAME_LIMIT is set (otherwise never
  // gated, R6.8).
  if (!isAnonymous) {
    const limit = registeredDailyLimit();
    if (limit === null) {
      return true;
    }
    try {
      const rows = await db
        .select({ gamesPlayed: battleRoyaleStats.gamesPlayed })
        .from(battleRoyaleStats)
        .where(eq(battleRoyaleStats.userId, userId))
        .limit(1);
      const played = rows[0]?.gamesPlayed ?? 0;
      return played < limit;
    } catch (error) {
      // Fail open: a stats outage must never block play.
      logger.error(
        { userId, err: error instanceof Error ? error.message : error },
        "battle-royale daily-limit stats read failed; failing open (ALLOW)",
      );
      return true;
    }
  }

  // Guests: one game per mode, derived from this mode's stats row (R6.1–R6.4).
  return guestModeGate(userId, battleRoyaleStats);
};
