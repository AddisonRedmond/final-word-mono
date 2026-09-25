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

/**
 * Upsert per-user aggregate Battle Royale stats for a finished match.
 *
 * One row per user (see packages/db schema). Existing rows are incremented in
 * SQL so concurrent match finishes can't clobber each other's totals. Bots are
 * excluded. This never throws into the caller (the game loop) — any failure is
 * logged and swallowed so cleanup always completes.
 */
export const persistBattleRoyaleStats = async (game: Game): Promise<void> => {
  try {
    const ranked = rankPlayers(game);

    if (ranked.length === 0) {
      return;
    }

    const now = new Date();

    // One upsert per player. Kept as separate statements (rather than a single
    // multi-row insert) because each row's streak logic depends on its own
    // prior value via SQL CASE expressions.
    await Promise.all(
      ranked.map(({ userId, placement, won, player }) => {
        const winInc = won ? 1 : 0;
        const drawInc = game.room.isDraw ? 1 : 0;

        return db
          .insert(battleRoyaleStats)
          .values({
            userId,
            gamesPlayed: 1,
            wins: winInc,
            draws: drawInc,
            placementSum: placement,
            bestPlacement: placement,
            totalGuesses: player.totalGuesses,
            totalCorrectGuesses: player.correctGuesses,
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
              placementSum: sql`${battleRoyaleStats.placementSum} + ${placement}`,
              bestPlacement: sql`least(coalesce(${battleRoyaleStats.bestPlacement}, ${placement}), ${placement})`,
              totalGuesses: sql`${battleRoyaleStats.totalGuesses} + ${player.totalGuesses}`,
              totalCorrectGuesses: sql`${battleRoyaleStats.totalCorrectGuesses} + ${player.correctGuesses}`,
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
