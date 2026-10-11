import type { PlayerModeStats, ScoredMode } from "./schema.ts";

// Pure, connection-free season ranking.
//
// This module holds ONLY the deterministic ranking logic (the comparator, the
// placement assignment) and the archival result types. It imports nothing from
// schema except TYPES — with `verbatimModuleSyntax` an `import type` is fully
// erased at emit, so this file has NO runtime relative imports and NO path to
// the live `db` connection in `./index.js`.
//
// That is what lets the client import `compareSeasonRanking` through the
// `@/db/*` source alias without the bundler trying to resolve a `.js`-suffixed
// relative import against a `.ts` source file. The server-only
// `season-archival.ts` re-uses the same functions for the actual DB write.

/**
 * The ranking metric for a scored-mode season leaderboard (design Section 2.4 /
 * 3.2). Rows are ordered by, in strict priority:
 *   1. `seasonPoints`      DESC  (the headline Apex-style points)
 *   2. `wins`              DESC
 *   3. `averagePlacement`  ASC   (lower = better; a null average — a row that
 *                                 never recorded a placement — ranks LAST)
 *   4. `gamesPlayed`       DESC
 *   5. `userId`            ASC   (final, fully deterministic tiebreak)
 *
 * Expressed as a comparator so the exact same ordering is used whether ranks
 * are computed here for archival or by the live leaderboard router. Returns a
 * negative number when `a` should rank ahead of `b`.
 */
export const compareSeasonRanking = (
  a: PlayerModeStats,
  b: PlayerModeStats,
): number => {
  // 1. seasonPoints DESC
  if (a.seasonPoints !== b.seasonPoints) {
    return b.seasonPoints - a.seasonPoints;
  }
  // 2. wins DESC
  if (a.wins !== b.wins) {
    return b.wins - a.wins;
  }
  // 3. averagePlacement ASC, nulls last. A null average means the mode/row
  //    never recorded a placement; such rows sort after any real average.
  const avgA = a.averagePlacement;
  const avgB = b.averagePlacement;
  if (avgA !== avgB) {
    if (avgA === null) {
      return 1;
    }
    if (avgB === null) {
      return -1;
    }
    return avgA - avgB;
  }
  // 4. gamesPlayed DESC
  if (a.gamesPlayed !== b.gamesPlayed) {
    return b.gamesPlayed - a.gamesPlayed;
  }
  // 5. userId ASC — stable, total order.
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
};

/** One archived placement produced for a season/mode. */
export type ArchivedPlacement = {
  userId: string;
  mode: ScoredMode;
  season: string;
  placement: number;
  gamesPlayed: number;
  wins: number;
  rankingValue: number;
};

/**
 * The result of archiving one season: the final standings written per scored
 * mode, keyed by mode. Useful for callers that want to render or assert the
 * outcome without re-reading `season_placements`.
 */
export type SeasonArchiveResult = {
  season: string;
  placements: ArchivedPlacement[];
};

/**
 * Rank the given seasonal rows for ONE scored mode into final placements.
 *
 * Pure: a function of the rows and the (mode, season) it's archiving. The input
 * rows are copied before sorting so the caller's array is never mutated —
 * archival must NEVER touch `player_mode_stats` (R4.5). Placements are dense and
 * 1-based (1 = best); the ranking value snapshotted is `seasonPoints`.
 */
export const rankSeasonRows = (
  rows: PlayerModeStats[],
  mode: ScoredMode,
  season: string,
): ArchivedPlacement[] =>
  [...rows]
    .sort(compareSeasonRanking)
    .map((row, index) => ({
      userId: row.userId,
      mode,
      season,
      placement: index + 1,
      gamesPlayed: row.gamesPlayed,
      wins: row.wins,
      // Ranking metric for scored modes is Season_Points (design Section 2.4).
      rankingValue: row.seasonPoints,
    }));
