import type { Server } from "socket.io";

/**
 * Installs a `time:sync` handler so clients can measure the offset between
 * their local clock and the server's clock.
 *
 * The client sends its own timestamp and provides an ack callback; we reply
 * with the server's epoch time. The client uses the round-trip to estimate
 * `serverNow - clientNow` and correct every absolute server timestamp
 * (game start time, player life, match end) it renders. Without this, a
 * server whose clock is skewed by N seconds makes every countdown wrong by N.
 */
export const installTimeSync = (io: Server) => {
  io.on("connection", (socket) => {
    socket.on(
      "time:sync",
      (
        _clientSentAt: number,
        ack?: (response: { serverNow: number }) => void,
      ) => {
        ack?.({ serverNow: Date.now() });
      },
    );
  });
};
