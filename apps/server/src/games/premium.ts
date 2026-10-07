/**
 * Server-side premium entitlement read.
 *
 * The game server needs to know whether a player is premium to apply the
 * free-tier realtime play limit (free: 3 realtime games per UTC day shared
 * across modes; premium: unlimited). Premium state lives on the player's
 * `profiles` row, maintained by the Polar webhook in apps/client — the game
 * server only READS it here, mirroring how `guestModeGate` reads the per-mode
 * stats tables.
 *
 * The "what counts as premium" rule itself (entitling status + not-expired)
 * lives in the shared db package as `isPremiumEntitlement`, so the client's
 * `billing.status` query and this server helper can never drift apart.
 *
 * Fail-safe policy: any DB error resolves to `false` (NOT premium). Unlike the
 * guest/daily-limit gate — which fails OPEN so a stats outage never blocks play
 * — a premium read that fails must NOT silently grant unlimited play. Returning
 * `false` means the caller applies the free limit, which is the safe default
 * (worst case a premium user is briefly held to the free cap during an outage,
 * rather than everyone getting unlimited play for free).
 */

import { db, eq, isPremiumEntitlement, profiles } from "db";

import logger from "../utils/logger.js";

/**
 * Returns whether the given user currently has premium access, read from their
 * `profiles` row. Registered or guest — this only reflects billing state; guest
 * gating is handled separately by `guestModeGate`. On any read error, resolves
 * to `false` (apply free-tier limits).
 */
export const isPremiumUser = async (userId: string): Promise<boolean> => {
  try {
    const rows = await db
      .select({
        premiumStatus: profiles.premiumStatus,
        premiumUntil: profiles.premiumUntil,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return false;
    }

    return isPremiumEntitlement(row.premiumStatus, row.premiumUntil);
  } catch (error) {
    // Fail safe (NOT open): treat a read error as non-premium so an outage
    // never hands out unlimited play.
    logger.error(
      {
        userId,
        err: error instanceof Error ? error.message : error,
      },
      "isPremiumUser read failed; treating as NOT premium (apply free limits)",
    );
    return false;
  }
};
