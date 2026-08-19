import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import "dotenv/config";
import { getOrCreateGame, GetRandomWord } from "../utils/game-utils.js";
import type { Game, ServerOnlyData } from "../../../packages/types/src/game.js";
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
    const player = game?.players.get(userId);
    if (!game || !player) {
      return;
    }

    player.isEliminated = true;
    io.to(roomId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });
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

    game.players.delete(userId);

    const roomServerOnlyData = serverOnlyData.get(roomId);
    if (roomServerOnlyData) {
      delete roomServerOnlyData.playerData[userId];
      if (Object.keys(roomServerOnlyData.playerData).length === 0) {
        clearTimeout(roomServerOnlyData.gameTimers.startTimer);
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
    const game = getOrCreateGame(games, Max_Players);
    const roomId = game.room.lobbyId;
    let roomServerOnlyData = serverOnlyData.get(roomId);
    
    if (!roomServerOnlyData) {
      const startTimer = setTimeout(
        () => {
          const gameToStart = games.get(roomId);
          if (!gameToStart || gameToStart.room.isStarted) {
            return;
          }

          gameToStart.room.isStarted = true;
          io.to(roomId).emit("lobby:update", {
            ...gameToStart,
            players: Object.fromEntries(gameToStart.players),
          });
        },
        Math.max(game.room.startTime - Date.now(), 0),
      );

      roomServerOnlyData = {
        playerData: {},
        gameTimers: { startTimer },
      };
      serverOnlyData.set(roomId, roomServerOnlyData);
    }

    socket.data.roomId = roomId;
    game.players.set(userId, { userId, name, isEliminated: false });
    roomServerOnlyData.playerData[userId] = GetRandomWord();
    socket.join(roomId);

    if (game.players.size >= Max_Players) {
      clearTimeout(roomServerOnlyData.gameTimers.startTimer);
      game.room.isStarted = true;

      io.to(roomId).emit("lobby:update", {
        ...game,
        players: Object.fromEntries(game.players),
      });
    }

    socket.emit("join:ack", {
      ...game,
      players: Object.fromEntries(game.players),
    });
  });

  socket.on("guess", (payload) => {
    socket.emitWithAck("guess:ack", {
      userId: socket.data.userId,
    });
  });
});
