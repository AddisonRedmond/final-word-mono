import type { RaceConfig } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import type { RaceBotServerData } from "../state.js";
import logger from "../../../utils/logger.js";
import { getRandomWord } from "./words.js";

// Race_Mode bot support: lobby bot-fill and the bot guess-simulation ticker.
//
// Mirrors `battle-royale/logic/battle-royale-bots.ts`'s bot-fill and ticker
// STRUCTURE ONLY. Race is a solo race-to-qualify with independent per-player
// words, so bots simply progress their OWN assigned word over time — there is
// NO attack/targeting logic (no applyAttack, determineTarget, attack queues,
// or attack-word bonuses). The full round wiring (word assignment on round
// begin, qualification latch, elimination) lands in later lifecycle tasks; the
// ticker here advances a bot's `botCompletedWords` over time as a scaffold.

const getRandomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Roll a bot skill level with a rough bell curve centered on level 3, matching
 * Battle Royale's `getRandomLevel` distribution so Race bots feel comparable.
 */
const getRandomLevel = (): 1 | 2 | 3 | 4 | 5 => {
  const rolls = 3;
  const average =
    Array.from({ length: rolls }, () => Math.random()).reduce(
      (sum, value) => sum + value,
      0,
    ) / rolls;

  const level = Math.floor(average * 5) + 1;
  return Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5;
};

/** A fresh display-side `RacePlayer` for a bot entering a lobby. */
const makeBotPlayer = (name: string): RacePlayer => ({
  name,
  isBot: true,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

/** A fresh server-only simulation record for a bot entering a lobby. */
const makeBotServerData = (wordLength: number): RaceBotServerData => ({
  word: getRandomWord(wordLength),
  level: getRandomLevel(),
  botCompletedWords: 0,
  botGuesses: 0,
});

/**
 * Fill a short Lobby with Bots up to exactly the minimum Lobby size when its
 * countdown reaches zero (Req 3.5, Property 14).
 *
 * The number of Bots added equals `minLobbySize - players.size` (never
 * negative), so the resulting participant count is exactly `minLobbySize` when
 * the lobby started below it, and unchanged when it was already at or above it.
 * Bots are keyed `bot0`, `bot1`, … following the Battle Royale convention so
 * the UUID regex used by stats can distinguish them from real players (Req
 * 8.4). Display entries are added to `players`; matching server-only
 * simulation records are added to `botData` under the same room key.
 *
 * The bot words are seeded at the current round's `wordLength`; the lifecycle
 * (later task) reassigns words when a round actually begins. Returns the list
 * of bot ids that were added.
 *
 * _Requirements: 3.5_
 */
export const fillLobbyWithBots = (
  players: Map<string, RacePlayer>,
  botData: { [botId: string]: RaceBotServerData },
  config: RaceConfig,
): string[] => {
  const currentPlayerCount = players.size;
  const botsToAdd = Math.max(0, config.minLobbySize - currentPlayerCount);
  if (botsToAdd === 0) {
    return [];
  }

  // Seed bot words at the first round's length; the round lifecycle reassigns
  // per-round words on begin. `rounds` is guaranteed non-empty by the schema.
  const firstRoundLength = config.rounds[0]?.wordLength ?? 5;

  const addedBotIds: string[] = [];
  for (let i = 0; i < botsToAdd; i++) {
    const botId = `bot${i}`;
    players.set(botId, makeBotPlayer(botId));
    botData[botId] = makeBotServerData(firstRoundLength);
    addedBotIds.push(botId);
  }

  logger.info(
    {
      humansJoined: currentPlayerCount,
      botsAdded: botsToAdd,
      minLobbySize: config.minLobbySize,
    },
    "Added bots to race lobby: not enough humans joined to fill the field",
  );
  return addedBotIds;
};

// Per-level "think time" window between simulated bot guesses, in ms — higher
// levels act faster. Mirrors the pacing idea in Battle Royale's THINK_TIMES.
const THINK_TIMES = {
  1: [8000, 14000],
  2: [6500, 12000],
  3: [5000, 10000],
  4: [3500, 7000],
  5: [2500, 5000],
} as const;

// Per-level chance (%) that a simulated bot guess is "correct" and completes
// its current word. Progress makes a bot slightly more likely to land the word.
const BASE_CORRECT_CHANCE = { 1: 6, 2: 10, 3: 16, 4: 24, 5: 34 } as const;

/** How often the bot ticker wakes to evaluate bot guesses, in ms. */
const BOT_TICK_MS = 250;

// Baseline word length the raw THINK_TIMES windows are tuned for, and the
// exponent that makes longer words cost SUPER-linearly more thinking time. A
// longer word is disproportionately harder, so think time scales as
// (wordLength / BASE) ** EXP rather than linearly: with EXP ~2.2 a 5-letter
// word takes ~1.6x and a 6-letter word ~2.4x a 4-letter word's think time.
const THINK_TIME_BASE_LENGTH = 4;
const THINK_TIME_LENGTH_EXP = 2.2;

const wordLengthThinkFactor = (wordLength: number): number =>
  (Math.max(1, wordLength) / THINK_TIME_BASE_LENGTH) ** THINK_TIME_LENGTH_EXP;

const getBotThinkTime = (
  level: 1 | 2 | 3 | 4 | 5,
  wordLength: number,
): number => {
  const [min, max] = THINK_TIMES[level];
  const factor = wordLengthThinkFactor(wordLength);
  return Math.round(getRandomInt(min, max) * factor);
};

/**
 * Decide whether a bot lands its current word on this simulated guess. The
 * chance rises modestly with the number of guesses the bot has already made on
 * the round so a stalled bot eventually progresses.
 */
const rollBotCorrect = (level: 1 | 2 | 3 | 4 | 5, botGuesses: number): boolean => {
  const progressBonus = Math.min(botGuesses * 1.5, 15);
  const correctChance = BASE_CORRECT_CHANCE[level] + progressBonus;
  return Math.random() * 100 < correctChance;
};

/**
 * Advance a single bot's independent word progress for one tick, purely with
 * respect to timing: given the bot's server-side simulation record and the
 * current time, it either keeps thinking or resolves a guess, mutating only
 * that bot's `botGuesses`/`botCompletedWords`/`word`/`guessTimeStamp`.
 *
 * There is no attack/targeting interaction — a bot only races its own word.
 * Returns `true` when the bot completed a word this tick (so the caller can
 * mirror progress onto display state and schedule a broadcast), otherwise
 * `false`.
 */
export const tickBot = (
  bot: RaceBotServerData,
  now: number,
  wordLength: number,
): boolean => {
  // First tick since the bot started: begin thinking rather than guessing
  // immediately (guessTimeStamp is unset until the first guess is scheduled).
  if (bot.guessTimeStamp === undefined) {
    bot.guessTimeStamp = now + getBotThinkTime(bot.level, wordLength);
    return false;
  }

  // Still thinking.
  if (now < bot.guessTimeStamp) {
    return false;
  }

  bot.botGuesses += 1;
  const correct = rollBotCorrect(bot.level, bot.botGuesses);

  // Schedule the next guess regardless of outcome.
  bot.guessTimeStamp = now + getBotThinkTime(bot.level, wordLength);

  if (!correct) {
    return false;
  }

  // Completed the current word: progress and draw a fresh word of the round's
  // configured length. The lifecycle owns the qualification latch on the
  // display player; this ticker only advances the bot's own progress.
  bot.botCompletedWords += 1;
  bot.word = getRandomWord(wordLength);
  return true;
};

/**
 * Start the bot guess-simulation ticker for a room. Periodically walks every
 * bot's server-side record and advances its independent word progress via
 * `tickBot`; when a bot completes a word, `onBotProgress(botId)` is invoked so
 * the caller can mirror the progress onto display state (and coalesce a
 * broadcast). Returns the interval handle for the room's `botTicker` timer so
 * `cleanupMatch` (later task) can clear it.
 *
 * The ticker is intentionally injectable: `now`, the bot record source, and the
 * round word length all come from the caller, so it references no module
 * globals and the full round wiring can supply live state in a later task.
 *
 * _Requirements: 3.5_
 */
export const startBotTicker = (
  botData: { [botId: string]: RaceBotServerData },
  getWordLength: () => number,
  onBotProgress: (botId: string) => void,
  now: () => number = Date.now,
): NodeJS.Timeout => {
  logger.info(
    { botCount: Object.keys(botData).length },
    "Starting race bot ticker",
  );

  return setInterval(() => {
    const currentTime = now();
    const wordLength = getWordLength();

    for (const botId in botData) {
      const bot = botData[botId];
      if (!bot) {
        continue;
      }

      const completed = tickBot(bot, currentTime, wordLength);
      if (completed) {
        onBotProgress(botId);
      }
    }
  }, BOT_TICK_MS);
};
