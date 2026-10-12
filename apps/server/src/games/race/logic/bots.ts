import type { RaceConfig } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import logger from "../../../utils/logger.js";
import { generateBotNames } from "../../battle-royale/logic/bot-names.js";
import type { RaceBotServerData } from "../state.js";
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

type BotLevel = 1 | 2 | 3 | 4 | 5;

/**
 * A lobby's bot-difficulty archetype. Decided ONCE when a lobby is filled with
 * bots (see `rollLobbyArchetype`), it sets the skill-level band every bot in
 * that game is drawn from — so some lobbies feel genuinely easy and a rare few
 * feel brutal, instead of every game clustering on the same middle curve.
 *
 *   - `minLevel`/`maxLevel`: the inclusive level band bots can roll in this
 *     lobby.
 *   - `bias`: where, within that band, the bell curve centers. 0 pins the curve
 *     to `minLevel`, 1 to `maxLevel`, 0.5 is the middle. Higher bias = more of
 *     the band's top levels.
 *   - `weight`: relative selection probability among all archetypes.
 */
type LobbyArchetype = {
	name: "chill" | "mixed" | "sharp" | "elite";
	minLevel: BotLevel;
	maxLevel: BotLevel;
	bias: number;
	weight: number;
};

/**
 * The lobby archetypes and how often each is chosen. Weights are relative (they
 * need not sum to 1). Tuned so the common case is easy-to-moderate and the
 * hardest lobbies are rare:
 *
 *   chill (35%): levels 1–3, low-biased  — a breezy field a new player can win.
 *   mixed (37%): levels 1–4, mid          — the everyday race.
 *   sharp (20%): levels 2–5, high-biased  — fast field, level 5 possible.
 *   elite  (8%): levels 3–5, top-biased   — brutal; mostly 4s and 5s.
 *
 * Only `sharp` and `elite` can produce a level-5 bot, so ~28% of lobbies are
 * level-5-capable (and fewer actually surface one).
 */
export const LOBBY_ARCHETYPES: readonly LobbyArchetype[] = [
	{ name: "chill", minLevel: 1, maxLevel: 3, bias: 0.3, weight: 35 },
	{ name: "mixed", minLevel: 1, maxLevel: 4, bias: 0.5, weight: 37 },
	{ name: "sharp", minLevel: 2, maxLevel: 5, bias: 0.62, weight: 20 },
	{ name: "elite", minLevel: 3, maxLevel: 5, bias: 0.72, weight: 8 },
] as const;

/**
 * Pick one lobby archetype at random, weighted by each archetype's `weight`.
 * Called once per filled lobby so every bot in that game shares a difficulty
 * band.
 */
export const rollLobbyArchetype = (): LobbyArchetype => {
	const totalWeight = LOBBY_ARCHETYPES.reduce((sum, a) => sum + a.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const archetype of LOBBY_ARCHETYPES) {
		roll -= archetype.weight;
		if (roll < 0) {
			return archetype;
		}
	}
	// Unreachable while weights are positive; fall back to the everyday field.
	return LOBBY_ARCHETYPES[1] as LobbyArchetype;
};

/**
 * Roll a bot skill level within the lobby archetype's band, using a rough bell
 * curve (average of 3 uniform samples) so levels cluster toward the middle of
 * the band and extremes are rarer. The archetype's `bias` shifts that center
 * within `[minLevel, maxLevel]`: a low-bias (chill) lobby leans toward its
 * floor, a high-bias (elite) lobby toward its ceiling.
 */
const getRandomLevel = (archetype: LobbyArchetype): BotLevel => {
	const rolls = 3;
	const average =
		Array.from({ length: rolls }, () => Math.random()).reduce(
			(sum, value) => sum + value,
			0,
		) / rolls;

	const span = archetype.maxLevel - archetype.minLevel;
	// Blend the symmetric bell sample toward the archetype's bias: shift the
	// [0,1) sample so its center sits at `bias` rather than 0.5, then map onto
	// the band. Clamped to the band so rounding never escapes [minLevel,maxLevel].
	const centered = average + (archetype.bias - 0.5);
	const position = Math.min(1, Math.max(0, centered));
	const level = archetype.minLevel + Math.round(position * span);
	return Math.min(
		archetype.maxLevel,
		Math.max(archetype.minLevel, level),
	) as BotLevel;
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

/**
 * A fresh server-only simulation record for a bot entering a lobby. `archetype`
 * is the per-lobby difficulty band threaded through from `fillLobbyWithBots`;
 * the bot's level is drawn from it.
 */
const makeBotServerData = (
	wordLength: number,
	archetype: LobbyArchetype,
): RaceBotServerData => ({
	word: getRandomWord(wordLength),
	level: getRandomLevel(archetype),
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

	// Decide ONCE for this game which difficulty archetype its bots are drawn
	// from, so this lobby has a consistent feel (chill / mixed / sharp / elite)
	// and games vary from easy to brutal rather than all clustering mid-curve.
	const archetype = rollLobbyArchetype();

	// Human-looking DISPLAY names, unique within this lobby, so the field reads
	// like real people instead of "bot0", "bot1", … Reuses Battle Royale's name
	// generator so the two modes behave identically. IMPORTANT: these are display
	// names only — each bot is still KEYED `bot${i}` so the UUID-based bot
	// detection in handlers/stats keeps distinguishing bots from real players.
	const displayNames = generateBotNames(botsToAdd);

	const addedBotIds: string[] = [];
	const botLevels: number[] = [];
	for (let i = 0; i < botsToAdd; i++) {
		const botId = `bot${i}`;
		players.set(botId, makeBotPlayer(displayNames[i] ?? botId));
		const serverData = makeBotServerData(firstRoundLength, archetype);
		botData[botId] = serverData;
		botLevels.push(serverData.level);
		addedBotIds.push(botId);
	}

	// Log the chosen lobby difficulty prominently so it's easy to grep per match.
	// Includes the archetype's full definition (band + bias) and the actual
	// distribution of bot levels rolled from it, so the realized difficulty — not
	// just the archetype name — is visible.
	logger.info(
		{
			matchDifficulty: archetype.name,
			levelBand: `${archetype.minLevel}-${archetype.maxLevel}`,
			bias: archetype.bias,
			botLevelCounts: countLevels(botLevels),
			humansJoined: currentPlayerCount,
			botsAdded: botsToAdd,
			minLobbySize: config.minLobbySize,
		},
		"Race lobby difficulty chosen",
	);
	return addedBotIds;
};

/**
 * Tally a list of bot levels into a `{ level: count }` map for logging, so the
 * realized spread of difficulty within a lobby is visible at a glance (e.g.
 * `{ "2": 40, "3": 50, "4": 9 }`). Levels with no bots are omitted.
 */
const countLevels = (levels: number[]): Record<number, number> => {
	const counts: Record<number, number> = {};
	for (const level of levels) {
		counts[level] = (counts[level] ?? 0) + 1;
	}
	return counts;
};

// Per-level "think time" window between simulated bot guesses, in ms — higher
// levels act faster. Mirrors the pacing idea in Battle Royale's THINK_TIMES.
// Tuned slower than the original pacing: bots were landing words (especially
// the final 6-letter round) faster than a human could reasonably keep up, so
// every level now takes a bit longer to attempt its next guess.
const THINK_TIMES = {
	1: [9000, 15000],
	2: [7500, 13000],
	3: [6000, 11000],
	4: [4500, 8500],
	5: [3500, 6500],
} as const;

// Per-level chance (%) that a simulated bot guess is "correct" and completes
// its current word. Progress makes a bot slightly more likely to land the word.
// Lowered from the original curve (was 6/10/16/24/34): bots felt "too good" in
// general, so each level now needs more guesses on average to solve a word.
const BASE_CORRECT_CHANCE = { 1: 5, 2: 8, 3: 12, 4: 18, 5: 26 } as const;

/** How often the bot ticker wakes to evaluate bot guesses, in ms. */
const BOT_TICK_MS = 250;

// Baseline word length the raw THINK_TIMES windows are tuned for, and the
// exponent that makes longer words cost SUPER-linearly more thinking time. A
// longer word is disproportionately harder, so think time scales as
// (wordLength / BASE) ** EXP rather than linearly. Raised from 2.2 to 2.8 so the
// final 6-letter round in particular slows bots more: with EXP 2.8 a 5-letter
// word takes ~1.8x and a 6-letter word ~3.1x a 4-letter word's think time.
const THINK_TIME_BASE_LENGTH = 4;
const THINK_TIME_LENGTH_EXP = 2.8;

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

// Per-letter-over-baseline reduction (percentage points) applied to a bot's
// per-guess correct chance for longer words. A 4-letter word is the baseline
// (no penalty); each extra letter makes a word proportionally harder to LAND on
// any given guess, not just slower to attempt. At 5 letters the chance drops by
// one step, at 6 by two — so the single-word 6-letter final round is where bots
// are reined in the most. Clamped so the effective chance never falls below a
// small floor (a bot must always have some path to solving).
const CORRECT_CHANCE_LENGTH_PENALTY_PER_LETTER = 4;
const MIN_CORRECT_CHANCE = 2;

/**
 * Decide whether a bot lands its current word on this simulated guess. The
 * chance rises modestly with the number of guesses the bot has already made on
 * the round so a stalled bot eventually progresses, and falls for longer words
 * so the 5- and 6-letter rounds are genuinely harder for bots to solve.
 */
const rollBotCorrect = (
	level: 1 | 2 | 3 | 4 | 5,
	botGuesses: number,
	wordLength: number,
): boolean => {
	const progressBonus = Math.min(botGuesses * 1.5, 15);
	const lengthPenalty =
		Math.max(0, wordLength - THINK_TIME_BASE_LENGTH) *
		CORRECT_CHANCE_LENGTH_PENALTY_PER_LETTER;
	const correctChance = Math.max(
		MIN_CORRECT_CHANCE,
		BASE_CORRECT_CHANCE[level] + progressBonus - lengthPenalty,
	);
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
	const correct = rollBotCorrect(bot.level, bot.botGuesses, wordLength);

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
