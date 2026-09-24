import type { Server } from "socket.io";
import type { Game } from "types/battle-royale.types.js";
import { GAME_UPDATE_DELAY, serverOnlyData } from "./state.js";

/** Immediately broadcasts the current lobby/game state to a room. */
export const emitLobbyUpdate = (io: Server, roomId: string, game: Game) => {
  io.to(roomId).emit("lobby:update", {
    ...game,
    players: Object.fromEntries(game.players),
  });
};

/**
 * Coalesces lobby updates: schedules at most one broadcast per
 * `GAME_UPDATE_DELAY` window per room to avoid flooding clients.
 */
export const scheduleLobbyUpdate = (io: Server, roomId: string, game: Game) => {
  const roomServerOnlyData = serverOnlyData.get(roomId);

  if (!roomServerOnlyData) {
    return;
  }

  if (roomServerOnlyData.timers.updateTicker) {
    return;
  }

  roomServerOnlyData.timers.updateTicker = setTimeout(() => {
    roomServerOnlyData.timers.updateTicker = undefined;

    emitLobbyUpdate(io, roomId, game);
  }, GAME_UPDATE_DELAY);
};
