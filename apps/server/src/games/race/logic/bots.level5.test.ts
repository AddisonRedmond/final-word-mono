import type { RaceConfig } from "shared/race.js";
import type { RacePlayer } from "types/race.types.js";
import { describe, expect, it } from "vitest";
import type { RaceBotServerData } from "../state.js";
import { fillLobbyWithBots, LOBBY_ARCHETYPES, rollLobbyArchetype } from "./bots.js";

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

// Feature: round-based-elimination-race — lobby difficulty archetypes.
//
// A lobby's bots are drawn from one difficulty archetype rolled once per game
// (chill / mixed / sharp / elite). These tests validate the invariants that
// matter for difficulty variety: levels never escape the valid band, only
// level-5-capable archetypes ever surface a level 5, and the archetype roll
// spreads across the full set so some lobbies are easy and a few are brutal.

describe("lobby archetypes drive bot difficulty variety", () => {
  it("every bot level stays within 1..5 regardless of archetype", () => {
    for (let g = 0; g < 2000; g++) {
      const players = new Map<string, RacePlayer>();
      const botData: { [botId: string]: RaceBotServerData } = {};
      fillLobbyWithBots(players, botData, config);

      const levels = Object.values(botData).map((b) => b.level);
      expect(Math.max(...levels)).toBeLessThanOrEqual(5);
      expect(Math.min(...levels)).toBeGreaterThanOrEqual(1);
    }
  });

  it("level 5 only appears in level-5-capable lobbies (sharp/elite), so it stays uncommon", () => {
    const GAMES = 6000;
    let gamesWithLevel5 = 0;

    for (let g = 0; g < GAMES; g++) {
      const players = new Map<string, RacePlayer>();
      const botData: { [botId: string]: RaceBotServerData } = {};
      fillLobbyWithBots(players, botData, config);

      if (Object.values(botData).some((b) => b.level === 5)) {
        gamesWithLevel5++;
      }
    }

    const ratio = gamesWithLevel5 / GAMES;
    // eslint-disable-next-line no-console
    console.log(`games with a level-5 bot: ${(ratio * 100).toFixed(1)}%`);
    // Only `sharp` (20%) and `elite` (8%) can roll a 5, so the ceiling is the
    // combined ~28% archetype share; it should land a bit below that (not every
    // capable lobby surfaces a 5) and well above zero.
    expect(ratio).toBeLessThanOrEqual(0.3);
    expect(ratio).toBeGreaterThan(0.08);
  });

  it("rollLobbyArchetype spreads across all archetypes, roughly tracking the weights", () => {
    const GAMES = 20_000;
    const counts: Record<string, number> = {
      chill: 0,
      mixed: 0,
      sharp: 0,
      elite: 0,
    };
    for (let g = 0; g < GAMES; g++) {
      counts[rollLobbyArchetype().name]++;
    }

    const totalWeight = LOBBY_ARCHETYPES.reduce((s, a) => s + a.weight, 0);
    for (const archetype of LOBBY_ARCHETYPES) {
      const observed = counts[archetype.name] / GAMES;
      const expected = archetype.weight / totalWeight;
      // Each archetype shows up, within a tolerance of its weighted share.
      expect(observed).toBeGreaterThan(0);
      expect(Math.abs(observed - expected)).toBeLessThan(0.05);
    }
  });

  it("the realized level distribution spans easy and hard (both low and top levels appear)", () => {
    // Across many filled lobbies the bot levels must cover the full range —
    // plenty of easy level-1/2 bots AND some top-end level-5 bots — proving
    // difficulty genuinely varies lobby to lobby rather than clustering.
    const levelCounts = [0, 0, 0, 0, 0, 0]; // index by level 1..5
    let totalBots = 0;

    for (let g = 0; g < 3000; g++) {
      const players = new Map<string, RacePlayer>();
      const botData: { [botId: string]: RaceBotServerData } = {};
      fillLobbyWithBots(players, botData, config);
      for (const b of Object.values(botData)) {
        levelCounts[b.level]++;
        totalBots++;
      }
    }

    // Easy bots (levels 1–2) are common — the field is beatable most of the time.
    const easyShare = (levelCounts[1] + levelCounts[2]) / totalBots;
    expect(easyShare).toBeGreaterThan(0.25);

    // Top-end bots (level 5) exist but are rare.
    const topShare = levelCounts[5] / totalBots;
    expect(topShare).toBeGreaterThan(0);
    expect(topShare).toBeLessThan(0.15);
  });
});
