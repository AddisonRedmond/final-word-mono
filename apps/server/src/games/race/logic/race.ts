import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import { eliminationCount, type RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import logger from "../../../utils/logger.js";
import {
  matches as globalMatches,
  serverOnlyBotData as globalServerOnlyBotData,
  serverOnlyData as globalServerOnlyData,
  shareCodes,
} from "../state.js";
import type {
  RaceBotServerData,
  RaceServerBotData,
  RaceRoomServerData,
} from "../state.js";
import { emitRaceUpdate } from "../lobby.js";
import { persistEliminatedAsLoss, persistRaceStats } from "../stats.js";
import { fillLobbyWithBots, startBotTicker } from "./bots.js";
import {
  assignWord,
  type RankedSurvivor,
  rankSurvivors,
  resolveFinalRound,
  selectEliminated,
} from "./round.js";

// Impure Race_Mode match lifecycle. This file owns lobby selection/creation and
// matchmaking lookup (used when a Player joins) plus match start with the lobby
// countdown and start conditions (task 7.4). The remaining lifecycle
// (beginRound/endRound/finishMatch/cleanupMatch) is implemented in later tasks
// (7.5, 7.8, 7.10) — `startMatch` accepts `beginRound` through its `deps` seam
// so it can hand off round setup without importing it here.
//
// Mirrors `battle-royale/logic/battle-royale.ts`'s `getOrCreateGame` /
// `findGameForUser` structure ONLY. Race is a solo race-to-qualify with
// independent per-player words: there is NO attack/targeting logic here (no
// applyAttack, determineTarget, attack queues, or attack-word bonuses).

/**
 * Find an open Lobby for a newly joining Player, creating one if none
 * qualifies.
 *
 * A Lobby qualifies only when it is still in the `lobby` phase AND holds fewer
 * than `maxLobbySize` Players (Req 3.1, 3.7). A Match that has started (phase
 * `round`, `intermission`, or `finished`) is never returned, so a new joiner
 * can never be dropped into a game already underway (Property 13). When no
 * Lobby qualifies a fresh one is created and inserted into `matches` (Req 3.2).
 *
 * The freshly created Match starts in the `lobby` phase with an empty players
 * Map, `currentRoundIndex` 0, `isDraw` false, and a `lobbyDeadline` set to
 * `now + config.lobbyCountdownMs` (the countdown-to-start, Req 3.4). The caller
 * is responsible for adding the joining Player and scheduling the lobby timer.
 *
 * _Requirements: 3.1, 3.2, 3.7_
 */
// Share-code alphabet: no 0/O/1/I/L so a code is unambiguous when read aloud or
// typed. Formatted XXX-XXX. Mirrors Battle Royale's share-code scheme so both
// modes read and behave identically.
const SHARE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHARE_CODE_LENGTH = 6;

const randomShareCode = (): string => {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * SHARE_CODE_ALPHABET.length);
    code += SHARE_CODE_ALPHABET[idx];
    if (i === 2) {
      code += "-";
    }
  }
  return code;
};

/**
 * Mint a collision-checked share code and register it against `matchId`.
 * Returns undefined if a unique code couldn't be found after a bounded number
 * of retries, so a code is never silently reused for two matches.
 */
export const generateShareCode = (matchId: string): string | undefined => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomShareCode();
    if (!shareCodes.has(code)) {
      shareCodes.set(code, matchId);
      return code;
    }
  }
  logger.warn(
    { matchId },
    "Could not generate a unique race share code after retries",
  );
  return undefined;
};

/**
 * Resolve a user-entered share code to the match it belongs to, or undefined if
 * the code is unknown or its match is gone. Case-insensitive; trims whitespace.
 * Returns the live RaceMatch so the caller can check joinability (phase lobby,
 * has capacity).
 */
export const resolveShareCode = (
  matches: Map<string, RaceMatch>,
  code: string,
): RaceMatch | undefined => {
  const normalized = code.trim().toUpperCase();
  const matchId = shareCodes.get(normalized);
  if (!matchId) {
    return undefined;
  }
  return matches.get(matchId);
};

export const getOrCreateLobby = (
  matches: Map<string, RaceMatch>,
  config: RaceConfig,
): RaceMatch => {
  for (const match of matches.values()) {
    if (
      match.room.phase === "lobby" &&
      match.players.size < config.maxLobbySize
    ) {
      return match;
    }
  }

  const matchId = randomUUID();
  const now = Date.now();
  const match: RaceMatch = {
    room: {
      matchId,
      shareCode: generateShareCode(matchId),
      phase: "lobby",
      createdAt: now,
      lobbyDeadline: now + config.lobbyCountdownMs,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players: new Map(),
  };

  matches.set(matchId, match);
  logger.info(
    { matchId, shareCode: match.room.shareCode, lobbyDeadline: match.room.lobbyDeadline },
    "Created race lobby",
  );
  return match;
};

/**
 * Return the Match containing `userId` in its players, or `undefined` if the
 * Player is not in any Match. Used to reconnect a Player to their in-progress
 * Match (Req 9.2) and to guard against a Player joining a second Lobby.
 *
 * Mirrors `findGameForUser` in `battle-royale/logic/battle-royale.ts`.
 */
export const findMatchForUser = (
  matches: Map<string, RaceMatch>,
  userId: string,
): RaceMatch | undefined =>
  Array.from(matches.values()).find((match) => match.players.has(userId));

// Re-export the bot-fill helper so lifecycle callers can bring a short lobby up
// to the minimum from a single lifecycle import surface, matching how Battle
// Royale keeps bot helpers reachable from the lifecycle module. (`startMatch`
// below imports it directly for the countdown-zero bot-fill branch.)
export { fillLobbyWithBots } from "./bots.js";

// UUID shape for real (Supabase-authenticated) players. Bots are keyed
// `bot0`, `bot1`, … so anything that is not a UUID is a bot — the same
// detection `stats.ts` uses to exclude bots from persistence (Req 8.4). Only
// real players count against the Daily_Game_Counter (Req 11.1).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRealPlayer = (playerId: string): boolean => UUID_RE.test(playerId);

/**
 * Dependency-injection seam for `startMatch`. Isolating the side effects here
 * lets tests stub the daily-limit calls and the round hand-off without wiring a
 * real namespace, DB, or timers, and keeps `startMatch` decoupled from
 * lifecycle pieces that land in later tasks.
 *
 * - `canStartMatch` / `recordMatchStart` are the Daily_Game_Counter seam
 *   (`daily-limit.ts`). During beta `canStartMatch` always permits and
 *   `recordMatchStart` is a no-op, so the mode is unlimited (Req 11.2); when
 *   Feature 1 ships only that module changes (Req 11.4).
 * - `beginRound` is the round-setup hand-off implemented in task 7.5. It is
 *   injected rather than imported so this task does not depend on 7.5; it MUST
 *   set the room into the `round` phase and start round 0. When it is omitted
 *   (e.g. a start-conditions test that only asserts the seam and phase), a
 *   built-in fallback advances the room to `round`/round 0 so start behavior is
 *   observable without the real round loop.
 * - `fillLobbyWithBots` is injectable for tests; it defaults to the real
 *   bot-fill so callers normally pass only the daily-limit + `beginRound` seam.
 */
export type StartMatchDeps = {
  canStartMatch: (userId: string) => Promise<boolean>;
  recordMatchStart: (userId: string) => Promise<void>;
  beginRound?: (
    match: RaceMatch,
    nsp: Namespace,
    config: RaceConfig,
    roundIndex: number,
  ) => void;
  fillLobbyWithBots?: typeof fillLobbyWithBots;
};

/** Per-room bot simulation record, keyed `bot0`/`bot1`/… → server-only state. */
type RoomBotData = { [botId: string]: RaceBotServerData };

/**
 * Start a Match from its Lobby, applying the daily-limit seam per real Player
 * and handing off to the first Round.
 *
 * Guards against double-starting: a Match already past the `lobby` phase is
 * left untouched, so both the max-size path and a countdown that fires after an
 * immediate start are idempotent.
 *
 * Daily-limit seam (Req 11.1): every real (UUID-keyed) Player is checked with
 * `canStartMatch` and recorded with `recordMatchStart`. Bots are skipped — they
 * never count against the counter (Req 8.4). Because the beta `canStartMatch`
 * always permits, the mode stays unlimited (Req 11.2); the checks run per
 * Player through the single seam so enabling enforcement needs no Match/Round
 * change (Req 11.4). The recorded/checked ids come from the field captured
 * before start.
 *
 * Start conditions — the caller decides which branch applies:
 *   - Max size (Req 3.3): `startMatch` is invoked immediately when the Lobby
 *     reaches `maxLobbySize`.
 *   - Countdown zero at/above minimum (Req 3.4): `scheduleLobbyStart` fires the
 *     countdown at `lobbyDeadline`; when the Lobby holds `>= minLobbySize`
 *     Players it starts as-is.
 *   - Countdown zero below minimum (Req 3.5): the countdown callback first
 *     fills the Lobby with Bots up to `minLobbySize`, then starts.
 * `startMatch` itself no longer needs to add Bots — by the time it runs the
 * field is already at the size the start condition requires — but it defends
 * the countdown-zero path by topping up to `minLobbySize` if still short.
 *
 * On start it clears the Lobby countdown timer (it has served its purpose or is
 * being pre-empted by the max-size path) and hands off to `beginRound` (or the
 * built-in fallback), which owns setting `phase = "round"` and starting round 0.
 *
 * `roomServerOnlyData` carries the room's timers (so the countdown can be
 * cleared) and `botData` is the room's bot record used by the defensive
 * bot-fill; both are optional so a start-conditions test can invoke `startMatch`
 * with only the seam and assert the phase/daily-limit behavior.
 *
 * _Requirements: 3.3, 3.4, 3.5, 11.1_
 */
export const startMatch = async (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  deps: StartMatchDeps,
  roomServerOnlyData?: RaceRoomServerData,
  botData: RoomBotData = {},
): Promise<void> => {
  if (match.room.phase !== "lobby") {
    logger.warn(
      { matchId: match.room.matchId, phase: match.room.phase },
      "Match start ignored: match already started",
    );
    return;
  }

  // Clear the lobby countdown so a scheduled countdown can't fire a second
  // start after the max-size path has already begun (Req 3.3 vs 3.4/3.5).
  if (roomServerOnlyData?.timers.lobbyCountdown) {
    clearTimeout(roomServerOnlyData.timers.lobbyCountdown);
    roomServerOnlyData.timers.lobbyCountdown = undefined;
  }

  // Defensive bot-fill: the countdown-zero-below-minimum path (Req 3.5) fills
  // before calling here, but if we were reached with a short field, top up so a
  // Match never starts under `minLobbySize`. No-op when already at/above it.
  if (match.players.size < config.minLobbySize) {
    const fill = deps.fillLobbyWithBots ?? fillLobbyWithBots;
    fill(match.players, botData, config);
  }

  // Snapshot the real players present at start, then run the daily-limit seam
  // for each one (Req 11.1). We record every real player; `canStartMatch` is
  // consulted through the same seam so enforcement can later block without a
  // Match/Round change (Req 11.3, 11.4). Beta impls always permit / no-op.
  const realPlayerIds = Array.from(match.players.keys()).filter(isRealPlayer);
  for (const userId of realPlayerIds) {
    await deps.canStartMatch(userId);
    await deps.recordMatchStart(userId);
  }

  logger.info(
    { matchId: match.room.matchId, playerCount: match.players.size },
    "Starting race match",
  );

  // Hand off to the round loop. `beginRound` owns setting `phase = "round"`,
  // assigning words, and arming the round timer for round 0. It is injected
  // through `deps` so start-conditions tests can stub it; when omitted the real
  // `beginRound` runs, wiring the room's server-only data for word assignment
  // and the round timer.
  const begin = deps.beginRound ?? beginRound;
  begin(match, nsp, config, 0);
};

/**
 * Arm the Lobby countdown for a Match when the first Player joins its Lobby.
 *
 * Schedules a single timer that fires at `lobbyDeadline` (`config.lobbyCountdownMs`
 * from lobby creation). On fire it evaluates the countdown-zero start
 * conditions: if the Lobby holds `>= minLobbySize` Players it starts as-is
 * (Req 3.4); otherwise it fills with Bots up to `minLobbySize` first (Req 3.5),
 * then starts. The handle is stored on the room's `lobbyCountdown` timer so
 * `startMatch` (max-size pre-empt) and `cleanupMatch` (later task) can clear it.
 *
 * Idempotent: if a countdown is already armed, or the Match has left the
 * `lobby` phase, this is a no-op — so calling it on every join only arms it
 * once.
 *
 * `botData` is the room's bot record; on countdown zero it is passed to
 * `fillLobbyWithBots` when the field is short of `minLobbySize` (Req 3.5).
 *
 * _Requirements: 3.4, 3.5_
 */
export const scheduleLobbyStart = (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  deps: StartMatchDeps,
  roomServerOnlyData: RaceRoomServerData,
  botData: RoomBotData = {},
): void => {
  if (match.room.phase !== "lobby") {
    return;
  }
  if (roomServerOnlyData.timers.lobbyCountdown) {
    return;
  }

  const delay = Math.max(0, match.room.lobbyDeadline - Date.now());

  roomServerOnlyData.timers.lobbyCountdown = setTimeout(() => {
    roomServerOnlyData.timers.lobbyCountdown = undefined;

    // Re-check the phase inside the callback: a max-size start (Req 3.3) may
    // have started the Match before the countdown fired.
    if (match.room.phase !== "lobby") {
      return;
    }

    if (match.players.size < config.minLobbySize) {
      const fill = deps.fillLobbyWithBots ?? fillLobbyWithBots;
      fill(match.players, botData, config);
    }

    void startMatch(match, nsp, config, deps, roomServerOnlyData, botData);
  }, delay);
};

// ---------------------------------------------------------------------------
// Round lifecycle: beginRound / endRound (task 7.5)
// ---------------------------------------------------------------------------

/**
 * Dependency-injection seam for the round lifecycle. Isolating side effects
 * here lets tests drive `beginRound`/`endRound` deterministically without a
 * real namespace, timers, or the later finish/cleanup implementation.
 *
 * - `serverOnlyData` supplies the per-room server-only record: the per-player
 *   assigned words (updated on round begin) and the room's timers (the round
 *   timer is stored on `timers.roundTimer`). Defaults to the module's global
 *   `serverOnlyData` map so live callers pass nothing.
 * - `botData` is the room's bot simulation record (`bot0`/`bot1`/… →
 *   `RaceBotServerData`), so bot words are reseeded at the round's length on
 *   begin, mirroring the reset applied to real players. Defaults to `{}`.
 * - `finishMatch` is the finish hand-off. When omitted, `endRound` calls the
 *   real `finishMatch` in this module (task 7.8), which records the result on
 *   the room (`phase = "finished"`, `winnerId`/`isDraw`, placements), broadcasts
 *   `match:result`, persists stats, and cleans up. It is still injectable so a
 *   test can observe `endRound`'s branching in isolation with a stub. `winnerId`
 *   is undefined for a draw.
 * - the finish-side seams (`persistRaceStats`, `cleanupMatch`, `now`) are also
 *   read from `deps` by the real `finishMatch` when `endRound` delegates to it,
 *   so a single `RoundLifecycleDeps` object configures the whole tail of the
 *   lifecycle. See `finishMatch`.
 * - `now` is injectable for deterministic timing in tests; defaults to
 *   `Date.now`.
 * - `assignWord` is injectable so tests can make word assignment deterministic;
 *   defaults to the pure `assignWord` from `round.ts`.
 */
export type RoundLifecycleDeps = {
  serverOnlyData?: Map<string, RaceRoomServerData>;
  botData?: { [botId: string]: RaceBotServerData };
  finishMatch?: (
    match: RaceMatch,
    nsp: Namespace,
    config: RaceConfig,
    winnerId: string | undefined,
  ) => void;
  now?: () => number;
  assignWord?: (length: number) => string;
  /**
   * Stats persistence hand-off used by the real `finishMatch` (fire-and-forget,
   * Req 6.6/8.8). Defaults to the module's `persistRaceStats`; injectable so a
   * finish test can assert it was called without touching the DB.
   */
  persistRaceStats?: (match: RaceMatch) => Promise<void>;
  /**
   * Match teardown hand-off invoked by `finishMatch` after broadcasting the
   * result (clears timers + deletes room state). It is implemented in task 7.10
   * (`cleanupMatch`) and injected here so finishing does not depend on 7.10; when
   * omitted, `finishMatch` finishes/broadcasts/persists and leaves teardown to
   * the caller (the wiring task 7.10/13.x supplies the real cleanup). It receives
   * the match id so it can look up and clear the room's timers and state.
   */
  cleanupMatch?: (matchId: string) => void;
};

/** Whether `roundIndex` selects the Match's Final_Round (the last config round). */
const isFinalRound = (config: RaceConfig, roundIndex: number): boolean =>
  roundIndex >= config.rounds.length - 1;

/**
 * Begin a Round: assign every Survivor a fresh word of the Round's configured
 * length, reset their per-round progress, arm the Round timer, and broadcast.
 *
 * Sets `room.currentRoundIndex = roundIndex`, `room.phase = "round"`, and
 * `room.roundEndsAt = now + config.rounds[roundIndex].timerMs` (Req 4.2). For
 * each non-eliminated Player the per-round fields are reset (`completedWords`
 * 0, `qualified` false, `qualifiedAt` cleared, `roundGuesses` 0) and a new word
 * of `config.rounds[roundIndex].wordLength` is assigned into that Player's
 * server-only `word` (Req 4.1). Bots are reseeded the same way: a fresh word of
 * the Round's length and their per-round counters cleared.
 *
 * The Round timer is stored on the room's `timers.roundTimer` so `endRound`
 * fires on expiry and `cleanupMatch` (later task) can clear it. Eliminated
 * Players are skipped entirely — they hold no word and take no further part.
 *
 * `deps` supplies the server-only data source, bot record, and injectable
 * timing/word helpers (see `RoundLifecycleDeps`).
 *
 * _Requirements: 4.1, 4.2, 5.1_
 */
export const beginRound = (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  roundIndex: number,
  deps: RoundLifecycleDeps = {},
): void => {
  const round = config.rounds[roundIndex];
  if (!round) {
    logger.error(
      { matchId: match.room.matchId, roundIndex, rounds: config.rounds.length },
      "beginRound ignored: round index out of range",
    );
    return;
  }

  const serverOnlyData = deps.serverOnlyData ?? globalServerOnlyData;
  const now = (deps.now ?? Date.now)();
  const draw = deps.assignWord ?? assignWord;
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  // The room's bot simulation record. Prefer an explicitly injected record
  // (tests), otherwise the live per-room record from the global map — this is
  // where fillLobbyWithBots stored the bots, so at runtime the ticker below
  // actually has bots to drive (Req 3.5).
  const botData =
    deps.botData ?? globalServerOnlyBotData.get(match.room.matchId) ?? {};

  match.room.currentRoundIndex = roundIndex;
  match.room.phase = "round";
  match.room.roundEndsAt = now + round.timerMs;
  // Clear the intermission's next-round timestamp now that the round has begun.
  match.room.nextRoundStartsAt = undefined;

  // Reset per-round state and assign a fresh word to every survivor. Eliminated
  // players are skipped — they take no further part in the match.
  for (const [playerId, player] of match.players) {
    if (player.isEliminated) {
      continue;
    }

    player.completedWords = 0;
    player.qualified = false;
    player.qualifiedAt = undefined;
    player.roundGuesses = 0;
    player.lastFeedback = undefined;

    const word = draw(round.wordLength);

    // Store the assigned word in the player's server-only record, or the bot's
    // simulation record — bots don't have a server-only player entry.
    if (roomServerOnlyData?.players[playerId]) {
      roomServerOnlyData.players[playerId].word = word;
      // Fresh word for the new round: clear the accumulated keyboard hints so
      // the board/keyboard start clean (no stale green/yellow carried over).
      roomServerOnlyData.players[playerId].revealedLetters = {};
      roomServerOnlyData.players[playerId].partialMatches = [];
      roomServerOnlyData.players[playerId].noMatch = [];
    } else if (botData[playerId]) {
      botData[playerId].word = word;
      botData[playerId].botCompletedWords = 0;
      botData[playerId].botGuesses = 0;
      botData[playerId].guessTimeStamp = undefined;
    }
  }

  // Arm the round timer so endRound fires when the round's time expires, and
  // (re)start the bot ticker so bots race their own words for this round.
  if (roomServerOnlyData) {
    if (roomServerOnlyData.timers.roundTimer) {
      clearTimeout(roomServerOnlyData.timers.roundTimer);
    }
    roomServerOnlyData.timers.roundTimer = setTimeout(() => {
      roomServerOnlyData.timers.roundTimer = undefined;
      endRound(match, nsp, config, deps);
    }, round.timerMs);

    // Drive bot guessing for this round. Any ticker from a previous round is
    // cleared first so bots always race the CURRENT round's word length. When
    // a bot completes a word, mirror that progress onto its display player
    // (completedWords/roundGuesses + qualification latch) exactly like a real
    // guess does via applyGuess, then coalesce a broadcast so the field's
    // progress bars advance. Skipping the ticker entirely when the room has no
    // bots keeps a purely-human match free of an idle interval.
    if (roomServerOnlyData.timers.botTicker) {
      clearInterval(roomServerOnlyData.timers.botTicker);
      roomServerOnlyData.timers.botTicker = undefined;
    }
    if (Object.keys(botData).length > 0) {
      roomServerOnlyData.timers.botTicker = startBotTicker(
        botData,
        () => config.rounds[match.room.currentRoundIndex]?.wordLength ?? 5,
        (botId) => {
          // Ignore progress from an ELIMINATED bot. Eliminated bots are never
          // removed from `botData` and their per-round pacing is not reset on a
          // new round (the reset loop above skips eliminated players), so a
          // stale `guessTimeStamp` would otherwise let an eliminated bot "guess"
          // on the first tick of a later round — on the FINAL round that falsely
          // declared an already-eliminated bot the winner the instant the round
          // began. An eliminated bot takes no further part in the match.
          const botPlayer = match.players.get(botId);
          if (!botPlayer || botPlayer.isEliminated) {
            return;
          }

          // On the FINAL round the first completed word wins outright (Req 6.1,
          // 6.2) — a bot that finishes its word wins immediately, exactly like a
          // human's first-correct-guess win. `finishMatch` is idempotent, so a
          // later completion is a no-op.
          if (isFinalRound(config, match.room.currentRoundIndex)) {
            handleFinalRoundWin(match, nsp, config, botId, deps);
            return;
          }

          mirrorBotProgress(
            match,
            botId,
            round.qualifyingCount,
            round.wordLength,
            nsp,
          );
          // A bot qualifying may fill the last advancing spot — end early if so.
          checkEarlyRoundEnd(match, nsp, config, deps);
        },
        deps.now,
      );
    }
  }

  logger.info(
    {
      matchId: match.room.matchId,
      roundIndex,
      wordLength: round.wordLength,
      qualifyingCount: round.qualifyingCount,
      survivors: Array.from(match.players.values()).filter(
        (p) => !p.isEliminated,
      ).length,
    },
    "Race round begun",
  );

  emitRaceUpdate(nsp, match);
};

/**
 * Mirror a bot's completed word (from the bot ticker) onto its DISPLAY player,
 * so the rest of the field sees bot progress the same way a real guess updates
 * a human's display state via `applyGuess`.
 *
 * A bot that is eliminated or already at/over the Qualifying_Count makes no
 * further progress. Otherwise its per-round `completedWords`/`roundGuesses` and
 * its match aggregates (`correctGuesses`, plus `correctLetters` += the word
 * length, since completing a word means every letter was correct, and
 * `totalGuesses`) advance so bots are ranked on the same
 * (correctGuesses, correctLetters, totalGuesses) keys as humans. When
 * `completedWords` first reaches the Qualifying_Count the `qualified` latch is
 * set once with a `qualifiedAt` timestamp. A coalesced `race:update` is
 * scheduled so the field's progress bars advance without a broadcast per bot.
 */
const mirrorBotProgress = (
  match: RaceMatch,
  botId: string,
  qualifyingCount: number,
  wordLength: number,
  nsp: Namespace,
): void => {
  const bot = match.players.get(botId);
  if (!bot || bot.isEliminated || bot.completedWords >= qualifyingCount) {
    return;
  }

  bot.completedWords += 1;
  bot.roundGuesses += 1;
  bot.totalGuesses += 1;
  bot.correctGuesses += 1;
  bot.correctLetters += wordLength;

  if (!bot.qualified && bot.completedWords >= qualifyingCount) {
    bot.qualified = true;
    bot.qualifiedAt = Date.now();
  }

  emitRaceUpdate(nsp, match);
};

/**
 * End the current round early when the advancing spots have all been claimed by
 * qualified survivors — there is no reason to keep waiting for the round timer
 * once enough players have locked in a spot.
 *
 * "Advancing spots" for a non-final round = `alive - eliminationCount(alive,
 * eliminationPct)`, the same count `endRound` will advance. When the number of
 * qualified survivors reaches that many, the outcome of the round is already
 * decided, so we clear the round timer and call `endRound` immediately.
 *
 * No-ops unless the room is in the `round` phase (so a duplicate call after the
 * round already ended is safe) and the round is non-final (the final round has
 * no percentage cut and is resolved by first-correct-guess / timer expiry). The
 * caller invokes this after applying qualification (human guess or bot tick).
 */
export const checkEarlyRoundEnd = (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  deps: RoundLifecycleDeps = {},
): void => {
  if (match.room.phase !== "round") {
    return;
  }

  const roundIndex = match.room.currentRoundIndex;
  if (isFinalRound(config, roundIndex)) {
    return;
  }

  const round = config.rounds[roundIndex];
  if (!round) {
    return;
  }

  const survivors = Array.from(match.players.values()).filter(
    (p) => !p.isEliminated,
  );
  const alive = survivors.length;
  const advancingSpots = alive - eliminationCount(alive, round.eliminationPct);
  const qualifiedSurvivors = survivors.filter((p) => p.qualified).length;

  if (qualifiedSurvivors < advancingSpots) {
    return;
  }

  logger.info(
    {
      matchId: match.room.matchId,
      roundIndex,
      qualifiedSurvivors,
      advancingSpots,
    },
    "Race round ended early: advancing spots filled",
  );

  // Clear the round timer so it can't also fire endRound after this early end.
  const serverOnlyData = deps.serverOnlyData ?? globalServerOnlyData;
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  if (roomServerOnlyData?.timers.roundTimer) {
    clearTimeout(roomServerOnlyData.timers.roundTimer);
    roomServerOnlyData.timers.roundTimer = undefined;
  }

  endRound(match, nsp, config, deps);
};

/**
 * End the current Round: rank the Round's Survivors, eliminate the slowest
 * configured percentage (non-final rounds), record placements, then continue.
 *
 * Ranking (Req 5.1–5.3) is delegated to the pure `rankSurvivors` over the
 * non-eliminated field. On a non-final Round the slowest-ranked suffix is
 * selected by `selectEliminated` using the Round's `eliminationPct` (Req 5.4)
 * and each eliminated Survivor is marked `isEliminated`, stamped with an
 * `eliminatedAt`, and given a `placement` (Req 5.5). Placement is the field
 * size at the moment of elimination: everyone eliminated on this tick shares
 * the placement equal to the surviving-plus-eliminated count, so a later
 * elimination yields a better (lower) placement — consistent with how
 * `stats.ts` `rankPlayers` orders by `eliminatedAt`.
 *
 * Continuation (Req 5.6–5.8): with `>= 2` Survivors and more Rounds remaining
 * the next Round begins (via a brief intermission then `beginRound`); with
 * exactly one Survivor that Survivor is declared the winner and the Match
 * finishes; with none the Match finishes as a draw. On the Final_Round the
 * timer-expiry resolution (task 7.8) is deferred to the injected `finishMatch`;
 * here the Final_Round simply hands the ranked field to finish so a winner /
 * draw is recorded.
 *
 * Broadcasts a `round:transition` summary (advanced vs eliminated ids) and an
 * `eliminated` event carrying each eliminated Player's placement (Req 5.9).
 *
 * _Requirements: 5.1, 5.4, 5.5, 5.6, 5.7, 5.8_
 */
export const endRound = (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  deps: RoundLifecycleDeps = {},
): void => {
  const roundIndex = match.room.currentRoundIndex;
  const round = config.rounds[roundIndex];
  if (!round) {
    logger.error(
      { matchId: match.room.matchId, roundIndex },
      "endRound ignored: round index out of range",
    );
    return;
  }

  const now = (deps.now ?? Date.now)();
  const finish = deps.finishMatch;

  // Clear the round timer if endRound was invoked directly (e.g. a final-round
  // early win) rather than by the timer firing.
  const serverOnlyData = deps.serverOnlyData ?? globalServerOnlyData;
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  if (roomServerOnlyData?.timers.roundTimer) {
    clearTimeout(roomServerOnlyData.timers.roundTimer);
    roomServerOnlyData.timers.roundTimer = undefined;
  }
  // Stop bot guessing while the round is resolved / during intermission. The
  // next `beginRound` restarts the ticker for the new round; `cleanupMatch`
  // clears it on teardown. Without this, bots would keep guessing the previous
  // round's word during the intermission gap.
  if (roomServerOnlyData?.timers.botTicker) {
    clearInterval(roomServerOnlyData.timers.botTicker);
    roomServerOnlyData.timers.botTicker = undefined;
  }

  // Rank the round's survivors (best-first) over the non-eliminated field.
  const survivorEntries: RankedSurvivor[] = Array.from(
    match.players.entries(),
  ).filter(([, player]) => !player.isEliminated);
  const ranked = rankSurvivors(survivorEntries);

  const final = isFinalRound(config, roundIndex);

  let eliminatedIds: string[] = [];
  if (!final) {
    eliminatedIds = selectEliminated(ranked, round.eliminationPct, config);

    // Assign DISTINCT placements to the players eliminated this tick, ordered by
    // performance rather than giving everyone the field size. The eliminated
    // occupy the tail of the placement range: with `fieldSize` alive and
    // `E = eliminatedIds.length` cut, survivors take 1..(fieldSize-E) and the
    // eliminated take (fieldSize-E+1)..fieldSize. Within that tail the BEST
    // performer gets the lowest (best) number, ordered by:
    //   1. total correct guesses (words) — more is better,
    //   2. total correct letters — more is better,
    //   3. total guesses — fewer is better (tie-break).
    // `eliminatedAt` is stamped so the cross-round survival order is still
    // recoverable; advancing players get no `eliminatedAt` (Property 7).
    const fieldSize = ranked.length;
    const firstEliminatedPlacement = fieldSize - eliminatedIds.length + 1;

    const orderedEliminated = [...eliminatedIds].sort((a, b) => {
      const pa = match.players.get(a);
      const pb = match.players.get(b);
      if (!pa || !pb) {
        return 0;
      }
      if (pa.correctGuesses !== pb.correctGuesses) {
        return pb.correctGuesses - pa.correctGuesses;
      }
      if (pa.correctLetters !== pb.correctLetters) {
        return pb.correctLetters - pa.correctLetters;
      }
      return pa.totalGuesses - pb.totalGuesses;
    });

    orderedEliminated.forEach((id, index) => {
      const player = match.players.get(id);
      if (player) {
        player.isEliminated = true;
        player.eliminatedAt = now;
        player.placement = firstEliminatedPlacement + index;
      }
    });

    // Record each real eliminated player's loss NOW, at the moment their
    // outcome is decided (Option 1: record-at-outcome), rather than deferring
    // to match finish/cleanup. This is what lets a bots-only room simply be
    // torn down when its last human leaves: every human's result was already
    // written when they were eliminated (or when they forfeited by leaving).
    // Bots and already-recorded players are skipped inside the helper.
    persistEliminatedAsLoss(match, eliminatedIds);
  }

  const eliminatedSet = new Set(eliminatedIds);
  const advancedIds = ranked
    .map(([id]) => id)
    .filter((id) => !eliminatedSet.has(id));

  // Broadcast the round-end summary and each eliminated player's placement.
  nsp.to(match.room.matchId).emit("round:transition", {
    roundIndex,
    advanced: advancedIds,
    eliminated: eliminatedIds,
  });
  for (const id of eliminatedIds) {
    const player = match.players.get(id);
    nsp.to(match.room.matchId).emit("eliminated", {
      playerId: id,
      placement: player?.placement,
    });
  }

  logger.info(
    {
      matchId: match.room.matchId,
      roundIndex,
      final,
      eliminated: eliminatedIds.length,
      advanced: advancedIds.length,
    },
    "Race round ended",
  );

  const doFinish = (winnerId: string | undefined) => {
    if (finish) {
      finish(match, nsp, config, winnerId);
    } else {
      // No injected finish hand-off: run the real finishMatch so the result is
      // recorded, broadcast, and persisted. Tests that want to observe endRound
      // in isolation can inject a stub through `deps.finishMatch`.
      finishMatch(match, nsp, config, winnerId, deps);
    }
  };

  // Final round timer expiry with no correct guess (Req 6.4, 6.5): resolve the
  // leader (highest completedWords, fewest totalGuesses) or a draw from the
  // ranked survivor field, then finish with that winner (or undefined → draw).
  // A first-correct-guess final-round win never reaches here — it short-circuits
  // through `handleFinalRoundWin`/`finishMatch` from the guess handler.
  if (final) {
    const { winnerId } = resolveFinalRound(ranked);
    doFinish(winnerId);
    return;
  }

  // Continuation for a non-final round (Req 5.6–5.8).
  if (advancedIds.length >= 2) {
    // More than one survivor and more rounds remain: transition to the next
    // round through a brief intermission, then begin it. Stamp the absolute
    // next-round start time so the client can count down to it during the
    // intermission (clock-skew corrected on the client).
    match.room.phase = "intermission";
    match.room.nextRoundStartsAt = now + INTERMISSION_MS;
    emitRaceUpdate(nsp, match);

    const nextRoundIndex = roundIndex + 1;
    if (roomServerOnlyData) {
      if (roomServerOnlyData.timers.intermissionTimer) {
        clearTimeout(roomServerOnlyData.timers.intermissionTimer);
      }
      roomServerOnlyData.timers.intermissionTimer = setTimeout(() => {
        roomServerOnlyData.timers.intermissionTimer = undefined;
        beginRound(match, nsp, config, nextRoundIndex, deps);
      }, INTERMISSION_MS);
    } else {
      // No server-only record (e.g. a direct unit test): begin immediately.
      beginRound(match, nsp, config, nextRoundIndex, deps);
    }
    return;
  }

  if (advancedIds.length === 1) {
    // Exactly one survivor: declare the winner and finish (Req 5.7).
    doFinish(advancedIds[0]);
    return;
  }

  // No survivors remain: finish as a draw (Req 5.8).
  doFinish(undefined);
};

/** Brief transition window between rounds (the `intermission` phase). */
const INTERMISSION_MS = 5_000;

// ---------------------------------------------------------------------------
// Match finish: finishMatch / handleFinalRoundWin (task 7.8)
// ---------------------------------------------------------------------------

/** One entry of the broadcast `match:result` placements array. */
type ResultPlacement = { playerId: string; placement: number };

/**
 * Compute a finishing placement for every player in `match`, given the declared
 * `winnerId` (undefined for a draw). Mirrors the ordering `stats.ts`
 * `rankPlayers` uses so the broadcast placements and the persisted placements
 * agree over the FULL field (bots included in the ordering, per Req 6.3 —
 * "every other Final_Round Survivor").
 *
 * Ordering (winner present):
 *   1. the declared winner is always placement 1,
 *   2. remaining players by latest `eliminatedAt` first (outlasting an opponent
 *      beats them), a missing `eliminatedAt` treated as "still alive" (survived
 *      to the end, sorts ahead of anyone eliminated earlier),
 *   3. same-tick / both-alive ties broken by round performance (more
 *      `completedWords`, then fewer `roundGuesses`).
 *
 * Draw (no winner): every player shares placement 1, matching `rankPlayers`.
 *
 * The player objects are mutated in place with their `placement` so both the
 * room state and the later `persistRaceStats` see the same value, and the same
 * ordering is returned for the `match:result` broadcast.
 */
const recordPlacements = (
  match: RaceMatch,
  winnerId: string | undefined,
): ResultPlacement[] => {
  const entries = Array.from(match.players.entries());

  // Draw: everyone shares placement 1 (consistent with stats.ts rankPlayers).
  if (!winnerId) {
    const placements: ResultPlacement[] = [];
    for (const [playerId, player] of entries) {
      player.placement = 1;
      placements.push({ playerId, placement: 1 });
    }
    return placements;
  }

  // A player still in the round (no eliminatedAt) outlasted anyone eliminated,
  // so treat a missing eliminatedAt as "latest" for survival ordering.
  const survivalKey = (p: RacePlayer): number =>
    p.eliminatedAt ?? Number.POSITIVE_INFINITY;

  const ordered = [...entries].sort(([idA, a], [idB, b]) => {
    // The declared winner is always first.
    if (idA === winnerId) {
      return -1;
    }
    if (idB === winnerId) {
      return 1;
    }

    // Later survival ranks higher (better placement).
    const survA = survivalKey(a);
    const survB = survivalKey(b);
    if (survA !== survB) {
      return survB - survA;
    }

    // Same survival tick: break by overall performance — more correct guesses
    // (words), then more correct letters, then fewer total guesses (matches the
    // elimination-placement ordering in endRound and rankPlayers in stats.ts).
    if (a.correctGuesses !== b.correctGuesses) {
      return b.correctGuesses - a.correctGuesses;
    }
    if (a.correctLetters !== b.correctLetters) {
      return b.correctLetters - a.correctLetters;
    }
    return a.totalGuesses - b.totalGuesses;
  });

  // Assign 1..N across the full field and stamp each player. Every player gets
  // a placement, so no survivor is left without one (Req 6.3).
  const placements: ResultPlacement[] = [];
  ordered.forEach(([playerId, player], index) => {
    const placement = index + 1;
    player.placement = placement;
    placements.push({ playerId, placement });
  });

  return placements;
};

/**
 * Abandon a Match that has no real human participants left to play it (only
 * Bots remain among the survivors).
 *
 * Unlike `finishMatch` this records NO outcome and persists NO stats: there is
 * no human to crown a winner or to credit a placement, and Bots are never
 * persisted anyway (Req 8.4). It simply marks the room `finished` (so any late
 * timer/guess is a no-op via the same idempotency `finishMatch` relies on) and
 * hands off to the same `cleanupMatch` teardown, which clears every room timer
 * and deletes the in-memory state (Req 9.4). No `match:result` is broadcast —
 * the room is being torn down because nobody is watching.
 *
 * `deps.cleanupMatch` is the injectable teardown seam (tests stub it); when
 * omitted the real `cleanupMatch` runs, bound to the module's global state maps.
 */
export const abandonMatch = (
  match: RaceMatch,
  deps: RoundLifecycleDeps = {},
): void => {
  if (match.room.phase === "finished") {
    return;
  }

  match.room.phase = "finished";

  const cleanup =
    deps.cleanupMatch ??
    ((matchId: string) =>
      cleanupMatch(
        matchId,
        globalMatches,
        globalServerOnlyData,
        globalServerOnlyBotData,
      ));
  cleanup(match.room.matchId);
};

/**
 * Finish a Match: record the outcome on the room, place every Player, broadcast
 * the final result, persist stats, and hand off to cleanup.
 *
 * Sets `room.phase = "finished"`. With a `winnerId` the room's `winnerId` is
 * stamped and `isDraw` cleared; with no winner the Match is a draw
 * (`isDraw = true`, `winnerId` cleared). Every Player is assigned a `placement`
 * via `recordPlacements` — the winner is placement 1 and all other Players are
 * ranked behind them in survival order, so no Survivor is left unplaced
 * (Req 6.3). The room's active timers (round / intermission) are cleared so no
 * scheduled callback fires on a finished Match.
 *
 * Broadcasts `match:result` with `{ winnerId, placements }` to the Match's
 * Lobby (Req 6.6) and pushes a final `race:update` so late/again-rendering
 * clients see the finished room. Then it fires `persistRaceStats` fire-and-
 * forget (its own try/catch swallows failures so the game loop is never broken,
 * Req 8.8) and invokes the injected `cleanupMatch` teardown (task 7.10) when
 * provided; if no cleanup hook is wired yet, the finish/broadcast/persist still
 * complete and teardown is left to the caller.
 *
 * `winnerId` is the first correct guesser in the Final_Round (Req 6.1, 6.2) or
 * the resolved leader on Final_Round timer expiry (Req 6.4), the sole remaining
 * Survivor on an early finish (Req 5.7), or `undefined` for a draw (Req 5.8,
 * 6.5). `deps` supplies the persistence/cleanup/timing seams (defaults to the
 * real module functions).
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.6_
 */
export const finishMatch = (
  match: RaceMatch,
  nsp: Namespace,
  _config: RaceConfig,
  winnerId?: string,
  deps: RoundLifecycleDeps = {},
): void => {
  // Idempotent: a Match already finished is left untouched so a late timer or a
  // duplicate final-round win can't re-broadcast or double-persist.
  if (match.room.phase === "finished") {
    logger.warn(
      { matchId: match.room.matchId },
      "finishMatch ignored: match already finished",
    );
    return;
  }

  match.room.phase = "finished";
  if (winnerId) {
    match.room.winnerId = winnerId;
    match.room.isDraw = false;
  } else {
    match.room.winnerId = undefined;
    match.room.isDraw = true;
  }

  // Place every player (winner 1, others ranked behind — Req 6.3).
  const placements = recordPlacements(match, winnerId);

  // Clear any live round/intermission timers so nothing fires on the finished
  // room. (cleanupMatch, task 7.10, clears the full timer set on teardown; this
  // guards the window before teardown when finish is triggered mid-round.)
  const serverOnlyData = deps.serverOnlyData ?? globalServerOnlyData;
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  if (roomServerOnlyData) {
    if (roomServerOnlyData.timers.roundTimer) {
      clearTimeout(roomServerOnlyData.timers.roundTimer);
      roomServerOnlyData.timers.roundTimer = undefined;
    }
    if (roomServerOnlyData.timers.intermissionTimer) {
      clearTimeout(roomServerOnlyData.timers.intermissionTimer);
      roomServerOnlyData.timers.intermissionTimer = undefined;
    }
    if (roomServerOnlyData.timers.botTicker) {
      clearInterval(roomServerOnlyData.timers.botTicker);
      roomServerOnlyData.timers.botTicker = undefined;
    }
  }

  logger.info(
    {
      matchId: match.room.matchId,
      winnerId,
      isDraw: match.room.isDraw,
      players: placements.length,
    },
    "Race match finished",
  );

  // Broadcast the final result (Req 6.6) and a final room snapshot.
  nsp
    .to(match.room.matchId)
    .emit("match:result", { winnerId, placements });
  emitRaceUpdate(nsp, match);

  // Persist stats fire-and-forget: persistRaceStats owns its try/catch and
  // swallows failures so a DB error never breaks the game loop (Req 8.8).
  const persist = deps.persistRaceStats ?? persistRaceStats;
  void persist(match);

  // Tear down the room (task 7.10): clear every room timer and delete the
  // match, its server-only record, and its bots. `deps.cleanupMatch` is the
  // injectable seam (tests stub it to observe teardown); when omitted the real
  // `cleanupMatch` runs, bound to the module's global state maps so it can look
  // up and clear the room from just the match id.
  const cleanup =
    deps.cleanupMatch ??
    ((matchId: string) =>
      cleanupMatch(
        matchId,
        globalMatches,
        globalServerOnlyData,
        globalServerOnlyBotData,
      ));
  cleanup(match.room.matchId);
};

/**
 * Declare the first correct guesser of the Final_Round the winner and finish
 * the Match immediately (Req 6.1, 6.2).
 *
 * Called by the guess handler (task 13.2) the moment a Survivor submits the
 * first correct guess of the Final_Round word — the fastest correct guess wins
 * before the Round timer expires. This is a thin wrapper over `finishMatch`
 * with the guesser as `winnerId`; all other Survivors are placed behind them in
 * ranking order (Req 6.3) and `match:result` is broadcast (Req 6.6). Because
 * `finishMatch` is idempotent, a second correct guess arriving after the first
 * has finished the Match is a no-op.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.6_
 */
export const handleFinalRoundWin = (
  match: RaceMatch,
  nsp: Namespace,
  config: RaceConfig,
  winnerId: string,
  deps: RoundLifecycleDeps = {},
): void => {
  finishMatch(match, nsp, config, winnerId, deps);
};

// ---------------------------------------------------------------------------
// Match teardown: cleanupMatch (task 7.10)
// ---------------------------------------------------------------------------

/**
 * Tear down a finished (or abandoned) Match: clear every timer the room can
 * have scheduled, then delete all of its in-memory state.
 *
 * Clears ALL five room timers before deleting state so no orphaned callback can
 * fire on a deleted room (Req 9.4): the one-shot `setTimeout` timers
 * (`lobbyCountdown`, `roundTimer`, `intermissionTimer`) are cleared with
 * `clearTimeout`, and the `setInterval`-based tickers (`botTicker`,
 * `updateTicker`) are cleared with `clearInterval` — matching Battle Royale's
 * `cleanupGame` teardown pattern. Each handle is guarded with a presence check
 * so a room that never armed a given timer is a no-op.
 *
 * After clearing timers it removes the Match from `matches`, the room's
 * server-only record from `serverOnlyData`, and the room's bots from `botData`
 * (`serverOnlyBotData`). Missing entries are harmless — `Map.delete` is a no-op
 * when the key is absent — so calling cleanup twice, or on a room that only
 * ever reached the lobby, is safe.
 *
 * The state maps are passed in (rather than referenced from the module) so this
 * is testable in isolation; `finishMatch` wires a version bound to the module's
 * global maps through its `cleanupMatch` seam.
 *
 * _Requirements: 9.4_
 */
export const cleanupMatch = (
  matchId: string,
  matches: Map<string, RaceMatch>,
  serverOnlyData: Map<string, RaceRoomServerData>,
  botData: RaceServerBotData,
): void => {
  const roomServerOnlyData = serverOnlyData.get(matchId);

  logger.info(
    {
      matchId,
      playerCount: matches.get(matchId)?.players.size ?? 0,
      hasServerData: Boolean(roomServerOnlyData),
    },
    "Cleaning up race match",
  );

  if (roomServerOnlyData) {
    const { lobbyCountdown, roundTimer, intermissionTimer, botTicker, updateTicker } =
      roomServerOnlyData.timers;

    // Track which timers were actually armed so the log reflects real teardown.
    const clearedTimers: string[] = [];

    // One-shot setTimeout timers.
    if (lobbyCountdown) {
      clearTimeout(lobbyCountdown);
      clearedTimers.push("lobbyCountdown");
    }
    if (roundTimer) {
      clearTimeout(roundTimer);
      clearedTimers.push("roundTimer");
    }
    if (intermissionTimer) {
      clearTimeout(intermissionTimer);
      clearedTimers.push("intermissionTimer");
    }

    // setInterval-based tickers.
    if (botTicker) {
      clearInterval(botTicker);
      clearedTimers.push("botTicker");
    }
    if (updateTicker) {
      clearInterval(updateTicker);
      clearedTimers.push("updateTicker");
    }

    logger.info(
      { matchId, clearedTimers },
      "Cleared race room timers",
    );
  }

  // Drop this match's share code so it can't resolve to a dead match. Read it
  // off the room before the match is deleted below.
  const shareCode = matches.get(matchId)?.room.shareCode;
  if (shareCode) {
    shareCodes.delete(shareCode);
  }

  matches.delete(matchId);
  serverOnlyData.delete(matchId);
  botData.delete(matchId);
};
