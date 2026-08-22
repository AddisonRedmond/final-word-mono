import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import "dotenv/config";
import { getOrCreateGame, GetRandomWord } from "../utils/game-utils.js";
import {
  handleStartGame,
  handleStartLobbyTimer,
  findGameForUser,
  checkWord,
  lifeMap,
} from "../utils/battle-royale.js";
import type {
  Game,
  PlayerDisplay,
  ServerOnlyData,
} from "../../../packages/types/src/game.js";
const app = new Hono();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const Max_Players = 50;

const games = new Map<string, Game>();
const serverOnlyData: ServerOnlyData = new Map();

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

const getGuessContext = (roomId: string, userId: string, payload: unknown) => {
  const game = games.get(roomId);
  const roomServerOnlyData = serverOnlyData.get(roomId);
  const player = game?.players.get(userId);
  const targetWord = roomServerOnlyData?.playerData[userId];
  const guessedWord =
    typeof payload === "object" &&
    payload !== null &&
    "word" in payload &&
    typeof payload.word === "string"
      ? payload.word
      : undefined;

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
    7,
  ) as keyof typeof lifeMap;
  const bonusLife = lifeMap[guessCount];
  const now = Date.now();
  const maxLifeExpiry = now + 3 * 60 * 1000;
  const currentLife = Math.max(player.life, now);
  player.life = Math.min(currentLife + bonusLife, maxLifeExpiry);

  player.currentWordGuesses = 0;

  roomServerOnlyData.playerData[userId] = GetRandomWord();
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
        () => handleStartLobbyTimer(game, io, timers),
        Math.max(game.room.startTime - Date.now(), 0),
      );
      timers.startTimer = startTimer;
    }

    roomServerOnlyData.playerData[userId] = GetRandomWord();
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

  socket.on("guess", (payload) => {
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
      player.revealed_letters = result.fullMatches;
      player.partialMatches = [
        ...new Set([
          ...(player.partialMatches ?? []),
          ...result.partialMatches,
        ]),
      ];
      player.partialMatches = [
        ...new Set([...(player.noMatch ?? []), ...result.noMatch]),
      ];
    }

    emitLobbyUpdate(roomId, game);
  });
});
