import type { Server } from "socket.io";
import type { GameModule } from "./types.js";
import battleRoyale from "./battle-royale/index.js";
import logger from "../utils/logger.js";

/**
 * The list of games the server hosts. Add a new game's `GameModule` here to
 * register it at startup.
 */
export const gameModules: GameModule[] = [battleRoyale];

/** Registers every game module against the shared Socket.IO server. */
export const registerGames = (io: Server) => {
  for (const game of gameModules) {
    game.register(io);
    logger.info({ gameId: game.id }, "Registered game module");
  }
};
