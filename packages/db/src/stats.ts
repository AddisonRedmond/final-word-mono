import { eq, sql } from "drizzle-orm";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema.ts";
import {
  isScoredMode,
  LIFETIME_SCOPE,
  playerModeStats,
  profiles,
  type GameMode,
  type StatsScope,
} from "./schema.ts";

/**
 * The database handle `upsertModeStats` writes through. It accepts either the
 * shared `db` instance (a `PostgresJsDatabase` over our schema) or a Drizzle
 * transaction opened from it (`db.transaction` callback arg) — both expose the
 * same `insert().values().onConflictDoUpdate()` surface. Typing it this way lets
 * the game-finish path call the helper twice (lifetime + season) inside ONE
 * transaction, so both rows move together or not at all (R1.4), while callers
 * without a transaction can pass `db` directly.
 *
 * Derived from the drizzle TYPE rather than the concrete `db` value, so this
 * module (and the pure helpers alongside it) never imports `./index.js` and the
 * live postgres connection it builds. That keeps `db` server-only: the client
 * can import the pure logic here without pulling in `DATABASE_URL`.
 */
type Database = PostgresJsDatabase<typeof schema>;
export type DbOrTransaction =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Bots share the players map with real users, keyed "bot0", "bot1", … while
 * real players are keyed by their Supabase auth UUID. Only real users accrue
 * stats, so anything that isn't a UUID is a bot. Byte-identical to the private
 * `isRealPlayer` in `apps/server`'s `race/stats.ts` and `battle-royale/stats.ts`
 * — the single eligibility predicate (bots excluded, guests included, R1.3).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isRealPlayer = (playerId: string): boolean =>
  UUID_RE.test(playerId);

/**
 * One completed game's outcome for a single real player, mode-agnostic. The
 * caller supplies only the fields its mode tracks; the untracked ones stay
 * undefined and their columns are left untouched (null = "this mode doesn't
 * track this", not zero — see `playerModeStats`).
 */
export type ModeStatsOutcome = {
  /** Did this player win the game? */
  won: boolean;
  /** Was the game a draw (no winner)? Defaults to false. */
  isDraw?: boolean;
  /** Total guesses this player made in the game. Defaults to 0. */
  totalGuesses?: number;
  /** Correct guesses this player made in the game. Defaults to 0. */
  correctGuesses?: number;
  /**
   * Finishing placement (1 = won). Supply ONLY for modes that have a placement
   * concept (battle_royale/race). Omit for duel/classic — the running-average
   * and best-placement columns are then left untouched.
   */
  placement?: number;
  /**
   * Solve duration in milliseconds. Supply ONLY for modes that time an
   * individual solve (duel, future classic). Omit for BR/race — the solve-timing
   * columns are then left untouched.
   */
  solveMs?: number;
  /**
   * Match_Points this player earned for THIS game, computed once by the caller
   * via `matchPoints(placement, correctGuesses)`. Points are applied ONLY on a
   * seasonal row of a scored mode (battle_royale/race); on lifetime rows and on
   * non-scored modes (duel/classic) they are never written (R2A.6). Omit when
   * no points were earned.
   */
  points?: number;
};

/** Arguments identifying which `(userId, mode, scope)` row to upsert. */
export type UpsertModeStatsArgs = {
  userId: string;
  mode: GameMode;
  scope: StatsScope;
  outcome: ModeStatsOutcome;
};

/**
 * Upsert ONE `player_mode_stats` row for a single completed game.
 *
 * This is the unified write path (design Section 2.1) that replaces the
 * per-mode `battle_royale_stats` / `race_stats` upserts. The game-finish path
 * calls it twice per player per game — once with `scope = "lifetime"`, once with
 * `scope = seasonKey(now)` — ideally inside one transaction (R1.4).
 *
 * The SET clause reuses the SQL recurrences proven in the existing stats
 * upserts, computed from the PRE-increment column values in `onConflictDoUpdate`
 * (so concurrent writers can't clobber each other's totals):
 *   - running counters: `gamesPlayed +1`, `wins + winInc`, `draws + drawInc`,
 *     guess economy sums.
 *   - running average placement `(avg*n + placement)/(n+1)` — only when the mode
 *     supplies a placement; otherwise the column is left untouched.
 *   - streaks: `currentWinStreak = case when won then +1 else 0`,
 *     `bestWinStreak = greatest(best, …)`.
 *   - best placement `least(coalesce(best, placement), placement)`.
 *   - solve timing `solveCount +1`, `totalSolveMs + ms`,
 *     `fastestSolveMs = least(coalesce(fastest, ms), ms)` — only when timed.
 *
 * Points are applied ONLY on seasonal rows of scored modes (R2A.6):
 *   `seasonPoints += pts`, `bestMatchPoints = greatest(bestMatchPoints, pts)`.
 * Lifetime rows and non-scored modes (duel/classic) never accrue points.
 *
 * Eligibility is `isRealPlayer(userId)` alone (bots excluded, guests included,
 * R1.3). This NEVER throws into the caller (the game loop / completion branch):
 * any failure is logged and swallowed so cleanup always completes (R1.8, R8.1).
 */
export const upsertModeStats = async (
  tx: DbOrTransaction,
  { userId, mode, scope, outcome }: UpsertModeStatsArgs,
  now: Date,
): Promise<void> => {
  // Bots never accrue stats; guests (real UUIDs) do.
  if (!isRealPlayer(userId)) {
    return;
  }

  const won = outcome.won;
  const isDraw = outcome.isDraw ?? false;
  const totalGuesses = outcome.totalGuesses ?? 0;
  const correctGuesses = outcome.correctGuesses ?? 0;
  const { placement, solveMs } = outcome;

  const winInc = won ? 1 : 0;
  const drawInc = isDraw ? 1 : 0;
  const hasPlacement = typeof placement === "number";
  const hasSolve = typeof solveMs === "number";

  // Points land ONLY on a seasonal row of a scored mode. On lifetime rows and
  // non-scored modes (duel/classic) they stay 0 — there is no lifetime points
  // total (R2A.6, R2A.8).
  const isSeasonal = scope !== LIFETIME_SCOPE;
  const pointsApply = isSeasonal && isScoredMode(mode);
  const pts = pointsApply ? Math.max(0, outcome.points ?? 0) : 0;

  try {
    await tx
      .insert(playerModeStats)
      .values({
        userId,
        mode,
        scope,
        gamesPlayed: 1,
        wins: winInc,
        draws: drawInc,
        currentWinStreak: winInc,
        bestWinStreak: winInc,
        wonLastGame: won,
        totalGuesses,
        totalCorrectGuesses: correctGuesses,
        // Placement columns only for modes that have a placement; left null
        // otherwise (null = "not tracked by this mode").
        averagePlacement: hasPlacement ? placement : null,
        bestPlacement: hasPlacement ? placement : null,
        // Solve-timing columns only for modes that time a solve.
        solveCount: hasSolve ? 1 : 0,
        totalSolveMs: hasSolve ? (solveMs as number) : 0,
        fastestSolveMs: hasSolve ? (solveMs as number) : null,
        // Points only on a seasonal scored row's first game.
        seasonPoints: pts,
        bestMatchPoints: pts,
        lastPlayedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [playerModeStats.userId, playerModeStats.mode, playerModeStats.scope],
        set: {
          gamesPlayed: sql`${playerModeStats.gamesPlayed} + 1`,
          wins: sql`${playerModeStats.wins} + ${winInc}`,
          draws: sql`${playerModeStats.draws} + ${drawInc}`,
          // Win streak: extend on a win, reset to 0 otherwise.
          currentWinStreak: sql`case when ${won} then ${playerModeStats.currentWinStreak} + 1 else 0 end`,
          // Best streak: the greater of the prior best and the new current.
          bestWinStreak: sql`greatest(${playerModeStats.bestWinStreak}, case when ${won} then ${playerModeStats.currentWinStreak} + 1 else 0 end)`,
          // Overwrite (not accumulate) with the latest game's result.
          wonLastGame: won,
          totalGuesses: sql`${playerModeStats.totalGuesses} + ${totalGuesses}`,
          totalCorrectGuesses: sql`${playerModeStats.totalCorrectGuesses} + ${correctGuesses}`,
          // Running average placement, computed from the PRE-increment
          // games_played: (avg * n + placement) / (n + 1). A row that has never
          // recorded a placement (average_placement is null) seeds the average
          // with this game's placement via coalesce. Only touched when the mode
          // supplies a placement.
          ...(hasPlacement
            ? {
                averagePlacement: sql`(coalesce(${playerModeStats.averagePlacement}, ${placement}) * ${playerModeStats.gamesPlayed} + ${placement}) / (${playerModeStats.gamesPlayed} + 1)`,
                bestPlacement: sql`least(coalesce(${playerModeStats.bestPlacement}, ${placement}), ${placement})`,
              }
            : {}),
          // Solve timing: only touched when the mode times a solve.
          ...(hasSolve
            ? {
                solveCount: sql`${playerModeStats.solveCount} + 1`,
                totalSolveMs: sql`${playerModeStats.totalSolveMs} + ${solveMs}`,
                fastestSolveMs: sql`least(coalesce(${playerModeStats.fastestSolveMs}, ${solveMs}), ${solveMs})`,
              }
            : {}),
          // Points: seasonal scored rows only. Never written otherwise, so a
          // lifetime/duel row keeps its always-zero points columns.
          ...(pointsApply
            ? {
                seasonPoints: sql`${playerModeStats.seasonPoints} + ${pts}`,
                bestMatchPoints: sql`greatest(${playerModeStats.bestMatchPoints}, ${pts})`,
              }
            : {}),
          lastPlayedAt: now,
          updatedAt: now,
        },
      });
  } catch (error) {
    // Mirror the existing stats pattern: never break the caller. A failure to
    // persist is logged and swallowed so game cleanup / duel completion always
    // finishes.
    console.error(
      "Failed to upsert player_mode_stats",
      JSON.stringify({
        userId,
        mode,
        scope,
        err: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

/**
 * Set the CROSS-MODE "won last realtime game" flag on a player's profile.
 *
 * Overwrites `profiles.won_last_realtime_game` with THIS realtime game's
 * outcome for the player, regardless of mode — so whichever of Battle Royale /
 * Race finished most recently wins the toss. A win sets it true; a loss or
 * mid-game elimination sets it false. This is what drives the gold/sparkle
 * "Final Word" hero tiles, and it deliberately does NOT persist per mode: the
 * header should drop the moment the player loses EITHER realtime mode (fixing
 * the per-mode `wonLastGame` OR, which left the header gold after a win in one
 * mode and a loss in the other).
 *
 * Called once per real player per realtime game finish, alongside that player's
 * `upsertModeStats` writes (ideally in the same transaction). Duels never call
 * this — the cosmetic is about realtime wins only.
 *
 * Eligibility is `isRealPlayer(userId)` (bots excluded, guests included). Like
 * `upsertModeStats`, this NEVER throws into the caller: any failure is logged
 * and swallowed so game cleanup always completes (R1.8, R8.1).
 */
export const setWonLastRealtimeGame = async (
  tx: DbOrTransaction,
  userId: string,
  won: boolean,
  now: Date,
): Promise<void> => {
  // Bots never carry the cosmetic; guests (real UUIDs) do.
  if (!isRealPlayer(userId)) {
    return;
  }

  try {
    await tx
      .update(profiles)
      .set({ wonLastRealtimeGame: won })
      .where(eq(profiles.id, userId));
  } catch (error) {
    // Mirror the stats pattern: never break the caller. The flag is cosmetic,
    // so a failed write just leaves the prior value — harmless.
    console.error(
      "Failed to set won_last_realtime_game",
      JSON.stringify({
        userId,
        won,
        at: now.toISOString(),
        err: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};
