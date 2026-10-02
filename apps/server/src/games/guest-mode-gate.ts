/**
 * Shared per-mode gate for guest (anonymous) players.
 *
 * A guest is allowed ONE realtime game per game mode. The gate derives that
 * limit directly from the mode's aggregate stats row (`race_stats` /
 * `battle_royale_stats`) — the single source of truth, so there is no separate
 * in-progress tracking: a leaver-loss writes `gamesPlayed >= 1`, which blocks
 * the next start in that mode.
 *
 * Both mode daily-limit seams (`race/daily-limit.ts`,
 * `battle-royale/daily-limit.ts`) delegate here for guests; registered users
 * never reach this helper. Every export carries a `guest`/`anon` identifier so
 * the whole feature is greppable and removable in one pass.
 */

import { battleRoyaleStats, db, eq, raceStats } from "db";

import logger from "../utils/logger.js";

/**
 * The per-mode aggregate stats tables the gate can read. Each exposes a
 * `userId` key and a `gamesPlayed` counter (one row per user).
 */
export type GameModeStatsTable = typeof raceStats | typeof battleRoyaleStats;

/**
 * The error reason emitted to the client when a guest is blocked by the gate.
 * The join handlers map a block to this `join:error` reason so the client can
 * show the sign-up prompt.
 */
export const GUEST_MODE_LIMIT_REASON = "guest-mode-limit";

/**
 * Guest per-mode gate decision.
 *
 * Reads the guest's row in the given mode's stats table and returns:
 *   - `true`  (ALLOW) when no row exists or `gamesPlayed < 1`
 *   - `false` (BLOCK) when a row exists with `gamesPlayed >= 1`
 *
 * Fail-open: any DB error resolves to `true`, matching the daily-limit seam's
 * policy that a stats outage must never block play. Worst case a guest gets an
 * extra game — acceptable for a temporary feature.
 */
export const guestModeGate = async (
  userId: string,
  table: GameModeStatsTable,
): Promise<boolean> => {
  try {
    const rows = await db
      .select({ gamesPlayed: table.gamesPlayed })
      .from(table)
      .where(eq(table.userId, userId))
      .limit(1);

    const row = rows[0];

    // No row yet -> the guest has not played this mode -> ALLOW.
    if (!row) {
      return true;
    }

    // A row exists: ALLOW only while they have not completed a game.
    return row.gamesPlayed < 1;
  } catch (error) {
    // Fail open: a stats-store outage must never block play.
    logger.error(
      {
        userId,
        err: error instanceof Error ? error.message : error,
      },
      "guestModeGate stats read failed; failing open (ALLOW)",
    );
    return true;
  }
};
