import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race, Property 11: Only real players are persisted
//
// For any finished match whose field mixes UUID-keyed real players and non-UUID
// bot identifiers, the set of players written to `raceStats` contains exactly
// the UUID-keyed real players and no bots.
//
// `rankPlayers` is not exported, so we mock the `db` module and capture the
// `userId` on every `.insert(...).values({ userId })` call `persistRaceStats`
// makes, then assert the captured set equals exactly the UUID-keyed ids.
//
// Validates: Requirements 8.4

// Records the userId of every values() call the code under test issues.
const insertedUserIds: string[] = [];

vi.mock("db", () => {
  // A chainable stub mirroring db.insert(raceStats).values({...}).onConflictDoUpdate({...}).
  const insert = () => ({
    values: (row: { userId: string }) => {
      insertedUserIds.push(row.userId);
      return { onConflictDoUpdate: () => Promise.resolve(undefined) };
    },
  });

  // raceStats is only referenced for column identifiers; a plain object with the
  // accessed keys is enough. sql is a passthrough tag that never runs here.
  return {
    db: { insert },
    raceStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

// Import AFTER the mock is registered.
const { persistRaceStats } = await import("./stats.js");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A deterministic v4-shaped UUID from an integer seed, so generated real-player
// ids are guaranteed to pass the UUID check the code uses.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makePlayer = (fields: Partial<RacePlayer>): RacePlayer => ({
  name: "p",
  isBot: fields.isBot ?? false,
  isEliminated: false,
  completedWords: fields.completedWords ?? 0,
  qualified: false,
  roundGuesses: fields.roundGuesses ?? 0,
  totalGuesses: fields.totalGuesses ?? 0,
  correctGuesses: fields.correctGuesses ?? 0,
  eliminatedAt: fields.eliminatedAt,
});

describe("persistRaceStats persists only real players (Property 11)", () => {
  beforeEach(() => {
    insertedUserIds.length = 0;
  });

  it("writes exactly the UUID-keyed players and no bots", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Distinct real-player seeds -> UUID ids (at least one so there is work).
        fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), {
          minLength: 1,
          maxLength: 6,
        }),
        // Number of bots mixed into the same field, keyed bot0, bot1, …
        fc.integer({ min: 0, max: 6 }),
        // Whether the match is a draw (exercises both ranking branches).
        fc.boolean(),
        // Per-player varied fields, plus which index wins.
        fc.record({
          eliminatedAt: fc.integer({ min: 0, max: 1_000_000 }),
          completedWords: fc.integer({ min: 0, max: 20 }),
          roundGuesses: fc.integer({ min: 0, max: 50 }),
          totalGuesses: fc.integer({ min: 0, max: 200 }),
          correctGuesses: fc.integer({ min: 0, max: 200 }),
          winnerPick: fc.integer({ min: 0, max: 100 }),
        }),
        async (realSeeds, botCount, isDraw, f) => {
          insertedUserIds.length = 0;

          const realIds = realSeeds.map(uuidFromSeed);
          const botIds = Array.from({ length: botCount }, (_, i) => `bot${i}`);

          const players = new Map<string, RacePlayer>();
          for (const id of realIds) {
            players.set(
              id,
              makePlayer({
                eliminatedAt: f.eliminatedAt,
                completedWords: f.completedWords,
                roundGuesses: f.roundGuesses,
                totalGuesses: f.totalGuesses,
                correctGuesses: f.correctGuesses,
              }),
            );
          }
          for (const id of botIds) {
            players.set(
              id,
              makePlayer({
                isBot: true,
                eliminatedAt: f.eliminatedAt,
                completedWords: f.completedWords,
                roundGuesses: f.roundGuesses,
                totalGuesses: f.totalGuesses,
                correctGuesses: f.correctGuesses,
              }),
            );
          }

          // Pick a winner across the full field (may be a bot or a real player)
          // when not a draw, to exercise the non-draw ranking branch.
          const allIds = [...realIds, ...botIds];
          const winnerId = isDraw
            ? undefined
            : allIds[f.winnerPick % allIds.length];

          const match: RaceMatch = {
            room: {
              matchId: "m1",
              phase: "finished",
              createdAt: 0,
              lobbyDeadline: 0,
              currentRoundIndex: 0,
              winnerId,
              isDraw,
            },
            players,
          };

          await persistRaceStats(match);

          const persisted = new Set(insertedUserIds);
          const expected = new Set(realIds);

          // Every persisted id is a real UUID (never a bot).
          for (const id of persisted) {
            expect(UUID_RE.test(id)).toBe(true);
          }
          // The persisted set equals exactly the real players.
          expect(persisted).toEqual(expected);
          // No duplicate writes per user.
          expect(insertedUserIds.length).toBe(realIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
