import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in, Property 12: Registered users bypass the gate without reading stats
//
// For any Mode_Stats state, a non-anonymous (registered) user is permitted to
// start a match AND the Daily_Limit_Seam performs no Mode_Stats read for that
// user. The seam short-circuits to `true` before ever touching the stats table
// (R6.8); only guests (`isAnonymous === true`) delegate to `guestModeGate`,
// which reads the mode's stats row.
//
// We exercise BOTH mode seams -- `race/daily-limit.ts` and
// `battle-royale/daily-limit.ts` -- since each independently owns the registered-
// user short-circuit. The `db` module is mocked (as guest-mode-gate.test.ts does)
// and `db.select` is a spy: for a registered user we assert it is NEVER called;
// for a guest we assert it IS called, proving the spy actually observes reads.
//
// Validates: Requirements 6.8

// The rows the next mocked stats read will resolve to. Only the guest path
// (control case) ever reaches a read; registered runs must never consult this.
let nextRows: Array<{ gamesPlayed: number }> = [];

// Spy on the stats read. The mocked `db.select` records every invocation so a
// property run can assert the registered-user path performed zero reads.
const selectSpy = vi.fn(() => ({
  from: () => ({
    where: () => ({
      limit: () => Promise.resolve(nextRows),
    }),
  }),
}));

vi.mock("db", () => {
  // raceStats / battleRoyaleStats are referenced only for column identifiers
  // (table.userId, table.gamesPlayed); plain proxies suffice.
  const tableProxy = () =>
    new Proxy(
      {},
      {
        get: (_t, key) => key,
      },
    );

  return {
    db: { select: selectSpy },
    raceStats: tableProxy(),
    battleRoyaleStats: tableProxy(),
    // eq is a passthrough used only to build the (ignored) where clause.
    eq: (col: unknown, value: unknown) => ({ col, value }),
  };
});

// Import AFTER the mock is registered.
const raceSeam = await import("./race/daily-limit.js");
const brSeam = await import("./battle-royale/daily-limit.js");

// Both mode seams expose the same `canStartMatch(userId, isAnonymous)` shape;
// we drive the property across both to prove each seam owns the bypass.
const seams: Array<{
  name: string;
  canStartMatch: (userId: string, isAnonymous: boolean) => Promise<boolean>;
}> = [
  { name: "race", canStartMatch: raceSeam.canStartMatch },
  { name: "battle-royale", canStartMatch: brSeam.canStartMatch },
];

describe("Daily-limit seam registered-user bypass (Property 12)", () => {
  beforeEach(() => {
    nextRows = [];
    selectSpy.mockClear();
  });

  it("permits a registered user and reads no Mode_Stats, for any stats state (both modes)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...seams),
        // Any stats state the gate COULD have read: absent (null), or a present
        // row with an arbitrary gamesPlayed (including values that would BLOCK a
        // guest). A registered user must be permitted regardless and must never
        // trigger the read, so this state is irrelevant to the outcome.
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, seam, maybeGamesPlayed) => {
          nextRows =
            maybeGamesPlayed === null
              ? []
              : [{ gamesPlayed: maybeGamesPlayed }];

          const allowed = await seam.canStartMatch(userId, false);

          // Registered users are always permitted (R6.8)...
          expect(allowed).toBe(true);
          // ...and the gate performed no Mode_Stats read.
          expect(selectSpy).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("guest control case: the gate DOES read Mode_Stats (proves the spy observes reads)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...seams),
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, seam, maybeGamesPlayed) => {
          selectSpy.mockClear();
          nextRows =
            maybeGamesPlayed === null
              ? []
              : [{ gamesPlayed: maybeGamesPlayed }];

          const decision = await seam.canStartMatch(userId, true);

          // A guest delegates to guestModeGate, which reads the stats table.
          expect(selectSpy).toHaveBeenCalledTimes(1);
          // Sanity: the decision tracks the guest one-game-per-mode rule
          // (ALLOW iff absent or gamesPlayed < 1), confirming the read drove it.
          const expectedAllow =
            maybeGamesPlayed === null || maybeGamesPlayed < 1;
          expect(decision).toBe(expectedAllow);
        },
      ),
      { numRuns: 100 },
    );
  });
});
