import type { RaceConfig } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import { describe, expect, it } from "vitest";
import type { RaceBotServerData } from "../state.js";
import { fillLobbyWithBots } from "./bots.js";

const config: RaceConfig = {
  rounds: [
    { timerMs: 90_000, wordLength: 4, qualifyingCount: 3, eliminationPct: 0.5 },
  ],
  minLobbySize: 20,
  maxLobbySize: 99,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

describe("per-game level-5 chance", () => {
  it("level 5 only ever appears in level-5-enabled games (~25% of games)", () => {
    const GAMES = 6000;
    // A game is "level-5 enabled" if ANY of its bots is level 5. Because the
    // level still comes from the bell curve, an enabled game won't always
    // surface a 5 with few bots — but with 20 bots per game an enabled game
    // almost always has at least one, so the games-with-a-5 rate tracks the
    // 25% per-game enable roll closely from below.
    let gamesWithLevel5 = 0;

    for (let g = 0; g < GAMES; g++) {
      const players = new Map<string, RacePlayer>();
      const botData: { [botId: string]: RaceBotServerData } = {};
      fillLobbyWithBots(players, botData, config);

      const levels = Object.values(botData).map((b) => b.level);
      // Invariant: level is always within 1..5 (never a crash-y out-of-range).
      expect(Math.max(...levels)).toBeLessThanOrEqual(5);
      expect(Math.min(...levels)).toBeGreaterThanOrEqual(1);

      if (levels.includes(5)) {
        gamesWithLevel5++;
      }
    }

    const ratio = gamesWithLevel5 / GAMES;
    // eslint-disable-next-line no-console
    console.log(`games with a level-5 bot: ${(ratio * 100).toFixed(1)}%`);
    // Must never exceed the 25% enable rate (level 5 is impossible in a
    // non-enabled game), and should be reasonably close to it with 20 bots.
    expect(ratio).toBeLessThanOrEqual(0.25);
    expect(ratio).toBeGreaterThan(0.08);
  });
});
