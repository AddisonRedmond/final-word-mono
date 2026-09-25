import type { Server } from "socket.io";
import type { Game, TargetType } from "types/battle-royale.types.js";
import {
  handleStartGame,
  handleStartLobbyTimer,
  findGameForUser,
  checkWord,
  getOrCreateGame,
  getRandomWord,
  handleAddBots,
  applyCorrectGuessReward,
  applyAttack,
  cleanupGame,
  determineTarget,
  Max_Attack_Words,
} from "./logic/battle-royale.js";
import { runBots } from "./logic/battle-royale-bots.js";
import logger from "../../utils/logger.js";
import {
  MAX_PLAYERS,
  games,
  serverOnlyData,
  serverOnlyBotData,
} from "./state.js";
import { emitLobbyUpdate, scheduleLobbyUpdate } from "./lobby.js";
import { getGuessContext, hasUnrevealedOccurrence } from "./guess.js";

/**
 * Wires up all battle-royale socket event handlers on the shared Socket.IO
 * server. Called once at startup by the game module.
 */
export const registerBattleRoyaleHandlers = (io: Server) => {
  io.on("connection", (socket) => {
    logger.info(
      { socketId: socket.id, userId: socket.data.userId },
      "Socket connected",
    );

    socket.on("disconnect", () => {
      const { roomId, name, userId } = socket.data;
      logger.info(
        { socketId: socket.id, roomId, userId, name },
        "Socket disconnected",
      );

      if (!roomId) {
        return;
      }

      const game = games.get(roomId);

      if (!game || !game.players.has(userId)) {
        logger.warn(
          { roomId, userId },
          "Disconnected socket was not present in game state",
        );
        return;
      }

      // Keep the player and their private game data so an accidental disconnect
      // can reconnect to the same game. Explicit leave removes them below.
      scheduleLobbyUpdate(io, roomId, game);
    });

    socket.on("leave", (ack?: (response: { ok: boolean }) => void) => {
      const { roomId, userId, name } = socket.data;

      if (!roomId) {
        logger.warn(
          { socketId: socket.id, userId },
          "Leave ignored: socket is not in a room",
        );
        ack?.({ ok: false });
        return;
      }

      const game = games.get(roomId);

      if (!game) {
        logger.warn(
          { roomId, userId },
          "Leave ignored: room state was not found",
        );
        ack?.({ ok: false });
        return;
      }

      // might have to change this, to a different flag so eliminated users dont unrender
      game.players.delete(userId);

      const roomServerOnlyData = serverOnlyData.get(roomId);

      if (roomServerOnlyData) {
        delete roomServerOnlyData.playerData[userId];
      }

      socket.data.roomId = undefined;
      socket.leave(roomId);

      if (game.players.size === 0) {
        cleanupGame(roomId, games, serverOnlyData, serverOnlyBotData);
      } else {
        scheduleLobbyUpdate(io, roomId, game);
      }

      logger.info(
        { roomId, userId, name, remainingPlayers: game.players.size },
        "Player left game",
      );
      ack?.({ ok: true });
    });

    socket.on("join", () => {
      const { userId, name } = socket.data;
      logger.info({ socketId: socket.id, userId, name }, "Player joining game");

      // reconnect logic:start
      const existingGame = findGameForUser(games, userId);
      const existingPlayer = existingGame?.players.get(userId);

      if (existingGame && existingPlayer && existingPlayer.isEliminated) {
        const oldRoomId = existingGame.room.lobbyId;

        existingGame.players.delete(userId);

        const oldRoomServerOnlyData = serverOnlyData.get(oldRoomId);

        if (oldRoomServerOnlyData) {
          delete oldRoomServerOnlyData.playerData[userId];
        }

        if (existingGame.players.size === 0) {
          cleanupGame(oldRoomId, games, serverOnlyData, serverOnlyBotData);
        } else {
          scheduleLobbyUpdate(io, oldRoomId, existingGame);
        }

        logger.info(
          { roomId: oldRoomId, userId },
          "Removed eliminated player from old game, routing to new game",
        );
        // fall through so this socket joins/starts a fresh game below
      }

      if (existingGame && existingPlayer && !existingPlayer.isEliminated) {
        const roomId = existingGame.room.lobbyId;

        socket.data.roomId = roomId;
        socket.join(roomId);

        socket.emit("join:ack", {
          ...existingGame,
          players: Object.fromEntries(existingGame.players),
        });

        logger.info(
          { roomId, userId, playerCount: existingGame.players.size },
          "Player rejoined game",
        );

        return;
      }
      // reconnect logic:end

      const game = getOrCreateGame(games, MAX_PLAYERS);
      const roomId = game.room.lobbyId;

      logger.info(
        { roomId, userId, playerCount: game.players.size + 1 },
        "Player added to game",
      );

      let roomServerOnlyData = serverOnlyData.get(roomId);

      socket.data.roomId = roomId;

      game.players.set(userId, {
        name,
        isEliminated: false,
        life: 0,
        totalGuesses: 0,
        correctGuesses: 0,
        currentWordGuesses: 0,
      });

      // start: if there isn't existing roomServerData build it
      if (!roomServerOnlyData) {
        const newRoomServerOnlyData = {
          playerData: {},
          timers: {},
        };
        roomServerOnlyData = newRoomServerOnlyData;

        serverOnlyData.set(roomId, newRoomServerOnlyData);

        const timers = roomServerOnlyData.timers;

        const startTimer = setTimeout(
          () => {
            const totalPlayersJoined = game.players.size;

            if (MAX_PLAYERS > totalPlayersJoined) {
              const numberOfBotsToAdd = MAX_PLAYERS - totalPlayersJoined;

              const { botsDisplayData, roomBotServerData } =
                handleAddBots(numberOfBotsToAdd);

              logger.info(
                { roomId, numberOfBotsToAdd },
                "Adding bots to fill lobby",
              );

              serverOnlyBotData.set(roomId, roomBotServerData);

              botsDisplayData.forEach((bot) => {
                game.players.set(bot.name, bot);
              });
            }

            const lobbyStarted = handleStartLobbyTimer(
              game,
              io,
              timers,
              games,
              serverOnlyData,
              serverOnlyBotData,
            );

            if (lobbyStarted) {
              logger.info(
                { roomId, playerCount: game.players.size },
                "Lobby timer started",
              );
              const bots = serverOnlyBotData.get(roomId);

              if (bots) {
                timers.botTicker = runBots(
                  bots,
                  game.players,
                  newRoomServerOnlyData.playerData,
                  () => {
                    scheduleLobbyUpdate(io, roomId, game);
                  },
                );
              }
            }
          },
          Math.max(game.room.startTime - Date.now(), 0),
        );

        timers.startTimer = startTimer;
      }
      // end: if there isn't existing roomServerData build it
      roomServerOnlyData.playerData[userId] = {
        word: getRandomWord(),
        currentWordIsAttack: false,
        queue: [],
      };
      socket.join(roomId);

      if (game.players.size >= MAX_PLAYERS) {
        if (roomServerOnlyData.timers.startTimer) {
          clearTimeout(roomServerOnlyData.timers.startTimer);
        }

        handleStartGame(
          game,
          io,
          roomServerOnlyData.timers,
          games,
          serverOnlyData,
          serverOnlyBotData,
        );
        logger.info(
          { roomId, playerCount: game.players.size },
          "Game started at player capacity",
        );
      }

      emitLobbyUpdate(io, roomId, game);
    });

    socket.on("guess", (payload: { word: string; target: TargetType }) => {
      const roomId = socket.data.roomId as string | undefined;
      const userId = socket.data.userId as string | undefined;

      if (!roomId || !userId) {
        return;
      }

      const { game, roomServerOnlyData, player, targetWord, guessedWord } =
        getGuessContext(roomId, userId, payload);

      if (
        !game ||
        !roomServerOnlyData ||
        !player ||
        game.room.isFinished ||
        game.room.isDraw ||
        !targetWord ||
        !guessedWord ||
        player?.isEliminated
      ) {
        logger.warn(
          {
            roomId,
            userId,
            hasGame: Boolean(game),
            hasServerData: Boolean(roomServerOnlyData),
            hasPlayer: Boolean(player),
          },
          "Guess ignored: incomplete game state",
        );
        return;
      }

      player.totalGuesses += 1;
      player.currentWordGuesses += 1;

      const result = checkWord(guessedWord, targetWord);

      // update attack to calculate backend probably

      if (result.isMatch) {
        const guessCount = player.currentWordGuesses;
        const isAttackable = (playerId: string) => {
          const queueLength =
            roomServerOnlyData.playerData[playerId]?.queue.length ??
            serverOnlyBotData.get(roomId)?.[playerId]?.queue.length ??
            0;
          return queueLength < Max_Attack_Words;
        };
        const targetId = determineTarget(
          game.players,
          userId,
          payload.target,
          isAttackable,
        );
        const target = game.players.get(targetId);
        const targetServerData =
          roomServerOnlyData.playerData[targetId] ??
          serverOnlyBotData.get(roomId)?.[targetId];
        if (!roomServerOnlyData.playerData[userId].currentWordIsAttack) {
          applyAttack(
            targetWord,
            guessCount,
            target,
            targetServerData,
            player.name,
          );
        }
        applyCorrectGuessReward({
          player,
          userId,
          roomServerOnlyData: roomServerOnlyData.playerData,
        });
      } else {
        player.revealed_letters = {
          ...(player.revealed_letters ?? {}),
          ...result.fullMatches,
        };

        player.partialMatches = [
          ...new Set([
            ...(player.partialMatches ?? []),
            ...result.partialMatches,
          ]),
        ].filter((letter) =>
          hasUnrevealedOccurrence(
            targetWord,
            letter,
            player.revealed_letters ?? {},
          ),
        );

        player.noMatch = [
          ...new Set([...(player.noMatch ?? []), ...result.noMatch]),
        ].filter((letter) => !player.partialMatches?.includes(letter));
      }
      scheduleLobbyUpdate(io, roomId, game);
    });
  });
};
