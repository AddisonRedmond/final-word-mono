import { RACE_CONFIG, raceConfigSchema } from "shared/race.js";
import type { GameModule } from "../types.js";
import { installSocketAuth } from "../../socket/auth.js";
import logger from "../../utils/logger.js";
import { registerRaceHandlers } from "./handlers.js";

/**
 * Round-based Elimination Race game module.
 *
 * Registered with the server via `games/registry.ts`. On registration it:
 *   1. Re-validates `RACE_CONFIG` defensively. `RACE_CONFIG` is already parsed
 *      at import time, but per Req 2.7 the server must log a descriptive error
 *      and refuse to register Race_Mode if the config fails validation — so we
 *      re-check here and bail out without attaching any handlers on failure.
 *   2. Installs the shared Supabase auth middleware on the `/race` namespace so
 *      unauthenticated sockets are rejected before any handler runs (Req 1.4).
 *   3. Attaches Race connection/event handlers on the `/race` namespace, which
 *      keeps Race events and state isolated from Battle Royale and Duels
 *      (Req 1.3).
 */
const race: GameModule = {
  id: "round-based-elimination-race",
  register: (io) => {
    const result = raceConfigSchema.safeParse(RACE_CONFIG);

    if (!result.success) {
      logger.error(
        { issues: result.error.issues },
        "Race_Config failed schema validation; refusing to register Race_Mode",
      );
      return;
    }

    const nsp = io.of("/race");
    installSocketAuth(nsp);
    registerRaceHandlers(nsp);
  },
};

export default race;
