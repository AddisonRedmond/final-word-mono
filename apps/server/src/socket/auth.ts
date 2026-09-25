import type { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import logger from "../utils/logger.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/**
 * Installs the Supabase-backed authentication middleware on the Socket.IO
 * server. On success it populates `socket.data.userId` and `socket.data.name`.
 */
export const installSocketAuth = (io: Server) => {
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
};
