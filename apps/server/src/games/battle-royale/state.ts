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
 * Delta-broadcast rollout switch (realtime-broadcast-scaling, Req 5.5).
 * OFF by default so Battle Royale emits full Trimmed_Snapshots exactly as
 * before; flipping it on enables keyframe/delta broadcasting. Mirrors Race's
 * `deltaBroadcastEnabled` so both modes share the keyframe/delta/resync model
 * behind one switch (Req 3.7). Kept as a flag so a diff/apply bug can be rolled
 * back in production without reverting the trim or the telemetry.
 */
export const DELTA_BROADCAST_ENABLED = true;

/**
 * Forced-keyframe cadence (realtime-broadcast-scaling, Req 3.6). When a room
 * has emitted this many deltas since its last keyframe, the next scheduled
 * broadcast is a keyframe instead of a delta, bounding how far a client can
 * drift from the Authoritative_State before a full rebase. Mirrors Race's
 * `keyframeIntervalTicks` (both modes share the cadence, Req 3.7). Only
 * consulted when `DELTA_BROADCAST_ENABLED` is on; with the flag off every
 * broadcast is already a full snapshot so the cadence is moot.
 */
export const KEYFRAME_INTERVAL_TICKS = 20;

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
