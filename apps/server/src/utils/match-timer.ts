import type { Server } from "socket.io";
import type {
  Game,
  PlayerDisplay,
  ServerBotData,
  ServerOnlyData,
} from "types/battle-royale.types.js";
import logger from "./logger.js";
import { MATCH_TIME_LIMIT_MS } from "shared/battle-royale.js";

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

      for (const [playerId, player] of activePlayers) {
        if (playerId !== winnerId) {
          player.isEliminated = true;
          revealEliminatedPlayerWord(
            player,
            playerId,
            game.room.lobbyId,
            serverOnlyData,
            serverOnlyBotData,
          );
        }
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

    io.to(game.room.lobbyId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });
    cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
  }, MATCH_TIME_LIMIT_MS);
