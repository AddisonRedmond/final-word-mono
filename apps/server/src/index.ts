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
  lifeMap,
  getOrCreateGame,
  getRandomWord,
  handleAddBots,
} from "../utils/battle-royale.js";
import type {
  Game,
  PlayerDisplay,
  ServerOnlyData,
  ServerBotData,
  TargetTypes,
} from "../../../packages/types/src/game.js";
const app = new Hono();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const Max_Players = 99;

const games = new Map<string, Game>();
const serverOnlyData: ServerOnlyData = new Map();
const serverOnlyBotData = new Map<string, ServerBotData>();

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

type ServerOnlyRoomData =
  ServerOnlyData extends Map<string, infer TValue> ? TValue : never;

const getGuessContext = (
  roomId: string,
  userId: string,
  payload: { word: string; targetType: TargetTypes },
) => {
  const game = games.get(roomId);
  const roomServerOnlyData = serverOnlyData.get(roomId);
  const player = game?.players.get(userId);
  const targetWord = roomServerOnlyData?.playerData[userId];
  const guessedWord = payload?.word;

  return {
    game,
    roomServerOnlyData,
    player,
    targetWord,
    guessedWord,
  };
};

const applyCorrectGuessReward = ({
  player,
  userId,
  roomServerOnlyData,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerOnlyRoomData;
}) => {
  const guessCount = Math.min(
    Math.max(player.currentWordGuesses, 1),
    10,
  ) as keyof typeof lifeMap;
  const bonusLife = lifeMap[guessCount];
  const now = Date.now();
  const maxLifeExpiry = now + 3 * 60 * 1000;
  const currentLife = Math.max(player.life, now);
  player.life = Math.min(currentLife + bonusLife, maxLifeExpiry);

  player.currentWordGuesses = 0;
  player.revealed_letters = {};
  player.noMatch = [];
  player.partialMatches = [];
  roomServerOnlyData.playerData[userId] = getRandomWord();
};

const applyInorrectGuessFailure = ({
  player,
  userId,
  roomServerOnlyData,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerOnlyRoomData;
}) => {
  const now = Date.now();
  const currentLife = Math.max(player.life, now);
  player.life = Math.max(currentLife - 10_000, now);

  player.currentWordGuesses = 0;
  player.revealed_letters = {};
  player.noMatch = [];
  player.partialMatches = [];

  roomServerOnlyData.playerData[userId] = getRandomWord();
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
    const { roomId, userId, name } = socket.data;
    console.log(`${name} disconnected`);

    if (!roomId) {
      return;
    }

    const game = games.get(roomId);
    if (!game || !game.players.has(userId)) {
      return;
    }

    // Keep the player and their private game data so an accidental disconnect
    // can reconnect to the same game. Explicit leave removes them below.
    emitLobbyUpdate(roomId, game);
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
      // TODO: extract into utils folder
      delete roomServerOnlyData.playerData[userId];
      if (Object.keys(roomServerOnlyData.playerData).length === 0) {
        if (roomServerOnlyData.timers.startTimer) {
          clearTimeout(roomServerOnlyData.timers.startTimer);
        }
        if (roomServerOnlyData.timers.gameTimer) {
          clearInterval(roomServerOnlyData.timers.gameTimer);
        }
        serverOnlyData.delete(roomId);
      }
    }

    socket.data.roomId = undefined;
    socket.leave(roomId);

    if (game.players.size === 0) {
      games.delete(roomId);
      serverOnlyData.delete(roomId);
      serverOnlyBotData.delete(roomId);
    } else {
      io.to(roomId).emit("lobby:update", {
        ...game,
        players: Object.fromEntries(game.players),
      });
    }

    console.log(`${name} left ${roomId}`);
    ack?.({ ok: true });
  });

  socket.on("join", () => {
    const { userId, name } = socket.data;
    console.log(`${name} connected`);

    const existingGame = findGameForUser(games, userId);
    const existingPlayer = existingGame?.players.get(userId);

    // TODO: user clean up
    if (existingGame && existingPlayer) {
      if (existingPlayer.isEliminated) {
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
            const { botsDisplayData, botsServerData } =
              handleAddBots(numberOfBotsToAdd);
            serverOnlyBotData.set(roomId, botsServerData);
            botsDisplayData.forEach((bot) => {
              game.players.set(bot.name, bot);
            });
          }
          handleStartLobbyTimer(game, io, timers);
          // create a bot guess ticker and add it to the serverOnlyData.room
          // create and run a bot guessing interval function
        },
        Math.max(game.room.startTime - Date.now(), 0),
      );
      timers.startTimer = startTimer;
    }

    roomServerOnlyData.playerData[userId] = getRandomWord();
    socket.join(roomId);

    if (game.players.size >= Max_Players) {
      if (roomServerOnlyData.timers.startTimer) {
        clearTimeout(roomServerOnlyData.timers.startTimer);
      }
      handleStartGame(game, io, roomServerOnlyData.timers);
    }

    io.to(roomId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });
  });

  socket.on("guess", (payload: { word: string; targetType: TargetTypes }) => {
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
        roomServerOnlyData,
      });
    } else {
      // TODO: maybe apply punishment if player fails to guess to times in a row
      // TODO: if the word has double letters, even if the index of one of the double letters is correct, it should still be yellow
      // until they get both of the double letters
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

    emitLobbyUpdate(roomId, game);
  });
});
