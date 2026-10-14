import type { Server } from "socket.io";
import type {
  Game,
  PlayerDisplay,
  ServerBotData,
  ServerOnlyData,
} from "types/battle-royale.types.js";
import logger from "../../../utils/logger.js";
import { MATCH_TIME_LIMIT_MS } from "shared/battle-royale.js";
import { emitBattleRoyaleKeyframe } from "../lobby.js";
import { persistEliminatedAsLoss } from "../stats.js";

type RevealEliminatedPlayerWord = (
  player: PlayerDisplay,
  playerId: string,
  roomId: string,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
) => void;

type CleanupGame = (
  roomId: string,
  games: Map<string, Game>,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
) => void;

// picks a winner if the match hits the 10-minute cap: most correct guesses,
// tie-broken by fewest total guesses, then most life remaining
export const scheduleMatchTimeLimit = ({
  game,
  io,
  games,
  serverOnlyData,
  serverOnlyBotData,
  revealEliminatedPlayerWord,
  cleanupGame,
}: {
  game: Game;
  io: Server;
  games: Map<string, Game>;
  serverOnlyData: ServerOnlyData;
  serverOnlyBotData: ServerBotData;
  revealEliminatedPlayerWord: RevealEliminatedPlayerWord;
  cleanupGame: CleanupGame;
}) =>
  setTimeout(() => {
    if (game.room.isFinished) {
      return;
    }

    const activePlayers = Array.from(game.players.entries()).filter(
      ([, player]) => !player.isEliminated,
    );

    if (activePlayers.length === 0) {
      game.room.isFinished = true;
      game.room.isDraw = true;
      logger.info(
        { roomId: game.room.lobbyId },
        "Game ended in a draw: match time limit reached with no active players",
      );
    } else {
      const [winnerId, winner] = activePlayers.reduce((best, current) => {
        const [, bestPlayer] = best;
        const [, currentPlayer] = current;

        if (currentPlayer.correctGuesses !== bestPlayer.correctGuesses) {
          return currentPlayer.correctGuesses > bestPlayer.correctGuesses
            ? current
            : best;
        }

        if (currentPlayer.totalGuesses !== bestPlayer.totalGuesses) {
          return currentPlayer.totalGuesses < bestPlayer.totalGuesses
            ? current
            : best;
        }

        return currentPlayer.life > bestPlayer.life ? current : best;
      });

      game.room.winnerId = winnerId;
      game.room.isFinished = true;

      // All non-winners are eliminated at the cap simultaneously; they share
      // one timestamp so placement ties are broken by performance.
      const eliminatedAt = Date.now();
      const eliminatedThisTick: string[] = [];
      for (const [playerId, player] of activePlayers) {
        if (playerId !== winnerId) {
          player.isEliminated = true;
          player.endTimeStamp = eliminatedAt;
          eliminatedThisTick.push(playerId);
          revealEliminatedPlayerWord(
            player,
            playerId,
            game.room.lobbyId,
            serverOnlyData,
            serverOnlyBotData,
          );
        }
      }

      // Record the real players eliminated at the cap as losses now; the winner
      // is recorded by the finish/cleanup path. Skips bots + already-recorded.
      if (eliminatedThisTick.length > 0) {
        persistEliminatedAsLoss(game, eliminatedThisTick);
      }

      logger.info(
        {
          roomId: game.room.lobbyId,
          winnerId,
          correctGuesses: winner.correctGuesses,
          totalGuesses: winner.totalGuesses,
        },
        "Game ended: match time limit reached",
      );
    }

    // Terminal state broadcast at the match cap, right before teardown. Route
    // it through the shared keyframe emitter rather than a bare `serializeGame`
    // emit so it goes through the keyframe/delta decision like every other
    // state broadcast (realtime-broadcast-scaling Req 3.7). Flag-OFF this is
    // byte-identical to the previous full `lobby:update` snapshot; flag-ON it
    // is a proper keyframe that advances the room's version so a stale bare
    // snapshot never desyncs the client's sequence base. A keyframe is the
    // right shape here: it is the definitive final full state (mirrors Race's
    // finish-side `emitRaceUpdate`), and it correctly advances `seq`/`lastSent`.
    emitBattleRoyaleKeyframe(io, game.room.lobbyId, game);
    cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
  }, MATCH_TIME_LIMIT_MS);
