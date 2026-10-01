import type { Namespace } from "socket.io";
import type { ClientRaceMatch, RaceMatch } from "types/race.types.js";
import { config, serverOnlyData } from "./state.js";

/**
 * Converts a server-side `RaceMatch` (whose `players` is a `Map`) into the
 * client-facing `ClientRaceMatch` (whose `players` is a plain `Record`) so it
 * can be JSON-serialized over Socket.IO.
 *
 * The payload carries only display-safe `RacePlayer` fields — Race is a solo
 * race-to-qualify with independent per-player words, so there are no
 * attack-related fields to strip or omit (the server-only assigned word and
 * rate-gate bookkeeping live in `serverOnlyData`, never in `RaceMatch`).
 */
export const serializeRaceMatch = (match: RaceMatch): ClientRaceMatch => ({
  room: match.room,
  players: Object.fromEntries(match.players),
});

/**
 * Immediately broadcasts the current match snapshot to every socket in the
 * lobby's room via `race:update` (Req 10.1, 10.2). Sends on the `/race`
 * namespace so Race events stay isolated from Battle Royale and Duels.
 */
export const emitRaceUpdate = (nsp: Namespace, match: RaceMatch) => {
  nsp.to(match.room.matchId).emit("race:update", serializeRaceMatch(match));
};

/**
 * Coalesces state broadcasts: schedules at most one `race:update` per
 * `config.updateWindowMs` window per lobby, so a burst of guesses/progress
 * during a round cannot flood clients (Req 4.7, 3.6). Follows Battle Royale's
 * trailing-edge approach — the first call arms the room's `updateTicker`,
 * subsequent calls within the window are dropped, and the timer fires a single
 * broadcast then clears itself.
 */
export const scheduleRaceUpdate = (nsp: Namespace, match: RaceMatch) => {
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);

  if (!roomServerOnlyData) {
    return;
  }

  if (roomServerOnlyData.timers.updateTicker) {
    return;
  }

  roomServerOnlyData.timers.updateTicker = setTimeout(() => {
    roomServerOnlyData.timers.updateTicker = undefined;

    emitRaceUpdate(nsp, match);
  }, config.updateWindowMs);
};

/**
 * Broadcasts updated lobby membership to every Player in the lobby when a
 * Player joins (Req 3.6). Membership changes are user-visible and low-frequency
 * (bounded by lobby size), so this broadcasts immediately rather than through
 * the coalescing window used for high-frequency round progress.
 */
export const broadcastLobbyMembership = (nsp: Namespace, match: RaceMatch) => {
  emitRaceUpdate(nsp, match);
};
