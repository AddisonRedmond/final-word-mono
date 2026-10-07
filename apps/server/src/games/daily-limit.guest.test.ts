import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in / premium-tiers — Registered users do NOT read
// Mode_Stats; they delegate to the shared realtime daily limit.
//
// Behaviour change (premium tiers): registered users are no longer
// unconditionally permitted. The per-mode seam now routes a registered user to
// the SHARED realtime daily limit (`realtime-daily-limit.ts`: free 3/UTC-day
// across modes, premium unlimited) — it does NOT consult the mode's own stats
// row. Only guests (`isAnonymous === true`) delegate to `guestModeGate`, which
// reads the mode's stats row.
//
// So the invariant this test guards is now: for a registered user, the per-mode
// seam performs NO Mode_Stats read (`db.select` is never called) and the
// decision is whatever the realtime limit returns. We mock the realtime limit
// to isolate the per-mode seam. The guest control case is unchanged: it still
// reads Mode_Stats via `guestModeGate`.
//
// We exercise BOTH mode seams -- `race/daily-limit.ts` and
// `battle-royale/daily-limit.ts` -- since each independently owns this routing.

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

// Stub the shared realtime daily limit so the registered-user path is isolated
// from the mode seam: we control its decision and assert the per-mode seam
// never reads Mode_Stats for a registered user. `canStartRealtimeGame` returns
// a toggle so we can prove the registered decision tracks the realtime limit.
let realtimeAllow = true;
const canStartRealtimeGameSpy = vi.fn(async () => realtimeAllow);
vi.mock("./realtime-daily-limit.js", () => ({
  canStartRealtimeGame: (userId: string) => canStartRealtimeGameSpy(),
  recordRealtimeGameStart: vi.fn(async () => undefined),
}));

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

describe("Daily-limit seam registered-user routing", () => {
  beforeEach(() => {
    nextRows = [];
    realtimeAllow = true;
    selectSpy.mockClear();
    canStartRealtimeGameSpy.mockClear();
  });

  it("routes a registered user to the realtime limit and reads no Mode_Stats, for any stats state (both modes)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...seams),
        // Any Mode_Stats state the per-mode seam COULD have read. A registered
        // user must never trigger that read (the realtime limit reads profiles /
        // realtime_game_usage instead), so this state is irrelevant.
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        // The realtime limit's decision, which the registered path must return.
        fc.boolean(),
        async (userId, seam, maybeGamesPlayed, limitAllow) => {
          nextRows =
            maybeGamesPlayed === null
              ? []
              : [{ gamesPlayed: maybeGamesPlayed }];
          realtimeAllow = limitAllow;
          canStartRealtimeGameSpy.mockClear();
          selectSpy.mockClear();

          const allowed = await seam.canStartMatch(userId, false);

          // The registered decision is exactly what the realtime limit returned,
          // which the seam consulted exactly once...
          expect(allowed).toBe(limitAllow);
          expect(canStartRealtimeGameSpy).toHaveBeenCalledTimes(1);
          // ...and the per-mode seam performed no Mode_Stats read.
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
