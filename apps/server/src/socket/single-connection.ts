import type { ExtendedError, Namespace, Server, Socket } from "socket.io";
import logger from "../utils/logger.js";

/**
 * Message surfaced to the client's `connect_error` handler when a user who is
 * already connected (in another tab or device) tries to open a second socket.
 */
export const ALREADY_CONNECTED_MESSAGE =
  "You already have an active game open in another client.";

/**
 * Tracks the live socket for each authenticated user so a single user can only
 * hold ONE connection at a time — across EVERY namespace, not just one.
 *
 * The games live on separate Socket.IO namespaces (Battle Royale on the default
 * `/`, Race on `/race`), and Socket.IO middleware/connection events are
 * per-namespace. So the guard must be installed on each namespace, all sharing
 * this one module-level registry; otherwise a user could hold a `/` socket and
 * a `/race` socket at the same time (the cross-mode bug this prevents). We store
 * the Socket reference (not just its id) so a colliding connection can inspect
 * whether the previous socket is still live.
 */
const activeSocketByUser = new Map<string, Socket>();

/**
 * Enforces a single active socket per authenticated user, spanning all
 * namespaces it is installed on.
 *
 * Install on each namespace AFTER its auth middleware so `socket.data.userId`
 * is populated (default namespace in `index.ts`, `/race` in the Race module).
 *
 * Collision handling: if the user already has a RECORDED socket, we check
 * whether it is still connected.
 *   - Still connected  -> a genuine second tab/device: reject the new socket
 *     (the message reaches the client's `connect_error` listener).
 *   - Already gone      -> the common page-refresh case, where the browser opens
 *     the new socket before the old one's `disconnect` has reached the server.
 *     We take over the slot and admit the new socket, so a refresh (including a
 *     refresh into the OTHER game mode) reconnects cleanly instead of hitting a
 *     false "already connected" rejection.
 */
export const installSingleConnection = (target: Server | Namespace) => {
  target.use((socket: Socket, next: (err?: ExtendedError) => void) => {
    const userId = socket.data.userId as string | undefined;

    if (!userId) {
      // Auth middleware should have populated this; fail closed if it didn't.
      next(new Error("Unauthorized: missing user identity"));
      return;
    }

    const existing = activeSocketByUser.get(userId);

    if (existing && existing.connected && existing.id !== socket.id) {
      logger.warn(
        { userId, socketId: socket.id, existingSocketId: existing.id },
        "Rejected duplicate socket connection for user",
      );
      next(new Error(ALREADY_CONNECTED_MESSAGE));
      return;
    }

    // No live prior socket (or it is the refresh case where the old one is
    // already closing): take over the slot.
    activeSocketByUser.set(userId, socket);
    next();
  });

  target.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string | undefined;

    socket.on("disconnect", () => {
      if (!userId) {
        return;
      }

      // Only clear the slot if this socket is the one we recorded, so a stale
      // disconnect can't free a slot a newer connection legitimately owns.
      if (activeSocketByUser.get(userId)?.id === socket.id) {
        activeSocketByUser.delete(userId);
      }
    });
  });
};

/**
 * Test-only: clears the cross-namespace registry so each test starts clean.
 */
export const __resetActiveSocketsForTest = () => {
  activeSocketByUser.clear();
};
