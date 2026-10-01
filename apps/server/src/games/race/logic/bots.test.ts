import fc from "fast-check";
import type { RaceConfig } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaceBotServerData } from "../state.js";
import { fillLobbyWithBots, tickBot } from "./bots.js";

// Feature: round-based-elimination-race, Property 14: Bot-fill brings a short lobby up to exactly the minimum
//
// For any lobby whose countdown reaches zero holding fewer than
// `minLobbySize` players, `fillLobbyWithBots` adds exactly
// `minLobbySize - currentPlayerCount` bots, leaving exactly `minLobbySize`
// participants. A lobby already at or above `minLobbySize` gets no bots and is
// left unchanged. Added bots are keyed `bot0`, `bot1`, … and each gets a
// matching server-only simulation record.
//
// Validates: Requirements 3.5

// A minimal display-side player; none of its fields matter for bot-fill, which
// only reads the map's size, so we use fixed placeholders.
const makePlayer = (name: string): RacePlayer => ({
  name,
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

// A config that varies only `minLobbySize`; the rest are fixed valid values.
// The refine invariants of `raceConfigSchema` are irrelevant here because the
// function reads only `minLobbySize` and `rounds[0].wordLength`, so we build a
// plain object rather than parsing through Zod.
const makeConfig = (minLobbySize: number): RaceConfig => ({
  rounds: [
    { timerMs: 90_000, wordLength: 5, qualifyingCount: 3, eliminationPct: 0.3 },
  ],
  minLobbySize,
  maxLobbySize: 32,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
});

describe("fillLobbyWithBots brings a short lobby to exactly the minimum (Property 14)", () => {
  it("fills to exactly minLobbySize, no-ops when already full, and keys bots bot0..botN", () => {
    fc.assert(
      fc.property(
        // 0..40 real players with UUID-ish ids.
        fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 40 }),
        // A positive minimum lobby size.
        fc.integer({ min: 1, max: 32 }),
        (playerIds, minLobbySize) => {
          const players = new Map<string, RacePlayer>();
          for (const id of playerIds) {
            players.set(id, makePlayer(id));
          }
          const botData: { [botId: string]: RaceBotServerData } = {};
          const config = makeConfig(minLobbySize);

          const currentPlayerCount = players.size;
          const added = fillLobbyWithBots(players, botData, config);

          if (currentPlayerCount < minLobbySize) {
            const expectedBots = minLobbySize - currentPlayerCount;

            // (a) exactly the shortfall was filled with bots, ending at min.
            expect(added.length).toBe(expectedBots);
            expect(players.size).toBe(minLobbySize);

            // (c) added bot ids are bot0, bot1, … and each has a botData entry.
            for (let i = 0; i < expectedBots; i++) {
              const botId = `bot${i}`;
              expect(added[i]).toBe(botId);
              expect(players.has(botId)).toBe(true);
              expect(botData[botId]).toBeDefined();
            }
            expect(Object.keys(botData).length).toBe(expectedBots);
          } else {
            // (b) already at/above min: no bots added, map untouched.
            expect(added.length).toBe(0);
            expect(players.size).toBe(currentPlayerCount);
            expect(Object.keys(botData).length).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("bot think-time scales super-linearly with word length", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `tickBot` schedules the bot's first guess `thinkTime` ms in the future on
  // its first tick (guessTimeStamp unset). With Math.random pinned, thinkTime is
  // deterministic, so the scheduled delay lets us compare think-time across word
  // lengths for the same bot level.
  const firstThinkDelay = (level: 1 | 2 | 3 | 4 | 5, wordLength: number) => {
    const bot: RaceBotServerData = {
      word: "?".repeat(wordLength),
      level,
      botCompletedWords: 0,
      botGuesses: 0,
    };
    tickBot(bot, 0, wordLength);
    return bot.guessTimeStamp ?? 0;
  };

  it("makes longer words take disproportionately (super-linearly) more think time", () => {
    // Pin Math.random so getRandomInt returns a fixed point in each window.
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const four = firstThinkDelay(3, 4);
    const five = firstThinkDelay(3, 5);
    const six = firstThinkDelay(3, 6);

    // Strictly increasing with length.
    expect(five).toBeGreaterThan(four);
    expect(six).toBeGreaterThan(five);

    // Super-linear: the 4->6 jump is more than double a linear 4->5 step.
    // (linear would give six ≈ four * 6/4 = 1.5x; the exponent makes it larger.)
    expect(six).toBeGreaterThan(four * 2);
    // And the 5->6 increment exceeds the 4->5 increment (accelerating cost).
    expect(six - five).toBeGreaterThan(five - four);
  });
});
