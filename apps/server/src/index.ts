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
} from "../utils/battle-royale.js";
import type {
  Game,
  PlayerDisplay,
  ServerOnlyData,
  ServerBotData,
  TargetType,
  RoomServerData,
} from "../../../packages/types/src/battle-royale.types.js";
import { runBots } from "../utils/battle-royale-bots.js";

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

const server = serve(
  {
    fetch: app.fetch,
    port: 4200,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
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

const cleanupGame = (roomId: string) => {
  const roomServerOnlyData = serverOnlyData.get(roomId);

  if (roomServerOnlyData) {
    const { startTimer, gameTimer, botTicker, updateTicker } =
      roomServerOnlyData.timers;

    if (startTimer) {
      clearTimeout(startTimer);
    }

    if (gameTimer) {
      clearInterval(gameTimer);
    }

    if (botTicker) {
      clearInterval(botTicker);
    }

    if (updateTicker) {
      clearTimeout(updateTicker);
    }
  }

  games.delete(roomId);
  serverOnlyData.delete(roomId);
  serverOnlyBotData.delete(roomId);
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
    next(new Error("Unauthorized: missing access token"));
    return;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    next(new Error("Unauthorized: invalid access token"));
    return;
  }

  socket.data.userId = user.id;
  socket.data.name = user.user_metadata?.full_name ?? "Player";

  next();
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    const { roomId, name } = socket.data;
    console.log(`${name} disconnected`);

    if (!roomId) {
      return;
    }

    const game = games.get(roomId);
    const userId = socket.data.userId;

    if (!game || !game.players.has(userId)) {
      return;
    }

    // Keep the player and their private game data so an accidental disconnect
    // can reconnect to the same game. Explicit leave removes them below.
    scheduleLobbyUpdate(roomId, game);
  });

  socket.on("leave", (ack?: (response: { ok: boolean }) => void) => {
    const { roomId, userId, name } = socket.data;

    if (!roomId) {
      ack?.({ ok: false });
      return;
    }

    const game = games.get(roomId);

    if (!game) {
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
      cleanupGame(roomId);
    } else {
      scheduleLobbyUpdate(roomId, game);
    }

    console.log(`${name} left ${roomId}`);
    ack?.({ ok: true });
  });

  socket.on("join", () => {
    const { userId, name } = socket.data;
    console.log(`${name} connected`);

    // reconnect logic:start
    const existingGame = findGameForUser(games, userId);
    const existingPlayer = existingGame?.players.get(userId);

    if (existingGame && existingPlayer) {
      if (existingPlayer.isEliminated) {
        //TODO:clean up user from game so they can join another game
        socket.emit("join:error", {
          code: "ELIMINATED",
          message: "Eliminated players cannot rejoin this game.",
        });
        return;
      }

      const roomId = existingGame.room.lobbyId;

      socket.data.roomId = roomId;
      socket.join(roomId);

      socket.emit("join:ack", {
        ...existingGame,
        players: Object.fromEntries(existingGame.players),
      });

      return;
    }
    // reconnect logic:end

    const game = getOrCreateGame(games, Max_Players);
    const roomId = game.room.lobbyId;

    let roomServerOnlyData = serverOnlyData.get(roomId);

    socket.data.roomId = roomId;

    game.players.set(userId, {
      name,
      isEliminated: false,
      life: 0,
      totalGuesses: 0,
      currentWordGuesses: 0,
    });

    // start: if there isn't existing roomServerData build it
    if (!roomServerOnlyData) {
      roomServerOnlyData = {
        playerData: {},
        timers: {},
      };

      serverOnlyData.set(roomId, roomServerOnlyData);

      const timers = roomServerOnlyData.timers;

      const startTimer = setTimeout(
        () => {
          const totalPlayersJoined = game.players.size;

          if (Max_Players > totalPlayersJoined) {
            const numberOfBotsToAdd = Max_Players - totalPlayersJoined;

            const { botsDisplayData, roomBotServerData } =
              handleAddBots(numberOfBotsToAdd);

            serverOnlyBotData.set(roomId, roomBotServerData);

            botsDisplayData.forEach((bot) => {
              game.players.set(bot.name, bot);
            });
          }

          const lobbyStarted = handleStartLobbyTimer(game, io, timers);

          if (lobbyStarted) {
            const bots = serverOnlyBotData.get(roomId);

            if (bots) {
              timers.botTicker = runBots(bots, game.players, () => {
                scheduleLobbyUpdate(roomId, game);
              });
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

      handleStartGame(game, io, roomServerOnlyData.timers);
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
      !targetWord ||
      !guessedWord
    ) {
      return;
    }

    console.log(roomServerOnlyData.playerData);

    player.totalGuesses += 1;
    player.currentWordGuesses += 1;

    const result = checkWord(guessedWord, targetWord);

    if (result.isMatch) {
      applyCorrectGuessReward({
        player,
        userId,
        roomServerOnlyData: roomServerOnlyData.playerData,
      });
      applyAttack();
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
