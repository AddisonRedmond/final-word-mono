import {
  db,
  LIFETIME_SCOPE,
  matchPoints,
  seasonKey,
  setWonLastRealtimeGame,
  upsertModeStats,
} from "db";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

import logger from "../../utils/logger.js";

/**
 * Bots share the same players map as real users, keyed "bot0", "bot1", … while
 * real players are keyed by their Supabase auth UUID. We only persist stats for
 * real users, so anything that isn't a UUID is treated as a bot. (Same
 * detection Battle Royale uses.)
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRealPlayer = (playerId: string) => UUID_RE.test(playerId);

type RankedPlayer = {
  userId: string;
  placement: number;
  won: boolean;
  player: RacePlayer;
};

/**
 * Assign each REAL player a finishing placement relative to the FULL field
 * (bots included for ordering), then return only the real players.
 *
 * Placement reflects survival order. The winner (room.winnerId, bot or human)
 * is placement 1; everyone else is ranked by when they were eliminated
 * (`eliminatedAt`), the latest-eliminated getting the better placement — you
 * beat an opponent by outlasting them in the elimination race, not by out-
 * guessing them. Players eliminated on the same round-end tick share an
 * `eliminatedAt` and are broken by round performance (more `completedWords`,
 * then fewer `roundGuesses`). In a draw (room.isDraw, or no winnerId) everyone
 * shares placement 1 and no win is recorded.
 *
 * Placement derives purely from ranking/elimination order — there is no
 * "eliminated by X" / attack-word concept in Race.
 */
const rankPlayers = (match: RaceMatch): RankedPlayer[] => {
  const allPlayers = Array.from(match.players.entries());
  const { winnerId, isDraw } = match.room;

  // Draw: everyone (including the real players) shares placement 1, no win.
  if (isDraw || !winnerId) {
    return allPlayers
      .filter(([id]) => isRealPlayer(id))
      .map(([userId, player]) => ({
        userId,
        placement: 1,
        won: false,
        player,
      }));
  }

  // Order the whole field by survival:
  //   1. the winner (last standing) always first
  //   2. then latest elimination first (survived longer = better placement)
  //   3. tiebreak same-tick eliminations by round performance
  const ordered = [...allPlayers].sort(([idA, a], [idB, b]) => {
    if (idA === winnerId) {
      return -1;
    }
    if (idB === winnerId) {
      return 1;
    }

    // Later elimination ranks higher. A missing eliminatedAt (never stamped) is
    // treated as eliminated earliest (0), so it sorts to the back.
    const endA = a.eliminatedAt ?? 0;
    const endB = b.eliminatedAt ?? 0;
    if (endA !== endB) {
      return endB - endA;
    }

    // Same elimination tick -> break by overall performance: more correct
    // guesses (words) first, then more correct letters, then fewer total
    // guesses (matches the elimination-placement ordering in endRound).
    if (a.correctGuesses !== b.correctGuesses) {
      return b.correctGuesses - a.correctGuesses;
    }
    if (a.correctLetters !== b.correctLetters) {
      return b.correctLetters - a.correctLetters;
    }
    return a.totalGuesses - b.totalGuesses;
  });

  // Assign 1..N across the full field, then keep only the real players with
  // their true field placement.
  const ranked: RankedPlayer[] = [];
  ordered.forEach(([userId, player], index) => {
    if (!isRealPlayer(userId)) {
      return;
    }
    const placement = index + 1;
    ranked.push({
      userId,
      placement,
      won: userId === winnerId,
      player,
    });
  });

  return ranked;
};

type PlayerStatResult = {
  userId: string;
  placement: number;
  won: boolean;
  isDraw: boolean;
  totalGuesses: number;
  correctGuesses: number;
};

/**
 * Write one completed match's outcome onto the unified `player_mode_stats`
 * table: once for the all-time `lifetime` scope and once for the current
 * season's scope, in the SAME transaction so both rows move together or not at
 * all (R1.4). Points are computed ONCE per player via
 * `matchPoints(placement, correctGuesses)` and handed to both calls;
 * `upsertModeStats` applies them only on the seasonal scored row (R2A.6), so
 * the lifetime row keeps points at 0.
 *
 * `mode` is fixed to "race" (a SCORED_MODE). This is the sole stats write path:
 * the legacy `race_stats` dual-write has been retired now that nothing reads
 * that table. `upsertModeStats` never throws into the caller (it logs and
 * swallows), so a write failure can't break cleanup; the returned promise is
 * awaited only so the one transaction completes.
 */
const writeModeStats = (result: PlayerStatResult, now: Date) => {
  const { userId, placement, won, isDraw, totalGuesses, correctGuesses } =
    result;
  // Combat proxy is correctGuesses for now (swappable later, R2A.4). Computed
  // once per player per match and shared by both the lifetime and seasonal
  // upserts.
  const points = matchPoints(placement, correctGuesses);
  const outcome = {
    won,
    isDraw,
    totalGuesses,
    correctGuesses,
    placement,
    points,
  };

  return db.transaction(async (tx) => {
    await upsertModeStats(
      tx,
      { userId, mode: "race", scope: LIFETIME_SCOPE, outcome },
      now,
    );
    await upsertModeStats(
      tx,
      { userId, mode: "race", scope: seasonKey(now), outcome },
      now,
    );
    // Cross-mode champion flag: overwrite with THIS realtime game's outcome so
    // the gold "Final Word" header reflects the single latest realtime result
    // (and drops the moment the player loses either Race or Battle Royale).
    await setWonLastRealtimeGame(tx, userId, won, now);
  });
};

/**
 * Persist one user's stats for a single completed match onto the unified
 * `player_mode_stats` table (lifetime + current-season rows). Existing rows are
 * incremented in SQL inside `upsertModeStats` so concurrent writes can't
 * clobber each other's totals; brand-new users get a fresh row.
 *
 * This is now a thin wrapper over {@link writeModeStats} — the legacy
 * `race_stats` write has been removed. Kept as the named entry point the
 * finish/leaver paths call so those call sites are unchanged.
 */
const upsertPlayerStat = (result: PlayerStatResult, now: Date) =>
  writeModeStats(result, now);

/**
 * Upsert per-user aggregate Race stats for a finished match.
 *
 * One row per user (see packages/db schema). Bots are excluded. This never
 * throws into the caller (the cleanup path) — any failure is logged and
 * swallowed so cleanup always completes.
 */
export const persistRaceStats = async (match: RaceMatch): Promise<void> => {
  try {
    // Rank the FULL real field for correct placement ordering, but only WRITE
    // players who have not already been recorded this match (at elimination or
    // forfeit-on-leave). This keeps each real player counted exactly once — the
    // winner and any still-unrecorded survivors are written here; players
    // recorded earlier keep their at-outcome placement. Bots are excluded by
    // `rankPlayers`.
    const ranked = rankPlayers(match).filter(
      ({ userId }) => !match.players.get(userId)?.statsPersisted,
    );

    if (ranked.length === 0) {
      return;
    }

    const now = new Date();

    await Promise.all(
      ranked.map(({ userId, placement, won, player }) => {
        // Mark BEFORE the await so a concurrent path can't double-write.
        player.statsPersisted = true;
        logger.info(
          { matchId: match.room.matchId, userId, placement, won },
          "Saved Race stats for user (match finish)",
        );
        return upsertPlayerStat(
          {
            userId,
            placement,
            won,
            isDraw: match.room.isDraw,
            totalGuesses: player.totalGuesses,
            correctGuesses: player.correctGuesses,
          },
          now,
        );
      }),
    );

    logger.info(
      {
        matchId: match.room.matchId,
        players: ranked.length,
        winnerId: match.room.winnerId,
        isDraw: match.room.isDraw,
      },
      "Persisted Race stats",
    );
  } catch (error) {
    logger.error(
      {
        matchId: match.room.matchId,
        err: error instanceof Error ? error.message : error,
      },
      "Failed to persist Race stats",
    );
  }
};

/**
 * Persist a single real player's in-progress departure as a LOSS (Req 8.6).
 *
 * Called synchronously from the leave path BEFORE the player is removed, so the
 * alive-count snapshot reflects the field at the moment of leaving. Fire-and-
 * forget: any DB failure is logged and swallowed so the leave/cleanup path
 * never breaks (Req 8.8 pattern).
 *
 * No-ops (persist nothing) when:
 *   - `userId` is not a real player, i.e. a bot (Req 8.7 — bots excluded).
 *   - the match has not started (`room.phase === "lobby"`), i.e. a Lobby leaver
 *     (Req 8.7 — no stats for leaving before start).
 *
 * Otherwise the match is in progress (phase `round`/`intermission`/`finished`)
 * and the leaver is recorded with `won = false`, `isDraw = false`, and a
 * placement equal to the number of players still ALIVE (`!isEliminated`) at the
 * moment of leaving. The leaver is still present in the players map at this
 * point and is themselves not yet eliminated, so they are counted in that alive
 * total — the leaver takes the placement equal to the current alive field size
 * (Property 12: "placement equal to the number of players still alive at the
 * moment of leaving").
 */
export const persistLeaverAsLoss = async (
  match: RaceMatch,
  userId: string,
): Promise<void> => {
  // Bots are never persisted (Req 8.7).
  if (!isRealPlayer(userId)) {
    return;
  }

  // A player leaving a not-yet-started lobby persists no stats (Req 8.7).
  if (match.room.phase === "lobby") {
    return;
  }

  const player = match.players.get(userId);
  if (!player) {
    return;
  }

  // Record each real player exactly once. An already-eliminated player who then
  // leaves was recorded at elimination, so leaving records nothing further.
  if (player.statsPersisted) {
    return;
  }

  try {
    // Placement = number of players still alive at the moment of leaving. The
    // leaver is still in the map and not yet eliminated, so they are included
    // in this count (Property 12).
    const alive = Array.from(match.players.values()).filter(
      (p) => !p.isEliminated,
    ).length;

    const now = new Date();

    // Mark before the await so the finish/cleanup path can't also write them.
    player.statsPersisted = true;

    await upsertPlayerStat(
      {
        userId,
        placement: alive,
        won: false,
        isDraw: false,
        totalGuesses: player.totalGuesses,
        correctGuesses: player.correctGuesses,
      },
      now,
    );

    logger.info(
      {
        matchId: match.room.matchId,
        userId,
        placement: alive,
        phase: match.room.phase,
      },
      "Saved Race stats for user (forfeit on leave)",
    );
  } catch (error) {
    logger.error(
      {
        matchId: match.room.matchId,
        userId,
        err: error instanceof Error ? error.message : error,
      },
      "Failed to persist Race leaver loss",
    );
  }
};

/**
 * Persist the real players eliminated at a round end as losses (Option 1:
 * record-at-outcome). Called from `endRound` right after it marks the round's
 * eliminated survivors, so each real player's result is recorded the moment
 * their outcome is decided — not deferred to match finish/cleanup. This is what
 * lets a bots-only cleanup simply tear down: every human was already recorded
 * when they were eliminated (or when they forfeited by leaving).
 *
 * For each id: no-op for bots and for players already recorded this match
 * (the `statsPersisted` guard keeps every real player counted exactly once).
 * The player's `placement` was stamped by `endRound` (field size at the moment
 * of elimination), so it is recorded as a loss with that true placement. The
 * flag is set before the async write so a later finish/leave path can't
 * double-write. Fire-and-forget: DB failures are logged and swallowed so the
 * round loop is never broken.
 */
export const persistEliminatedAsLoss = (
  match: RaceMatch,
  eliminatedIds: readonly string[],
): void => {
  const now = new Date();

  for (const userId of eliminatedIds) {
    if (!isRealPlayer(userId)) {
      continue;
    }

    const player = match.players.get(userId);
    if (!player || player.statsPersisted) {
      continue;
    }

    // Placement was stamped on the player by endRound at elimination time.
    const placement = player.placement ?? match.players.size;
    const { totalGuesses, correctGuesses } = player;

    // Mark before the await so the finish/leave path can't also write them.
    player.statsPersisted = true;

    void (async () => {
      try {
        await upsertPlayerStat(
          {
            userId,
            placement,
            won: false,
            isDraw: false,
            totalGuesses,
            correctGuesses,
          },
          now,
        );

        logger.info(
          { matchId: match.room.matchId, userId, placement },
          "Saved Race stats for user (eliminated)",
        );
      } catch (error) {
        logger.error(
          {
            matchId: match.room.matchId,
            userId,
            err: error instanceof Error ? error.message : error,
          },
          "Failed to persist Race elimination loss",
        );
      }
    })();
  }
};
