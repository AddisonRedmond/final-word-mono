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
// The gate now reads the unified `player_mode_stats` table and distinguishes
// modes via a `where mode = $mode` filter (plus `scope = 'lifetime'`), NOT by
// choosing a different table. So the mock captures the `mode` value out of the
// composed where clause and resolves that mode's scripted rows.
//
// Validates: Requirements 6.1, 6.3

// The rows the next db read will resolve to. Each run sets this to model a
// particular stats-row state (absent -> [], present -> [{ gamesPlayed }]).
// Property 10 uses this single, mode-agnostic script.
let nextRows: Array<{ gamesPlayed: number }> = [];

// Per-mode scripted rows, keyed by the GameMode string ("race" /
// "battle_royale"). When a mode has an entry here it takes precedence over
// `nextRows`, letting Property 11 drive each mode's stats read independently.
// Left empty for Property 10 so the single-script behaviour is preserved.
const rowsByMode: Record<string, Array<{ gamesPlayed: number }>> = {};

vi.mock("db", () => {
  // playerModeStats is only referenced for column identifiers; the proxy
  // returns the property key as the column id (e.g. playerModeStats.mode ->
  // "mode"), so a captured eq can be matched to the column it filters on.
  const playerModeStats = new Proxy({}, { get: (_t, key) => key });

  // A chainable stub mirroring
  //   db.select({...}).from(table).where(and(...)).limit(1) -> Promise<rows>.
  // `where(clause)` pulls the mode out of the composed and() so the resolved
  // rows can depend on it (per-mode script if present, else shared `nextRows`).
  const select = () => ({
    from: () => ({
      where: (clause: { and?: Array<{ col: unknown; value: unknown }> }) => {
        const modeEq = clause.and?.find((c) => c.col === "mode");
        const mode = modeEq?.value as string | undefined;
        const rows =
          mode !== undefined && mode in rowsByMode ? rowsByMode[mode] : nextRows;
        return {
          limit: () => Promise.resolve(rows),
        };
      },
    }),
  });

  return {
    db: { select },
    playerModeStats,
    LIFETIME_SCOPE: "lifetime",
    // eq is a passthrough recording the column + value it compared.
    eq: (col: unknown, value: unknown) => ({ col, value }),
    // and collects its predicate args so where() can inspect them.
    and: (...clauses: Array<{ col: unknown; value: unknown }>) => ({
      and: clauses,
    }),
  };
});

// Import AFTER the mock is registered.
const { guestModeGate, GUEST_MODE_LIMIT_REASON } = await import(
  "./guest-mode-gate.js"
);

// The two scored modes the gate is exercised with, as plain GameMode strings.
const RACE = "race" as const;
const BATTLE_ROYALE = "battle_royale" as const;

describe("guestModeGate per-mode decision (Property 10)", () => {
  beforeEach(() => {
    nextRows = [];
  });

  it("ALLOWs when no stats row exists for the guest in the mode", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(RACE, BATTLE_ROYALE),
        async (userId, mode) => {
          nextRows = []; // absent row

          const allowed = await guestModeGate(userId, mode);

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
        fc.constantFrom(RACE, BATTLE_ROYALE),
        // gamesPlayed strictly below 1 (0 and defensive negatives).
        fc.integer({ min: -1_000, max: 0 }),
        async (userId, mode, gamesPlayed) => {
          nextRows = [{ gamesPlayed }];

          const allowed = await guestModeGate(userId, mode);

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
        fc.constantFrom(RACE, BATTLE_ROYALE),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (userId, mode, gamesPlayed) => {
          nextRows = [{ gamesPlayed }];

          const blocked = await guestModeGate(userId, mode);

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
        fc.constantFrom(RACE, BATTLE_ROYALE),
        // option<gamesPlayed>: null models an absent row, a number models a
        // present row with that counter.
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, mode, maybeGamesPlayed) => {
          nextRows =
            maybeGamesPlayed === null
              ? []
              : [{ gamesPlayed: maybeGamesPlayed }];

          const decision = await guestModeGate(userId, mode);

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
// The db mock is extended to resolve a *different* rows array depending on the
// `mode` captured from the where clause (keyed in `rowsByMode`), so each mode's
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
    // Clear any per-mode script between runs so each case is isolated.
    delete rowsByMode.race;
    delete rowsByMode.battle_royale;
  });

  it("Race decision depends only on race stats; BR decision only on BR stats", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Independent per-mode states (null == absent row).
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        fc.option(fc.integer({ min: -1_000, max: 1_000_000 }), { nil: null }),
        async (userId, raceGamesPlayed, brGamesPlayed) => {
          // Script each mode's read independently.
          rowsByMode.race = rowsForState(raceGamesPlayed);
          rowsByMode.battle_royale = rowsForState(brGamesPlayed);

          const raceDecision = await guestModeGate(userId, RACE);
          const brDecision = await guestModeGate(userId, BATTLE_ROYALE);

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
          rowsByMode.race = rowsForState(fixedRaceState);

          rowsByMode.battle_royale = rowsForState(brStateA);
          const raceUnderA = await guestModeGate(userId, RACE);

          rowsByMode.battle_royale = rowsForState(brStateB);
          const raceUnderB = await guestModeGate(userId, RACE);

          // The Race decision is invariant to whatever BR's state was.
          expect(raceUnderA).toBe(raceUnderB);
          expect(raceUnderA).toBe(expectedModeAllow(fixedRaceState));
        },
      ),
      { numRuns: 100 },
    );
  });
});
