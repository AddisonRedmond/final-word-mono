import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePhase, RacePlayer } from "types/race.types.js";
import { describe, expect, it } from "vitest";
import { getOrCreateLobby } from "./race.js";

// Feature: round-based-elimination-race, Property 13: Lobby selection never returns a started match
//
// For any collection of lobbies in any mix of phases, the lobby chosen for a
// newly joining Player is always one whose phase is `lobby` and whose size is
// below `maxLobbySize` (creating a fresh lobby when none qualifies), and is
// never a match whose phase is `round`, `intermission`, or `finished`.
//
// Validates: Requirements 3.1, 3.2, 3.7

// Small maxLobbySize keeps the "at/over capacity" branch frequent so the
// generator regularly produces full lobbies that must be skipped.
const config: RaceConfig = {
  rounds: [{ timerMs: 60_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0 }],
  minLobbySize: 2,
  maxLobbySize: 4,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

const phaseArb: fc.Arbitrary<RacePhase> = fc.constantFrom(
  "lobby",
  "round",
  "intermission",
  "finished",
);

const makePlayer = (): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

// A single match with a chosen phase and player count. Player counts span
// 0..maxLobbySize+1 so we hit empty, partial, exactly-full, and over-full
// lobbies (the last two must never be selected even when phase is `lobby`).
const matchArb: fc.Arbitrary<RaceMatch> = fc
  .record({
    phase: phaseArb,
    playerCount: fc.integer({ min: 0, max: config.maxLobbySize + 1 }),
  })
  .map(({ phase, playerCount }) => {
    const players = new Map<string, RacePlayer>();
    for (let i = 0; i < playerCount; i++) {
      players.set(randomUUID(), makePlayer());
    }
    return {
      room: {
        matchId: randomUUID(),
        phase,
        createdAt: Date.now(),
        lobbyDeadline: Date.now() + config.lobbyCountdownMs,
        currentRoundIndex: 0,
        isDraw: false,
      },
      players,
    } satisfies RaceMatch;
  });

const matchesArb: fc.Arbitrary<Map<string, RaceMatch>> = fc
  .array(matchArb, { minLength: 0, maxLength: 10 })
  .map((arr) => {
    const map = new Map<string, RaceMatch>();
    for (const m of arr) {
      map.set(m.room.matchId, m);
    }
    return map;
  });

describe("getOrCreateLobby selection safety (Property 13)", () => {
  it("always returns an open lobby, never a started/full match", () => {
    fc.assert(
      fc.property(matchesArb, (matches) => {
        const preIds = new Set(matches.keys());
        const preSize = matches.size;

        const chosen = getOrCreateLobby(matches, config);

        // (1) The returned match is always in the `lobby` phase and below
        // capacity — never a round/intermission/finished match, never full.
        expect(chosen.room.phase).toBe("lobby");
        expect(chosen.players.size).toBeLessThan(config.maxLobbySize);

        // (2) The chosen match is present in the map.
        expect(matches.get(chosen.room.matchId)).toBe(chosen);

        // (3) Either it was an already-qualifying existing lobby, or it was
        // freshly created and inserted (size grows by exactly one, empty
        // players, lobby phase, correct deadline).
        const preExisting = preIds.has(chosen.room.matchId);
        if (preExisting) {
          expect(matches.size).toBe(preSize);
        } else {
          expect(matches.size).toBe(preSize + 1);
          expect(chosen.players.size).toBe(0);
          expect(chosen.room.currentRoundIndex).toBe(0);
          expect(chosen.room.isDraw).toBe(false);
          expect(chosen.room.lobbyDeadline).toBe(
            chosen.room.createdAt + config.lobbyCountdownMs,
          );
        }

        // (4) A started or full match is never returned: if a qualifying open
        // lobby existed, one such must have been chosen (not a new one).
        const hadQualifyingLobby = Array.from(preIds).some((id) => {
          const m = matches.get(id);
          return (
            m !== undefined &&
            m.room.phase === "lobby" &&
            // pre-existing size (chosen lobby unchanged since caller adds player later)
            m.players.size < config.maxLobbySize
          );
        });
        if (hadQualifyingLobby) {
          expect(preExisting).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
