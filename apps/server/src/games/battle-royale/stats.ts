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
 * Placement reflects where the player actually finished among everyone they
 * played against — losing to a bot counts as 2nd, matching what the player saw
 * on screen. The winner (room.winnerId, bot or human) is placement 1; everyone
 * else is ranked 2..N using the same tiebreak the game uses to resolve a
 * time-limit winner (more correct guesses first, then fewer total guesses). In
 * a draw (no winnerId) everyone shares placement 1 and no win is recorded. We
 * can't do better than this ordering without recording elimination order,
 * which the game does not currently track.
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

  // Order the whole lobby: winner first, then the rest by the game's tiebreak.
  const ordered = [...allPlayers].sort(([idA, a], [idB, b]) => {
    if (idA === winnerId) {
      return -1;
    }
    if (idB === winnerId) {
      return 1;
    }
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
    const ranked = rankPlayers(game);

    if (ranked.length === 0) {
      return;
    }

    const now = new Date();

    await Promise.all(
      ranked.map(({ userId, placement, won, player }) =>
        upsertPlayerStat(
          {
            userId,
            placement,
            won,
            isDraw: game.room.isDraw,
            totalGuesses: player.totalGuesses,
            correctGuesses: player.correctGuesses,
          },
          now,
        ),
      ),
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

  // Snapshot everything SYNCHRONOUSLY here: the caller deletes the player from
  // game.players immediately after this returns, so placement (current field
  // size, leaver included) and the guess counts must be read now, before the
  // async DB write runs on a later microtask.
  const placement = game.players.size;
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
        "Recorded leaver as a Battle Royale loss",
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
