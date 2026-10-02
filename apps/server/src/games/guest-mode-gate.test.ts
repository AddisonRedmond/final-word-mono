import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in, Property 10: Guest per-mode gate decision
//
// For any guest and for any state of that guest's Mode_Stats row in a mode, the
// gate permits the start (ALLOW -> true) when no row exists or the row's
// `gamesPlayed < 1`, and blocks the start (BLOCK -> false) when a row exists
// with `gamesPlayed >= 1`. A block is what makes the join flow emit the
// `guest-mode-limit` reason.
//
// `guestModeGate` reads its decision from a mocked `db` stats read, so we mock
// the `db` module: the chainable `db.select(...).from(...).where(...).limit(...)`
// resolves to a scripted rows array that each property run controls.
//
// Validates: Requirements 6.1, 6.3

// The rows the next db read will resolve to. Each run sets this to model a
// particular stats-row state (absent -> [], present -> [{ gamesPlayed }]).
// Property 10 uses this single, table-agnostic script.
let nextRows: Array<{ gamesPlayed: number }> = [];

// Per-table scripted rows, keyed by a table tag ("race" / "br"). When a tag has
// an entry here it takes precedence over `nextRows`, letting Property 11 drive
// each mode's stats read independently. Left empty for Property 10 so the
// existing single-script behaviour is preserved.
const rowsByTable: Record<string, Array<{ gamesPlayed: number }>> = {};

vi.mock("db", () => {
  // raceStats / battleRoyaleStats are only referenced for column identifiers
  // (table.userId, table.gamesPlayed). Each proxy also carries a hidden
  // `__tableTag` so the mocked `from(table)` can tell the two tables apart and
  // resolve each one's own scripted rows.
  const tableProxy = (tag: string) =>
    new Proxy(
      {},
      {
        get: (_t, key) => (key === "__tableTag" ? tag : key),
      },
    );

  const raceStats = tableProxy("race");
  const battleRoyaleStats = tableProxy("br");

  // A chainable stub mirroring
  //   db.select({...}).from(table).where(...).limit(1) -> Promise<rows>.
  // `from(table)` captures which table is being read so the resolved rows can
  // depend on it (per-table script if present, else the shared `nextRows`).
  const select = () => ({
    from: (table: { __tableTag?: string }) => {
      const tag = table?.__tableTag;
      const rows =
        tag !== undefined && tag in rowsByTable ? rowsByTable[tag] : nextRows;
      return {
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      };
    },
  });

  return {
    db: { select },
    raceStats,
    battleRoyaleStats,
    // eq is a passthrough used only to build the (ignored) where clause.
    eq: (col: unknown, value: unknown) => ({ col, value }),
  };
});

// Import AFTER the mock is registered.
const { guestModeGate, GUEST_MODE_LIMIT_REASON } = await import(
  "./guest-mode-gate.js"
);
const { raceStats, battleRoyaleStats } = await import("db");

describe("guestModeGate per-mode decision (Property 10)", () => {
  beforeEach(() => {
    nextRows = [];
  });

  it("ALLOWs when no stats row exists for the guest in the mode", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(raceStats, battleRoyaleStats),
        async (userId, table) => {
          nextRows = []; // absent row

          const allowed = await guestModeGate(userId, table as never);

          expect(allowed).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ALLOWs when a row exists but gamesPlayed < 1", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(raceStats, battleRoyaleStats),
        // gamesPlayed strictly below 1 (0 and defensive negatives).
        fc.integer({ min: -1_000, max: 0 }),
        async (userId, table, gamesPlayed) => {
          nextRows = [{ gamesPlayed }];

          const allowed = await guestModeGate(userId, table as never);

          expect(allowed).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("BLOCKs when a row exists with gamesPlayed >= 1 (join flow would emit guest-mode-limit)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(raceStats, battleRoyaleStats),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (userId, table, gamesPlayed) => {
          nextRows = [{ gamesPlayed }];

          const blocked = await guestModeGate(userId, table as never);

          // false == BLOCK; the join handler maps a block to this reason.
          expect(blocked).toBe(false);
          expect(GUEST_MODE_LIMIT_REASON).toBe("guest-mode-limit");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("decides ALLOW iff absent-or-(gamesPlayed < 1) across any row state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(raceStats, battleRoyaleStats),
        // option<gamesPlayed>: null models an absent row, a number models a
        // present row with that counter.
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, table, maybeGamesPlayed) => {
          nextRows =
            maybeGamesPlayed === null
              ? []
              : [{ gamesPlayed: maybeGamesPlayed }];

          const decision = await guestModeGate(userId, table as never);

          const expectedAllow =
            maybeGamesPlayed === null || maybeGamesPlayed < 1;
          expect(decision).toBe(expectedAllow);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: anonymous-sign-in, Property 11: Per-mode gating is independent across modes
//
// For any pair of per-mode stats states (raceGamesPlayed, brGamesPlayed), the
// Race gate decision depends only on raceGamesPlayed and the Battle Royale gate
// decision depends only on brGamesPlayed; a block in one mode never changes the
// decision in the other.
//
// The db mock is extended to resolve a *different* rows array depending on which
// table `from(table)` receives (keyed by a hidden __tableTag), so each mode's
// read is driven independently. A per-mode state is modelled with option<number>:
// null -> absent row ([]), a number -> present row with that gamesPlayed.
//
// Validates: Requirements 6.4

// Expected per-mode decision: ALLOW iff absent (null) or gamesPlayed < 1.
const expectedModeAllow = (maybeGamesPlayed: number | null): boolean =>
  maybeGamesPlayed === null || maybeGamesPlayed < 1;

// Translate an option<number> state into the scripted rows for one table.
const rowsForState = (
  maybeGamesPlayed: number | null,
): Array<{ gamesPlayed: number }> =>
  maybeGamesPlayed === null ? [] : [{ gamesPlayed: maybeGamesPlayed }];

describe("guestModeGate cross-mode independence (Property 11)", () => {
  beforeEach(() => {
    nextRows = [];
    // Clear any per-table script between runs so each case is isolated.
    delete rowsByTable.race;
    delete rowsByTable.br;
  });

  it("Race decision depends only on race stats; BR decision only on BR stats", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Independent per-mode states (null == absent row).
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, raceGamesPlayed, brGamesPlayed) => {
          // Script each table's read independently.
          rowsByTable.race = rowsForState(raceGamesPlayed);
          rowsByTable.br = rowsForState(brGamesPlayed);

          const raceDecision = await guestModeGate(
            userId,
            raceStats as never,
          );
          const brDecision = await guestModeGate(
            userId,
            battleRoyaleStats as never,
          );

          // Each decision matches the expectation derived from ONLY its own
          // mode's stats — proving the other mode's state had no effect.
          expect(raceDecision).toBe(expectedModeAllow(raceGamesPlayed));
          expect(brDecision).toBe(expectedModeAllow(brGamesPlayed));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flipping one mode's state leaves the other mode's decision unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // The mode we hold fixed, and the two states we flip the other between.
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, fixedRaceState, brStateA, brStateB) => {
          // Hold Race fixed; read it under two different BR states.
          rowsByTable.race = rowsForState(fixedRaceState);

          rowsByTable.br = rowsForState(brStateA);
          const raceUnderA = await guestModeGate(userId, raceStats as never);

          rowsByTable.br = rowsForState(brStateB);
          const raceUnderB = await guestModeGate(userId, raceStats as never);

          // The Race decision is invariant to whatever BR's state was.
          expect(raceUnderA).toBe(raceUnderB);
          expect(raceUnderA).toBe(expectedModeAllow(fixedRaceState));
        },
      ),
      { numRuns: 100 },
    );
  });
});
