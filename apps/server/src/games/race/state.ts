import type {
  RaceMatch,
  RacePlayerServerData,
} from "types/race.types.js";
import { RACE_CONFIG, type RaceConfig } from "shared/race.js";

/**
 * Per-room, per-lifecycle-phase timers owned by a single Race match. Every
 * timer a match can schedule lives here so `cleanupMatch` can clear all of
 * them before deleting room state, preventing orphaned callbacks from firing
 * on a deleted room (Req 9.4).
 */
export type RaceRoomTimers = {
  /** Countdown-to-start while the room is in the `lobby` phase (Req 3.4). */
  lobbyCountdown?: NodeJS.Timeout;
  /** Absolute round-timer expiry for the current round (Req 4.2). */
  roundTimer?: NodeJS.Timeout;
  /** Delay between rounds during the `intermission` phase. */
  intermissionTimer?: NodeJS.Timeout;
  /** Drives bot guess simulation while a round is in progress. */
  botTicker?: NodeJS.Timeout;
  /** Coalesced state-broadcast scheduler (Req 4.7, 10.1). */
  updateTicker?: NodeJS.Timeout;
};

/**
 * Server-only per-room secret state (never broadcast). Parallels Battle
 * Royale's `RoomServerData`, but Race is a solo race-to-qualify with
 * independent per-player words: the per-player secret holds ONLY the assigned
 * word and rate-gate bookkeeping — there is no attack queue or attack flags.
 */
export type RaceRoomServerData = {
  players: Record<string, RacePlayerServerData>;
  timers: RaceRoomTimers;
};

/**
 * Per-room, per-bot simulation state. Bots race independent per-player words
 * (no attack/targeting logic), so this holds only the assigned word, guess
 * pacing, and per-round counters needed to drive the bot ticker.
 */
export type RaceBotServerData = {
  word: string;
  level: 1 | 2 | 3 | 4 | 5;
  /** Timestamp of the bot's last simulated guess, for pacing. */
  guessTimeStamp?: number;
  /** Words the bot has correctly completed this round. */
  botCompletedWords: number;
  /** Guesses the bot has made this round. */
  botGuesses: number;
};

/** Map of roomId → botId (`bot0`, `bot1`, …) → bot simulation state. */
export type RaceServerBotData = Map<
  string,
  {
    [botId: string]: RaceBotServerData;
  }
>;

/**
 * In-memory state for all active Race matches, kept in one place so the
 * handlers, lobby broadcaster, guess logic, and bot ticker all share the same
 * references. Mirrors `battle-royale/state.ts`'s separation of display state
 * (`matches`) from server-only secrets (`serverOnlyData`, `serverOnlyBotData`).
 *
 * Real players are keyed by Supabase UUID; bots by `bot0`, `bot1`, … (same
 * convention as Battle Royale, so the existing UUID regex distinguishes them
 * for stats — Req 8.4).
 */
export const matches = new Map<string, RaceMatch>();
export const serverOnlyData = new Map<string, RaceRoomServerData>();
export const serverOnlyBotData: RaceServerBotData = new Map();

/**
 * Validated Race config loaded at module init. `RACE_CONFIG` is parsed by its
 * Zod schema in `shared/race.js`, so an invalid default throws on import
 * rather than shipping a broken config (Req 2.6). Re-exported here as the
 * module's single config reference.
 */
export const config: RaceConfig = RACE_CONFIG;
