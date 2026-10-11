/**
 * Shared free-tier realtime play limit, SHARED across all realtime modes
 * (Battle Royale + Race).
 *
 * Free accounts: a fixed number of realtime games per UTC day
 * (`TIER_LIMITS.free.realtimeGamesPerDay`, currently 3), counted across BOTH
 * modes against one per-day usage row. Premium accounts: unlimited
 * (`TIER_LIMITS.premium.realtimeGamesPerDay === null`).
 *
 * The limit resets at UTC midnight for free: usage is bucketed by UTC calendar
 * day (`utcDayKey`), so a new day simply has no row yet. There is no reset job.
 *
 * This is the REAL implementation of the Daily_Game_Counter the per-mode
 * `daily-limit.ts` seams were written to delegate to. It replaces the dormant
 * lifetime-`gamesPlayed` stub, which could never express a per-day limit.
 *
 * Enforcement vs recording:
 *   - `canStartRealtimeGame(userId)` is the ALLOW/BLOCK decision, consulted in
 *     the join handlers before a player is placed (so a block maps to the
 *     `daily-limit` `join:error` reason). Premium short-circuits to allow.
 *   - `recordRealtimeGameStart(userId)` increments the counter when a match
 *     actually starts (once per real player). Never records for premium (their
 *     count is irrelevant) and swallows errors so the game loop never breaks.
 *
 * Fail policy:
 *   - A premium READ that errors falls back to NOT premium (see
 *     `isPremiumUser`) — safe, applies the free limit.
 *   - A usage-counter READ error in `canStartRealtimeGame` FAILS OPEN (ALLOW),
 *     matching the guest/daily-limit seam policy: a counter outage must never
 *     block play. Worst case a free user gets an extra game during an outage.
 *   - A usage-counter WRITE error in `recordRealtimeGameStart` is swallowed.
 */

import {
  type NewRealtimeGameUsage,
  and,
  db,
  eq,
  realtimeGameUsage,
  sql,
  TIER_LIMITS,
  utcDayKey,
} from "db";

import { isPremiumUser } from "./premium.js";
import logger from "../utils/logger.js";

/**
 * Snapshot of a user's realtime play allowance for the current UTC day.
 * `limit`/`remaining` are `null` for premium (unlimited). For free, `remaining`
 * is clamped at 0 and never negative.
 */
export type RealtimeUsage = {
  isPremium: boolean;
  /** Games allowed per UTC day; null = unlimited (premium). */
  limit: number | null;
  /** Games already started today (across modes). */
  used: number;
  /** Games left today; null = unlimited (premium). */
  remaining: number | null;
  /** The UTC day key the counts are for ("YYYY-MM-DD"). */
  day: string;
};

/** Reads today's usage count for a user (0 when no row exists). */
const readUsedToday = async (userId: string, day: string): Promise<number> => {
  const rows = await db
    .select({ count: realtimeGameUsage.count })
    .from(realtimeGameUsage)
    .where(
      and(
        eq(realtimeGameUsage.userId, userId),
        eq(realtimeGameUsage.day, day),
      ),
    )
    .limit(1);
  return rows[0]?.count ?? 0;
};

/**
 * The user's realtime allowance snapshot for the current UTC day. Used both by
 * the gate (`canStartRealtimeGame`) and by the client-facing usage query so the
 * "X / N games remaining today" display and the enforcement agree.
 *
 * On any error this resolves to a permissive snapshot (treated as having games
 * remaining) so a transient DB issue never blocks play.
 */
export const getRealtimeUsage = async (
  userId: string,
  now: Date = new Date(),
): Promise<RealtimeUsage> => {
  const day = utcDayKey(now);
  const isPremium = await isPremiumUser(userId);

  if (isPremium) {
    return { isPremium: true, limit: null, used: 0, remaining: null, day };
  }

  const limit = TIER_LIMITS.free.realtimeGamesPerDay ?? 0;

  try {
    const used = await readUsedToday(userId, day);
    const remaining = Math.max(0, limit - used);
    return { isPremium: false, limit, used, remaining, day };
  } catch (error) {
    // Fail open: report a full allowance so the gate permits during an outage.
    logger.error(
      { userId, err: error instanceof Error ? error.message : error },
      "getRealtimeUsage read failed; reporting full allowance (fail open)",
    );
    return { isPremium: false, limit, used: 0, remaining: limit, day };
  }
};

/**
 * ALLOW/BLOCK decision for starting a realtime game. Premium: always allow.
 * Free: allow while today's usage is under the per-day limit. Fails open.
 */
export const canStartRealtimeGame = async (
  userId: string,
  now: Date = new Date(),
): Promise<boolean> => {
  const usage = await getRealtimeUsage(userId, now);
  if (usage.remaining === null) {
    return true; // premium / unlimited
  }
  return usage.remaining > 0;
};

/**
 * Increments the user's realtime game count for the current UTC day. Called
 * when a match actually starts, once per real player. No-op for premium (their
 * usage is never gated). Swallows errors so a counter outage never breaks the
 * game loop.
 */
export const recordRealtimeGameStart = async (
  userId: string,
  now: Date = new Date(),
): Promise<void> => {
  try {
    // Premium is unlimited, so there is no reason to track their usage.
    if (await isPremiumUser(userId)) {
      return;
    }

    const day = utcDayKey(now);
    const row: NewRealtimeGameUsage = {
      userId,
      day,
      count: 1,
      updatedAt: now,
    };

    // Upsert: first game of the day inserts count=1; subsequent games bump it.
    await db
      .insert(realtimeGameUsage)
      .values(row)
      .onConflictDoUpdate({
        target: [realtimeGameUsage.userId, realtimeGameUsage.day],
        set: {
          count: sql`${realtimeGameUsage.count} + 1`,
          updatedAt: now,
        },
      });
  } catch (error) {
    logger.error(
      { userId, err: error instanceof Error ? error.message : error },
      "recordRealtimeGameStart failed; swallowing (counter outage must not break play)",
    );
  }
};
