import type { ExtendedError, Namespace, Server, Socket } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import logger from "../utils/logger.js";
import { resolveDisplayName, resolveIsAnonymous } from "./anonymous.js";

/**
 * Shape of the per-connection data the auth middleware populates on
 * `socket.data`. Declared here (rather than via Socket.IO generics) to keep the
 * change additive — handlers already read these fields off the default `any`
 * data bag. `isAnonymous` is the guest flag added by the anonymous-sign-in
 * feature (R4.1–R4.4); it carries a `guest`/`anon`-adjacent name so the whole
 * feature stays greppable and removable in one pass (R9).
 */
export type SocketData = {
  userId: string;
  name: string;
  isAnonymous: boolean;
  roomId?: string;
};

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
 * Supabase-backed authentication middleware. On success it populates
 * `socket.data.userId`, `socket.data.name`, and `socket.data.isAnonymous`;
 * otherwise it rejects the connection before any handler runs.
 *
 * Exported so it can be installed on any Socket.IO server or namespace via
 * `installSocketAuth` (or directly via `.use(...)`).
 */
export const supabaseAuthMiddleware = async (
  socket: Socket,
  next: (err?: ExtendedError) => void,
) => {
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

  // Populate per-connection data straight off the already-resolved `user`
  // from the single `getUser(accessToken)` call above — no extra DB/network
  // round-trip (R4.1).
  const data = socket.data as SocketData;
  data.userId = user.id;
  data.name = resolveDisplayName(user); // R3.2, R3.3
  data.isAnonymous = resolveIsAnonymous(user); // R4.1–R4.4

  next();
};

/**
 * Installs the Supabase-backed authentication middleware on a Socket.IO
 * server (default namespace) or on a specific namespace such as
 * `io.of("/race")`. On success it populates `socket.data.userId`,
 * `socket.data.name`, and `socket.data.isAnonymous`.
 */
export const installSocketAuth = (target: Server | Namespace) => {
  target.use(supabaseAuthMiddleware);
};
