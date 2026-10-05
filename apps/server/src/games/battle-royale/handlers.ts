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
  cementedCount,
  applyIndexBleedToCemented,
  removeAccidentallyGuessedCemented,
  syncAttackQueueDisplay,
  getMatchStartMs,
} from "./logic/battle-royale.js";
import { runBots } from "./logic/battle-royale-bots.js";
import { persistLeaverAsLoss } from "./stats.js";
import logger from "../../utils/logger.js";
import { GUEST_MODE_LIMIT_REASON } from "../guest-mode-gate.js";
import { canStartMatch } from "./daily-limit.js";
import {
  MAX_PLAYERS,
  games,
  serverOnlyData,
  serverOnlyBotData,
} from "./state.js";
import { emitLobbyUpdate, scheduleLobbyUpdate } from "./lobby.js";
import { getGuessContext, hasUnrevealedOccurrence } from "./guess.js";

// Bots are keyed `bot0`/`bot1`/…, real players by Supabase auth UUID — so a
// non-UUID id is a bot (the same detection stats.ts uses). Used by the leave
// handler to decide whether any real human remains in the room.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

      // Leaving a game that is already underway counts as a loss (prevents
      // rage-quitting to protect stats). Leaving a lobby that hasn't started
      // yet is free. Record BEFORE removing the player so they are still in
      // game.players and their placement reflects the current field size.
      if (game.room.isStarted && !game.room.isFinished) {
        persistLeaverAsLoss(game, userId);
      }

      // might have to change this, to a different flag so eliminated users dont unrender
      game.players.delete(userId);

      const roomServerOnlyData = serverOnlyData.get(roomId);

      if (roomServerOnlyData) {
        delete roomServerOnlyData.playerData[userId];
      }

      socket.data.roomId = undefined;
      socket.leave(roomId);

      // Whether any real human remains in the room at all. A disconnect RETAINS
      // the player (for reconnect), so only an explicit leave removes them; a
      // human who is eliminated but still connected is a spectator and keeps
      // the room alive. When the LAST human leaves, only bots (if any) remain —
      // nobody is watching, so tear the room down. Every real player's stats
      // were already recorded at their outcome (eliminated players at
      // elimination; this leaver via persistLeaverAsLoss above), so cleanup has
      // nothing left to persist and no bot is ever crowned.
      const hasRealPlayer = Array.from(game.players.keys()).some((id) =>
        UUID_RE.test(id),
      );

      if (game.players.size === 0 || !hasRealPlayer) {
        if (game.players.size > 0 && !hasRealPlayer) {
          logger.info(
            { roomId, remainingBots: game.players.size },
            "Battle Royale lobby cleaned up: last human left, only bots remain",
          );
        }
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

    socket.on("join", async () => {
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

      // --- match-start gate --------------------------------------------------
      // Consult the daily-limit seam before placing the player (single gated
      // call for all match-start gating, R9.4). Battle Royale had no daily-limit
      // seam before the guest feature, so this call is additive. Registered
      // users pass straight through (R6.8); a guest is held to one game per mode
      // (R6.1–R6.4) via `canStartMatch(userId, socket.data.isAnonymous)`. On a
      // block the player is NOT placed in any lobby — a guest block maps to the
      // `guest-mode-limit` reason so the client can show the sign-up prompt
      // (R6.3, R6.5); a (future) daily-limit block keeps the `daily-limit`
      // reason.
      const permitted = await canStartMatch(userId, socket.data.isAnonymous);
      if (!permitted) {
        socket.emit("join:error", {
          reason: socket.data.isAnonymous
            ? GUEST_MODE_LIMIT_REASON
            : "daily-limit",
        });
        logger.info(
          { userId, isAnonymous: socket.data.isAnonymous },
          "Battle Royale join rejected: match-start gate blocked",
        );
        return;
      }

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
        isAnonymous: socket.data.isAnonymous, // R4.5 / R4.6
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
                {
                  roomId,
                  humansJoined: totalPlayersJoined,
                  botsAdded: numberOfBotsToAdd,
                  maxPlayers: MAX_PLAYERS,
                },
                "Added bots to Battle Royale lobby: not enough humans joined to fill the field",
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
                  () => getMatchStartMs(game),
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
        pending: [],
        cemented: [],
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

      const selfServerData = roomServerOnlyData.playerData[userId];

      // §5.2a: on EVERY submitted guess, the player's own guessing erodes their
      // CEMENTED backlog (pending words are untouched here):
      // - index-bleed: full-match indexes reveal the same position on cemented
      //   words sharing that letter at that index (positional coincidence).
      // - accidental-match: an exact match on a cemented word removes it, as an
      //   independent side effect of this guess.
      // Both run before the normal solve/reward branch and are independent of
      // whether this guess solves the current word.
      if (selfServerData) {
        applyIndexBleedToCemented(selfServerData, result.fullMatches);
        removeAccidentallyGuessedCemented(selfServerData, guessedWord);
        syncAttackQueueDisplay(player, selfServerData);
      }

      if (result.isMatch) {
        const guessCount = player.currentWordGuesses;
        // §5.2a: only CEMENTED words count toward the attack cap; pending words
        // are an escapable buffer the defender can still clear.
        const isAttackable = (playerId: string) => {
          const data =
            roomServerOnlyData.playerData[playerId] ??
            serverOnlyBotData.get(roomId)?.[playerId];
          return data ? cementedCount(data) < Max_Attack_Words : true;
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
        if (!roomServerOnlyData.playerData[userId]?.currentWordIsAttack) {
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
          matchStartMs: getMatchStartMs(game),
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
