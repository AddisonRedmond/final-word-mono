import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import "dotenv/config";
import { getOrCreateGame, GetRandomWord } from "../utils/game-utils.js";
import type {
  Game,
  ServerPlayerMap,
} from "../../../packages/types/src/game.js";
const app = new Hono();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const Max_Players = 50;
const Max_Wait_Time = 45; //Seconds

const games = new Map<string, Game>();
const serverOnlyData: ServerPlayerMap = new Map();

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
  console.log(`New Socket.IO connection for user ${socket.data.userId}`);

  socket.on("join", () => {
    const { userId, name } = socket.data;
    const game = getOrCreateGame(games, Max_Players);
    const roomId = game.room.lobbyId;

    socket.data.roomId = roomId;
    game.players.set(userId, { userId, name });
    serverOnlyData.set(roomId, { [userId]: GetRandomWord() });
    socket.join(roomId);

    socket.emit("join:ack", {
      game: {
        ...game,
        players: Object.fromEntries(game.players),
      },
    });
  });

  socket.on("guess", (payload) => {
    socket.emitWithAck("guess:ack", {
      userId: socket.data.userId,
    });
  });
});
