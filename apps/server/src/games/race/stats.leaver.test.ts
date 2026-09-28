import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { RaceMatch, RacePhase, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race, Property 12: In-progress leaver placement reflects the field size at the moment of leaving
//
// For any in-progress match and any real player who leaves, that player is
// persisted as a loss (won = false) with a placement equal to the number of
// players still alive (!isEliminated) at the moment of leaving. Bots persist
// nothing, and a leaver in a not-yet-started lobby persists nothing.
//
// `upsertPlayerStat` is not exported, so we mock the `db` module and capture
// the full row every `.insert(raceStats).values({...})` call issues. `won` is
// encoded on the row as `wins` (1 when won, 0 otherwise), so a loss => wins 0.
//
// Validates: Requirements 8.6, 8.7

// The upsert row encodes the leaver's placement as `bestPlacement` /
// `averagePlacement` (both equal to the snapshot placement on a first write)
// and `won` as `wins` (0 for a loss).
type CapturedRow = {
  userId: string;
  wins: number;
  averagePlacement: number;
  bestPlacement: number;
};

// Every values() row the code under test writes, in order.
const inserted: CapturedRow[] = [];

vi.mock("db", () => {
  const insert = () => ({
    values: (row: CapturedRow) => {
      inserted.push(row);
      return { onConflictDoUpdate: () => Promise.resolve(undefined) };
    },
  });

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
const { persistLeaverAsLoss } = await import("./stats.js");

// A deterministic v4-shaped UUID from an integer seed, so generated real-player
// ids pass the code's UUID check.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makePlayer = (fields: Partial<RacePlayer>): RacePlayer => ({
  name: "p",
  isBot: fields.isBot ?? false,
  isEliminated: fields.isEliminated ?? false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: fields.totalGuesses ?? 0,
  correctGuesses: fields.correctGuesses ?? 0,
  eliminatedAt: fields.eliminatedAt,
});

const IN_PROGRESS_PHASES: RacePhase[] = ["round", "intermission", "finished"];

describe("persistLeaverAsLoss placement reflects field size (Property 12)", () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it("records a real in-progress leaver as a loss at the alive-count placement, and no-ops for bots and lobby", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Real players in the field: seed -> UUID id, plus whether eliminated.
        fc.uniqueArray(
          fc.record({
            seed: fc.integer({ min: 1, max: 100_000 }),
            isEliminated: fc.boolean(),
          }),
          {
            minLength: 1,
            maxLength: 6,
            selector: (r) => r.seed,
          },
        ),
        // Bots mixed into the same field, each maybe eliminated.
        fc.array(fc.boolean(), { maxLength: 6 }),
        // Phase of the match.
        fc.constantFrom<RacePhase>("lobby", "round", "intermission", "finished"),
        // Which of the field's members leaves (index into the full field).
        fc.integer({ min: 0, max: 100 }),
        async (reals, botElims, phase, leaverPick) => {
          inserted.length = 0;

          const players = new Map<string, RacePlayer>();
          const realIds: string[] = [];
          for (const { seed, isEliminated } of reals) {
            const id = uuidFromSeed(seed);
            realIds.push(id);
            players.set(id, makePlayer({ isEliminated }));
          }
          const botIds: string[] = [];
          botElims.forEach((isEliminated, i) => {
            const id = `bot${i}`;
            botIds.push(id);
            players.set(id, makePlayer({ isBot: true, isEliminated }));
          });

          const allIds = [...realIds, ...botIds];
          const leaverId = allIds[leaverPick % allIds.length];
          const leaver = players.get(leaverId) as RacePlayer;

          const match: RaceMatch = {
            room: {
              matchId: "m1",
              phase,
              createdAt: 0,
              lobbyDeadline: 0,
              currentRoundIndex: 0,
              isDraw: false,
            },
            players,
          };

          // Alive count at the moment of leaving (leaver still present).
          const aliveNow = Array.from(players.values()).filter(
            (p) => !p.isEliminated,
          ).length;

          const isRealLeaver = realIds.includes(leaverId);
          const inProgress = phase !== "lobby";

          await persistLeaverAsLoss(match, leaverId);

          if (isRealLeaver && inProgress) {
            // Exactly one upsert, for the leaver, recorded as a loss.
            expect(inserted.length).toBe(1);
            expect(inserted[0].userId).toBe(leaverId);
            // Loss => wins increment is 0.
            expect(inserted[0].wins).toBe(0);
            // Placement === alive (!isEliminated) count, leaver included.
            expect(inserted[0].averagePlacement).toBe(aliveNow);
            expect(inserted[0].bestPlacement).toBe(aliveNow);
          } else {
            // Bot leaver (Req 8.7) or lobby leaver (Req 8.7): nothing persisted.
            expect(inserted.length).toBe(0);
          }

          // Sanity: the leaver referenced above is the one we picked.
          expect(leaver.isBot).toBe(!isRealLeaver);
        },
      ),
      { numRuns: 100 },
    );
  });
});
