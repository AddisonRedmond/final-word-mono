import { battleRoyaleStats, db, sql } from "db";
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
 * Upsert one user's aggregate row for a single completed game. Existing rows
 * are incremented in SQL so concurrent writes can't clobber each other's
 * totals; brand-new users get a fresh row. Shared by both the natural
 * game-finish path and the "left an in-progress game" path.
 */
const upsertPlayerStat = (result: PlayerStatResult, now: Date) => {
  const { userId, placement, won, isDraw, totalGuesses, correctGuesses } =
    result;
  const winInc = won ? 1 : 0;
  const drawInc = isDraw ? 1 : 0;

  return db
    .insert(battleRoyaleStats)
    .values({
      userId,
      gamesPlayed: 1,
      wins: winInc,
      draws: drawInc,
      // First game: the average is just this game's placement.
      averagePlacement: placement,
      bestPlacement: placement,
      totalGuesses,
      totalCorrectGuesses: correctGuesses,
      currentWinStreak: winInc,
      bestWinStreak: winInc,
      wonLastGame: won,
      lastPlayedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: battleRoyaleStats.userId,
      set: {
        gamesPlayed: sql`${battleRoyaleStats.gamesPlayed} + 1`,
        wins: sql`${battleRoyaleStats.wins} + ${winInc}`,
        draws: sql`${battleRoyaleStats.draws} + ${drawInc}`,
        // Running average: (oldAvg * oldGamesPlayed + placement) / newGamesPlayed.
        // Uses the pre-update games_played, so this must be computed from the
        // existing column values (before the increment above is visible).
        averagePlacement: sql`(${battleRoyaleStats.averagePlacement} * ${battleRoyaleStats.gamesPlayed} + ${placement}) / (${battleRoyaleStats.gamesPlayed} + 1)`,
        bestPlacement: sql`least(coalesce(${battleRoyaleStats.bestPlacement}, ${placement}), ${placement})`,
        totalGuesses: sql`${battleRoyaleStats.totalGuesses} + ${totalGuesses}`,
        totalCorrectGuesses: sql`${battleRoyaleStats.totalCorrectGuesses} + ${correctGuesses}`,
        // Win streak: extend on a win, reset to 0 otherwise.
        currentWinStreak: sql`case when ${won} then ${battleRoyaleStats.currentWinStreak} + 1 else 0 end`,
        // Best streak: the greater of the prior best and the new current.
        bestWinStreak: sql`greatest(${battleRoyaleStats.bestWinStreak}, case when ${won} then ${battleRoyaleStats.currentWinStreak} + 1 else 0 end)`,
        // Overwrite (not accumulate) with the latest game's result.
        wonLastGame: won,
        lastPlayedAt: now,
        updatedAt: now,
      },
    });
};

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
