import type {
  Game,
  ServerOnlyData,
  ServerBotData,
} from "types/battle-royale.types.js";

/** Maximum number of players (humans + bots) allowed in a single lobby. */
export const MAX_PLAYERS = 99;

/** Debounce window (ms) for coalescing lobby state broadcasts. */
export const GAME_UPDATE_DELAY = 250;

/**
 * In-memory state for all active battle-royale games. Kept in one place so the
 * handlers, lobby broadcaster, and guess logic all share the same references.
 */
export const games = new Map<string, Game>();
export const serverOnlyData: ServerOnlyData = new Map();
export const serverOnlyBotData: ServerBotData = new Map();

/**
 * Maps a short, human-friendly share code to the `lobbyId` of the room it
 * belongs to (v1 play-with-friends). A friend who enters a code is resolved
 * through this map to the specific room, bypassing the open-lobby scan. Entries
 * are added when a room is created and removed in `cleanupGame`, so a code never
 * outlives its room.
 */
export const shareCodes = new Map<string, string>();
