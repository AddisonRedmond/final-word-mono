/**
 * Shared per-mode gate for guest (anonymous) players.
 *
 * A guest is allowed ONE realtime game per game mode. The gate derives that
 * limit directly from the player's LIFETIME aggregate for the mode in the
 * unified `player_mode_stats` table — the single source of truth, so there is
 * no separate in-progress tracking: a leaver-loss writes `gamesPlayed >= 1` on
 * the `(userId, mode, 'lifetime')` row, which blocks the next start in that
 * mode.
 *
 * Previously this read the legacy per-mode tables (`race_stats` /
 * `battle_royale_stats`). It now reads `player_mode_stats` filtered by
 * `(userId, mode, scope = 'lifetime')` — the same row the dual-write pipeline
 * maintains — so the legacy tables can be retired. The gate takes the mode as a
 * `GameMode` string rather than a table handle; which mode's row is read is a
 * `where mode = $mode` filter, not a table choice.
 *
 * Both mode daily-limit seams (`race/daily-limit.ts`,
 * `battle-royale/daily-limit.ts`) delegate here for guests; registered users
 * never reach this helper. Every export carries a `guest`/`anon` identifier so
 * the whole feature is greppable and removable in one pass.
 */

import { and, db, eq, type GameMode, LIFETIME_SCOPE, playerModeStats } from "db";

import logger from "../utils/logger.js";

/**
 * The error reason emitted to the client when a guest is blocked by the gate.
 * The join handlers map a block to this `join:error` reason so the client can
 * show the sign-up prompt.
 */
export const GUEST_MODE_LIMIT_REASON = "guest-mode-limit";

/**
 * Guest per-mode gate decision.
 *
 * Reads the guest's LIFETIME `player_mode_stats` row for the given mode and
 * returns:
 *   - `true`  (ALLOW) when no row exists or `gamesPlayed < 1`
 *   - `false` (BLOCK) when a row exists with `gamesPlayed >= 1`
 *
 * Fail-open: any DB error resolves to `true`, matching the daily-limit seam's
 * policy that a stats outage must never block play. Worst case a guest gets an
 * extra game — acceptable for a temporary feature.
 */
export const guestModeGate = async (
  userId: string,
  mode: GameMode,
): Promise<boolean> => {
  try {
    const rows = await db
      .select({ gamesPlayed: playerModeStats.gamesPlayed })
      .from(playerModeStats)
      .where(
        and(
          eq(playerModeStats.userId, userId),
          eq(playerModeStats.mode, mode),
          eq(playerModeStats.scope, LIFETIME_SCOPE),
        ),
      )
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
        mode,
        err: error instanceof Error ? error.message : error,
      },
      "guestModeGate stats read failed; failing open (ALLOW)",
    );
    return true;
  }
};
