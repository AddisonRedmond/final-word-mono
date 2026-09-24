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
