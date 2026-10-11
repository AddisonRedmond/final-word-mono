import { and, eq, sql } from "drizzle-orm";

import {
  LIFETIME_SCOPE,
  type PlayerModeStats,
  playerModeStats,
  SCORED_MODES,
  seasonKey,
  seasonPlacements,
} from "./schema.ts";
import {
  type ArchivedPlacement,
  rankSeasonRows,
  type SeasonArchiveResult,
} from "./ranking.ts";
import type { DbOrTransaction } from "./stats.ts";

// The pure ranking core (`compareSeasonRanking`, `rankSeasonRows`) and the
// archival result types now live in `./ranking.ts`, a connection-free module so
// client consumers can import the comparator without pulling in `./index.js`.
// Re-exported here so existing `db`-level imports (server callers that import
// these from the package barrel) keep working unchanged.
export { compareSeasonRanking } from "./ranking.ts";
export { rankSeasonRows };
export type { ArchivedPlacement, SeasonArchiveResult };

/**
 * Archive one completed season: snapshot its final standings into
 * `season_placements`.
 *
 * For the given `season` (a "YYYY-MM" key, see {@link seasonKey}) and each
 * scored mode (`battle_royale`, `race`), this reads the seasonal
 * `player_mode_stats` rows (`scope = season` AND `mode ∈ SCORED_MODES`), ranks
 * them by the deterministic ranking metric ({@link compareSeasonRanking}), and
 * upserts one `season_placements` row per player with `rankingValue =
 * seasonPoints`.
 *
 * Properties this routine guarantees (R4.5, R4.6, R4.7):
 *   - **Reproducible from aggregates.** The snapshot is derived purely from the
 *     retained `player_mode_stats` seasonal rows; the aggregates are the source
 *     of truth, this is a fast-read copy.
 *   - **Idempotent.** Re-running for the same season recomputes identical ranks
 *     and upserts them in place (conflict on `(userId, mode, season)`), so a
 *     second run is a no-op in effect. Deterministic tiebreakers (down to
 *     `userId`) mean the order never drifts between runs.
 *   - **Non-destructive.** It only ever reads `player_mode_stats` and writes
 *     `season_placements`; it never mutates or resets the aggregates (R4.7).
 *
 * Trigger-agnostic: call it from a scheduled task after a month rolls over, or
 * lazily the first time a past season's board is requested (R4.6). The function
 * is the deliverable; the scheduling mechanism is a caller concern.
 *
 * Never throws into the caller — a persistence failure is logged and swallowed,
 * matching the stats-pipeline pattern (`upsertModeStats`). The in-memory
 * ranking is still returned so a lazy caller can render even if the snapshot
 * write failed.
 *
 * @param season  the "YYYY-MM" season key to archive.
 * @param tx      the db handle or transaction to read/write through. Required:
 *                this module never imports the live `db` connection, so the
 *                server caller passes its own handle (keeps `db` server-only).
 */
export const archiveSeason = async (
  season: string,
  tx: DbOrTransaction,
): Promise<SeasonArchiveResult> => {
  // Guard against accidentally archiving the lifetime scope — only real season
  // keys have placements.
  if (season === LIFETIME_SCOPE) {
    return { season, placements: [] };
  }

  const placements: ArchivedPlacement[] = [];

  for (const mode of SCORED_MODES) {
    // Read this season's rows for the mode. These aggregates are the source of
    // truth and are left untouched.
    const rows = (await tx
      .select()
      .from(playerModeStats)
      .where(
        and(
          eq(playerModeStats.mode, mode),
          eq(playerModeStats.scope, season),
        ),
      )) as PlayerModeStats[];

    const ranked = rankSeasonRows(rows, mode, season);
    placements.push(...ranked);

    if (ranked.length === 0) {
      continue;
    }

    try {
      // Upsert each placement in place; conflict on the (userId, mode, season)
      // PK makes a re-run idempotent — identical ranks overwrite identical ranks.
      await tx
        .insert(seasonPlacements)
        .values(
          ranked.map((p) => ({
            userId: p.userId,
            mode: p.mode,
            season: p.season,
            placement: p.placement,
            gamesPlayed: p.gamesPlayed,
            wins: p.wins,
            rankingValue: p.rankingValue,
          })),
        )
        .onConflictDoUpdate({
          target: [
            seasonPlacements.userId,
            seasonPlacements.mode,
            seasonPlacements.season,
          ],
          set: {
            placement: sql`excluded.placement`,
            gamesPlayed: sql`excluded.games_played`,
            wins: sql`excluded.wins`,
            rankingValue: sql`excluded.ranking_value`,
            archivedAt: sql`now()`,
          },
        });
    } catch (error) {
      // Mirror the stats pipeline: never break the caller (a scheduled job or a
      // lazy read path). Log and swallow; the computed ranking is still returned.
      console.error(
        "Failed to archive season_placements",
        JSON.stringify({
          season,
          mode,
          err: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return { season, placements };
};

/**
 * Convenience wrapper: archive the season that has JUST ended relative to
 * `now`. A scheduled monthly task can call this with no arguments right after
 * the UTC month boundary to snapshot the month that just closed.
 *
 * `now` is injectable for testing. The "previous month" is computed in UTC via
 * {@link seasonKey} so it agrees with how seasons are written.
 */
export const archivePreviousSeason = async (
  now: Date = new Date(),
  tx: DbOrTransaction,
): Promise<SeasonArchiveResult> => {
  // First day of the current UTC month, then step back one day to land in the
  // previous month — robust across month lengths and year boundaries.
  const firstOfThisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  return archiveSeason(seasonKey(lastOfPrevMonth), tx);
};
