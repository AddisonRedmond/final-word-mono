import type { GameModule } from "../types.js";
import { registerBattleRoyaleHandlers } from "./handlers.js";

/**
 * Battle Royale game module.
 *
 * Owns its own state (see `state.ts`), socket handlers (`handlers.ts`), and
 * game logic (`logic/`). Registered with the server via `games/registry.ts`.
 */
const battleRoyale: GameModule = {
  id: "battle-royale",
  register: (io) => {
    registerBattleRoyaleHandlers(io);
  },
};

export default battleRoyale;
