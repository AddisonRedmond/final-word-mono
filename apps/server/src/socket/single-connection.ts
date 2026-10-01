import type { ExtendedError, Server, Socket } from "socket.io";
import logger from "../utils/logger.js";

/**
 * Message surfaced to the client's `connect_error` handler when a user who is
 * already connected (in another tab or device) tries to open a second socket.
 */
export const ALREADY_CONNECTED_MESSAGE =
  "You already have an active game open in another client.";

/**
 * Tracks the live socket id for each authenticated user so a single user can
 * only hold one connection at a time. Keyed by `socket.data.userId`.
 */
const activeSocketByUser = new Map<string, string>();

/**
 * Enforces a single active socket per authenticated user.
 *
 * Must be installed AFTER the auth middleware so `socket.data.userId` is
 * populated. The middleware rejects any connection from a user who already has
 * a live socket; the thrown error's message is delivered to the client's
 * `connect_error` listener. A `connection`/`disconnect` listener keeps the
 * registry in sync so a user can reconnect once their previous socket closes.
 */
export const installSingleConnection = (io: Server) => {
  io.use((socket: Socket, next: (err?: ExtendedError) => void) => {
    const userId = socket.data.userId as string | undefined;

    if (!userId) {
      // Auth middleware should have populated this; fail closed if it didn't.
      next(new Error("Unauthorized: missing user identity"));
      return;
    }

    if (activeSocketByUser.has(userId)) {
      logger.warn(
        { userId, socketId: socket.id },
        "Rejected duplicate socket connection for user",
      );
      next(new Error(ALREADY_CONNECTED_MESSAGE));
      return;
    }

    activeSocketByUser.set(userId, socket.id);
    next();
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string | undefined;

    socket.on("disconnect", () => {
      if (!userId) {
        return;
      }

      // Only clear the slot if this socket is the one we recorded, so a stale
      // disconnect can't free a slot a newer connection legitimately owns.
      if (activeSocketByUser.get(userId) === socket.id) {
        activeSocketByUser.delete(userId);
      }
    });
  });
};
