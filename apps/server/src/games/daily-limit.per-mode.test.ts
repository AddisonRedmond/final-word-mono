import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in
//
// Integration test for per-mode table selection in the daily-limit seams.
//
// The two mode seams (`race/daily-limit.ts`, `battle-royale/daily-limit.ts`)
// delegate a guest's one-game-per-mode decision to the shared `guestModeGate`,
// which must read the *mode's own* aggregate stats table:
//   - Race   -> `race_stats`            (never `battle_royale_stats`)
//   - Battle Royale -> `battle_royale_stats` (never `race_stats`)
//
// Because the gate derives its decision from the mode's own table, a block in
// one mode (that mode's row has `gamesPlayed >= 1`) must leave the OTHER mode
// startable when the other mode has no row.
//
// We mock the `db` module exactly as guest-mode-gate.test.ts does: each stats
// table proxy carries a hidden `__tableTag` ("race" / "br") so the mocked
// `from(table)` can tell which table was queried, record it, and resolve that
// table's own scripted rows. This lets us assert BOTH which table each seam
// touched and that the per-mode decisions are independent.
//
// Validates: Requirements 6.2, 6.4

// Per-table scripted rows, keyed by the table tag. A missing entry models an
// absent row ([] -> ALLOW); an entry with { gamesPlayed } models a present row.
let rowsByTag: Record<string, Array<{ gamesPlayed: number }>> = {};

// Records the tag of every table passed to `from(table)`, in order, so a test
// can assert which stats table a seam actually read (and which it never did).
let readTags: string[] = [];

vi.mock("db", () => {
  // Each table proxy answers `__tableTag` with its mode tag and otherwise
  // behaves like a bag of column identifiers (table.userId, table.gamesPlayed).
  const tableProxy = (tag: string) =>
    new Proxy(
      {},
      {
        get: (_t, key) => (key === "__tableTag" ? tag : key),
      },
    );

  const raceStats = tableProxy("race");
  const battleRoyaleStats = tableProxy("br");

  // Chainable stub mirroring
  //   db.select({...}).from(table).where(...).limit(1) -> Promise<rows>.
  // `from(table)` records the table's tag and resolves that tag's scripted rows.
  const select = () => ({
    from: (table: { __tableTag?: string }) => {
      const tag = table?.__tableTag ?? "<unknown>";
      readTags.push(tag);
      const rows = rowsByTag[tag] ?? [];
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
    eq: (col: unknown, value: unknown) => ({ col, value }),
  };
});

// Import AFTER the mock is registered.
const raceSeam = await import("./race/daily-limit.js");
const brSeam = await import("./battle-royale/daily-limit.js");

const GUEST_USER_ID = "11111111-1111-4111-8111-111111111111";

describe("Daily-limit seam per-mode table selection (R6.2, R6.4)", () => {
  beforeEach(() => {
    rowsByTag = {};
    readTags = [];
  });

  it("Race's gate reads race_stats and never battle_royale_stats", async () => {
    // No rows anywhere -> ALLOW; we only care which table was consulted.
    await raceSeam.canStartMatch(GUEST_USER_ID, true);

    expect(readTags).toEqual(["race"]);
    expect(readTags).not.toContain("br");
  });

  it("Battle Royale's gate reads battle_royale_stats and never race_stats", async () => {
    await brSeam.canStartMatch(GUEST_USER_ID, true);

    expect(readTags).toEqual(["br"]);
    expect(readTags).not.toContain("race");
  });

  it("a block in Race leaves Battle Royale startable (and vice versa)", async () => {
    // Script a BLOCK in Race (gamesPlayed >= 1) while BR has no row.
    rowsByTag = {
      race: [{ gamesPlayed: 1 }],
      // br intentionally absent -> [] -> ALLOW.
    };

    const raceDecision = await raceSeam.canStartMatch(GUEST_USER_ID, true);
    const brDecision = await brSeam.canStartMatch(GUEST_USER_ID, true);

    // Race is blocked by its own row; BR, with no row, remains startable.
    expect(raceDecision).toBe(false);
    expect(brDecision).toBe(true);

    // Each seam consulted only its own mode's table.
    expect(readTags).toEqual(["race", "br"]);
  });

  it("a block in Battle Royale leaves Race startable", async () => {
    // Script a BLOCK in BR (gamesPlayed >= 1) while Race has no row.
    rowsByTag = {
      br: [{ gamesPlayed: 1 }],
      // race intentionally absent -> [] -> ALLOW.
    };

    const brDecision = await brSeam.canStartMatch(GUEST_USER_ID, true);
    const raceDecision = await raceSeam.canStartMatch(GUEST_USER_ID, true);

    // BR is blocked by its own row; Race, with no row, remains startable.
    expect(brDecision).toBe(false);
    expect(raceDecision).toBe(true);

    expect(readTags).toEqual(["br", "race"]);
  });
});
