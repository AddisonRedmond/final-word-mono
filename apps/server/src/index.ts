import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import "dotenv/config";
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
} from "./utils/battle-royale.js";
import type {
  Game,
  ServerOnlyData,
  ServerBotData,
} from "types/battle-royale.types.js";
import { runBots } from "./utils/battle-royale-bots.js";
import logger from "./utils/logger.js";

const app = new Hono();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const Max_Players = 99;
const Game_Update_Delay = 250;

const games = new Map<string, Game>();
const serverOnlyData: ServerOnlyData = new Map();
const serverOnlyBotData: ServerBotData = new Map();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables for WebSocket auth");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorizationHeader.slice(7).trim() || null;
};

app.get("/", (c) => {
  return c.text("Hello Hono!");
});
const port = Number(process.env.PORT ?? 4200);
const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info(`Server is running on http://localhost:${info.port}`);
  },
);
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: "*",
  },
});

const emitLobbyUpdate = (roomId: string, game: Game) => {
  io.to(roomId).emit("lobby:update", {
    ...game,
    players: Object.fromEntries(game.players),
  });
};

const scheduleLobbyUpdate = (roomId: string, game: Game) => {
  const roomServerOnlyData = serverOnlyData.get(roomId);

  if (!roomServerOnlyData) {
    return;
  }

  if (roomServerOnlyData.timers.updateTicker) {
    return;
  }

  roomServerOnlyData.timers.updateTicker = setTimeout(() => {
    roomServerOnlyData.timers.updateTicker = undefined;

    emitLobbyUpdate(roomId, game);
  }, Game_Update_Delay);
};

const getGuessContext = (
  roomId: string,
  userId: string,
  payload: { word: string; target: string },
) => {
  const game = games.get(roomId);
  const roomServerOnlyData = serverOnlyData.get(roomId);
  const player = game?.players.get(userId);
  const targetWord = roomServerOnlyData?.playerData[userId]?.word;
  const guessedWord = payload?.word;

  return {
    game,
    roomServerOnlyData,
    player,
    targetWord,
    guessedWord,
  };
};

io.use(async (socket, next) => {
  const authToken =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : null;

  const queryToken =
    typeof socket.handshake.query.access_token === "string"
      ? socket.handshake.query.access_token
      : null;

  const rawAuthHeader = socket.handshake.headers.authorization;
  const headerToken = getBearerToken(
    typeof rawAuthHeader === "string" ? rawAuthHeader : undefined,
  );

  const accessToken = authToken ?? queryToken ?? headerToken;

  if (!accessToken) {
    logger.warn(
      { socketId: socket.id },
      "Socket authentication rejected: missing token",
    );
    next(new Error("Unauthorized: missing access token"));
    return;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    logger.warn(
      { socketId: socket.id, error: error?.message },
      "Socket authentication rejected: invalid token",
    );
    next(new Error("Unauthorized: invalid access token"));
    return;
  }

  socket.data.userId = user.id;
  socket.data.name = user.user_metadata?.full_name ?? "Player";

  next();
});

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
    scheduleLobbyUpdate(roomId, game);
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
      scheduleLobbyUpdate(roomId, game);
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
        scheduleLobbyUpdate(oldRoomId, existingGame);
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

    const game = getOrCreateGame(games, Max_Players);
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

          if (Max_Players > totalPlayersJoined) {
            const numberOfBotsToAdd = Max_Players - totalPlayersJoined;

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
                  scheduleLobbyUpdate(roomId, game);
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
      queue: [],
    };

    socket.join(roomId);

    if (game.players.size >= Max_Players) {
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

    emitLobbyUpdate(roomId, game);
  });

  socket.on("guess", (payload: { word: string; target: string }) => {
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

    // TODO: need to add and remove partial matches when they're added to the revealed letters object
    // so we can leave double letter words like BOOKS partial match even if the user has guessed one "O"
    const result = checkWord(guessedWord, targetWord);

    if (result.isMatch) {
      const guessCount = player.currentWordGuesses;
      applyCorrectGuessReward({
        player,
        userId,
        roomServerOnlyData: roomServerOnlyData.playerData,
      });
      const target = game.players.get(payload.target);
      const targetServerData =
        roomServerOnlyData.playerData[payload.target] ??
        serverOnlyBotData.get(roomId)?.[payload.target];
      applyAttack(targetWord, guessCount, target, targetServerData);
    } else {
      const fullLetters = Object.values(result.fullMatches);

      player.revealed_letters = {
        ...(player.revealed_letters ?? {}),
        ...result.fullMatches,
      };

      player.partialMatches = [
        ...new Set([
          ...(player.partialMatches ?? []),
          ...result.partialMatches,
        ]),
      ].filter((letter) => !fullLetters.includes(letter));

      player.noMatch = [
        ...new Set([...(player.noMatch ?? []), ...result.noMatch]),
      ].filter(
        (letter) =>
          !fullLetters.includes(letter) &&
          !player.partialMatches?.includes(letter),
      );
    }
    scheduleLobbyUpdate(roomId, game);
  });
});
