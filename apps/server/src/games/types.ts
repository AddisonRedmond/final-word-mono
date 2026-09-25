import type { Server, Socket } from "socket.io";

/**
 * The contract every game must implement.
 *
 * A game is a self-contained folder under `src/games/<name>` that exposes a
 * single `GameModule`. The server bootstrap registers each module and calls
 * `register` once with the shared Socket.IO server. The module is responsible
 * for wiring up its own connection/event handlers and owning its own state.
 *
 * To add a new game:
 *   1. Create `src/games/<your-game>/index.ts` that exports a `GameModule`.
 *   2. Add it to the array in `src/games/registry.ts`.
 */
export type GameModule = {
  /** Unique identifier for the game, e.g. "battle-royale". */
  id: string;
  /**
   * Called once at startup. Wire up connection listeners and any other
   * server-level setup the game needs here.
   */
  register: (io: Server) => void;
};

/** Convenience alias for a fully-authenticated socket. */
export type GameSocket = Socket;
