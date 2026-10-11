import {
  db,
  LIFETIME_SCOPE,
  matchPoints,
  seasonKey,
  setWonLastRealtimeGame,
  upsertModeStats,
} from "db";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";

import logger from "../../utils/logger.js";

/**
 * Bots are stored in the same players map as real users, keyed "bot0", "bot1",
 * … while real players are keyed by their Supabase auth UUID. We only persist
 * stats for real users, so anything that isn't a UUID is treated as a bot.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRealPlayer = (playerId: string) => UUID_RE.test(playerId);

type RankedPlayer = {
  userId: string;
  placement: number;
  won: boolean;
  player: PlayerDisplay;
};

/**
 * Assign each REAL player a finishing placement relative to the FULL lobby
 * (bots included), then return only the real players.
 *
 * Placement reflects true SURVIVAL ORDER — who lasted longest. The winner
 * (room.winnerId, bot or human) is placement 1; everyone else is ranked by when
 * they were eliminated (endTimeStamp), latest-eliminated getting the better
 * placement. This matches how a battle royale actually finishes: outlasting an
 * opponent beats them, regardless of who made more correct guesses.
 *
 * Players eliminated on the same tick (a simultaneous life-expiry sweep, or all
 * non-winners at the match time cap) share one endTimeStamp and are treated as
 * a survival tie, broken by performance (more correct guesses, then fewer total
 * guesses). In a draw (no winnerId) everyone shares placement 1 and no win is
 * recorded.
 */
const rankPlayers = (game: Game): RankedPlayer[] => {
  const allPlayers = Array.from(game.players.entries());
  const { winnerId, isDraw } = game.room;

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

  // Order the whole lobby by survival:
  //   1. the winner (last standing) always first
  //   2. then latest elimination first (survived longer = better placement)
  //   3. tiebreak same-tick eliminations by performance
  const ordered = [...allPlayers].sort(([idA, a], [idB, b]) => {
    if (idA === winnerId) {
      return -1;
    }
    if (idB === winnerId) {
      return 1;
    }

    // Later elimination ranks higher. A missing endTimeStamp (never stamped)
    // is treated as eliminated earliest (0), so it sorts to the back.
    const endA = a.endTimeStamp ?? 0;
    const endB = b.endTimeStamp ?? 0;
    if (endA !== endB) {
      return endB - endA;
    }

    // Same elimination tick -> break by performance.
    if (a.correctGuesses !== b.correctGuesses) {
      return b.correctGuesses - a.correctGuesses;
    }
    return a.totalGuesses - b.totalGuesses;
  });

  // Assign 1..N across the full lobby, then keep only the real players with
  // their true lobby placement.
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
 * Write one completed game's outcome onto the unified `player_mode_stats`
 * table: once for the all-time `lifetime` scope and once for the current
 * season's scope, in the SAME transaction so both rows move together or not at
 * all (R1.4). Points are computed ONCE per player via
 * `matchPoints(placement, correctGuesses)` and handed to both calls;
 * `upsertModeStats` applies them only on the seasonal scored row (R2A.6), so
 * the lifetime row keeps points at 0.
 *
 * `mode` is fixed to "battle_royale" (a SCORED_MODE). This is the sole stats
 * write path: the legacy `battle_royale_stats` dual-write has been retired now
 * that nothing reads that table. `upsertModeStats` never throws into the caller
 * (it logs and swallows), so a write failure can't break cleanup; the returned
 * promise is awaited only so the one transaction completes.
 */
const writeModeStats = (result: PlayerStatResult, now: Date) => {
  const { userId, placement, won, isDraw, totalGuesses, correctGuesses } =
    result;
  // Combat proxy is correctGuesses for now (swappable later, R2A.4). Computed
  // once per player per game and shared by both the lifetime and seasonal
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
      { userId, mode: "battle_royale", scope: LIFETIME_SCOPE, outcome },
      now,
    );
    await upsertModeStats(
      tx,
      { userId, mode: "battle_royale", scope: seasonKey(now), outcome },
      now,
    );
    // Cross-mode champion flag: overwrite with THIS realtime game's outcome so
    // the gold "Final Word" header reflects the single latest realtime result
    // (and drops the moment the player loses either Battle Royale or Race).
    await setWonLastRealtimeGame(tx, userId, won, now);
  });
};

/**
 * Persist one user's stats for a single completed game onto the unified
 * `player_mode_stats` table (lifetime + current-season rows). Existing rows are
 * incremented in SQL inside `upsertModeStats` so concurrent writes can't
 * clobber each other's totals; brand-new users get a fresh row. Shared by both
 * the natural game-finish path and the "left an in-progress game" path.
 *
 * This is now a thin wrapper over {@link writeModeStats} — the legacy
 * `battle_royale_stats` write has been removed. Kept as the named entry point
 * the finish/leaver paths call so those call sites are unchanged.
 */
const upsertPlayerStat = (result: PlayerStatResult, now: Date) =>
  writeModeStats(result, now);

/**
 * Upsert per-user aggregate Battle Royale stats for a finished match.
 *
 * One row per user (see packages/db schema). Bots are excluded. This never
 * throws into the caller (the game loop) — any failure is logged and swallowed
 * so cleanup always completes.
 */
export const persistBattleRoyaleStats = async (game: Game): Promise<void> => {
  try {
    // Rank the FULL real field for correct placement ordering, but only WRITE
    // players not already recorded this match (at elimination or forfeit-on-
    // leave). Each real player is counted exactly once: the winner and any
    // still-unrecorded players (e.g. survivors at the time cap) are written
    // here; players recorded earlier keep their at-outcome placement. Bots are
    // excluded by `rankPlayers`.
    const ranked = rankPlayers(game).filter(
      ({ userId }) => !game.players.get(userId)?.statsPersisted,
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
          { roomId: game.room.lobbyId, userId, placement, won },
          "Saved Battle Royale stats for user (match finish)",
        );
        return upsertPlayerStat(
          {
            userId,
            placement,
            won,
            isDraw: game.room.isDraw,
            totalGuesses: player.totalGuesses,
            correctGuesses: player.correctGuesses,
          },
          now,
        );
      }),
    );

    logger.info(
      {
        roomId: game.room.lobbyId,
        players: ranked.length,
        winnerId: game.room.winnerId,
        isDraw: game.room.isDraw,
      },
      "Persisted Battle Royale stats",
    );
  } catch (error) {
    logger.error(
      {
        roomId: game.room.lobbyId,
        err: error instanceof Error ? error.message : error,
      },
      "Failed to persist Battle Royale stats",
    );
  }
};

/**
 * Record a single player leaving an IN-PROGRESS match as a loss.
 *
 * Quitting a started game counts against you (prevents rage-quitting to protect
 * stats). The leaver is placed last among the current field — placement equals
 * the number of players still in the game at the moment they leave (themselves
 * included), which is their true finishing position. Leaving a lobby that has
 * NOT started yet is free and must not call this. No-op for bots. Never throws
 * into the caller.
 */
export const persistLeaverAsLoss = (game: Game, userId: string): void => {
  if (!isRealPlayer(userId)) {
    return;
  }

  const player = game.players.get(userId);
  if (!player) {
    return;
  }

  // Record each real player exactly once. A player eliminated earlier was
  // already recorded at elimination, so leaving afterwards records nothing more.
  if (player.statsPersisted) {
    return;
  }
  player.statsPersisted = true;

  // Snapshot everything SYNCHRONOUSLY here: the caller deletes the player from
  // game.players immediately after this returns, so placement and the guess
  // counts must be read now, before the async DB write runs on a later
  // microtask.
  //
  // Placement = the number of players still ALIVE (not eliminated) at the
  // moment of leaving, the quitter included. Everyone already eliminated
  // finished BEHIND the quitter (better placement number for the quitter),
  // and everyone still alive outlasted them. Eliminated players — including
  // eliminated bots — remain in game.players with isEliminated=true, so we must
  // count only the living rather than use game.players.size (which would
  // record dead-last among the entire original lobby, e.g. 99).
  const aliveCount = Array.from(game.players.values()).filter(
    (p) => !p.isEliminated,
  ).length;
  // Guard: the leaver should be alive (you can't "leave" an eliminated slot),
  // but clamp to >= 1 defensively so placement is never 0.
  const placement = Math.max(1, aliveCount);
  const totalGuesses = player.totalGuesses;
  const correctGuesses = player.correctGuesses;
  const roomId = game.room.lobbyId;

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
        new Date(),
      );

      logger.info(
        { roomId, userId, placement },
        "Saved Battle Royale stats for user (forfeit on leave)",
      );
    } catch (error) {
      logger.error(
        {
          roomId,
          userId,
          err: error instanceof Error ? error.message : error,
        },
        "Failed to record leaver loss",
      );
    }
  })();
};

/**
 * Record real players eliminated on a single game tick as losses, at the moment
 * their outcome is decided (Option 1: record-at-outcome). Called from the game
 * loop's expiry sweep and the match-timer cap right after players are marked
 * `isEliminated`, so a human's result is written when they go out — not deferred
 * to match finish. This is what lets a bots-only room simply be torn down when
 * its last human leaves: every human was already recorded at elimination (or at
 * forfeit-on-leave), so cleanup has nothing left to persist.
 *
 * `eliminatedIds` are the players eliminated on THIS tick (share one
 * `endTimeStamp`). Their finishing placement is the field size at the moment of
 * elimination: everyone still alive after the sweep outlasted them, and the
 * whole tick shares the placement equal to `aliveAfterSweep + eliminatedThisTick`
 * — a later elimination therefore yields a better (lower) placement. Bots and
 * already-recorded players are skipped so every real player is counted exactly
 * once. Fire-and-forget: DB failures are logged and swallowed so the game loop
 * is never broken.
 */
export const persistEliminatedAsLoss = (
  game: Game,
  eliminatedIds: readonly string[],
): void => {
  // Field size at this tick = players still alive + everyone eliminated on this
  // same tick (they all finish tied at that position, broken by performance in
  // the read-side ranking). Bots are included in the count so placement matches
  // the true field, exactly as `rankPlayers` orders the whole lobby.
  const aliveAfterSweep = Array.from(game.players.values()).filter(
    (p) => !p.isEliminated,
  ).length;
  const placement = Math.max(1, aliveAfterSweep + eliminatedIds.length);
  const roomId = game.room.lobbyId;
  const now = new Date();

  for (const userId of eliminatedIds) {
    if (!isRealPlayer(userId)) {
      continue;
    }

    const player = game.players.get(userId);
    if (!player || player.statsPersisted) {
      continue;
    }

    // Mark before the async write so the finish/leave path can't also write.
    player.statsPersisted = true;
    const { totalGuesses, correctGuesses } = player;

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
          { roomId, userId, placement },
          "Saved Battle Royale stats for user (eliminated)",
        );
      } catch (error) {
        logger.error(
          {
            roomId,
            userId,
            err: error instanceof Error ? error.message : error,
          },
          "Failed to record Battle Royale elimination loss",
        );
      }
    })();
  }
};
