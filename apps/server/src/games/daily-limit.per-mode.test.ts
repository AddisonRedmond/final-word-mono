import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in
//
// Integration test for per-mode stats selection in the daily-limit seams.
//
// The two mode seams (`race/daily-limit.ts`, `battle-royale/daily-limit.ts`)
// delegate a guest's one-game-per-mode decision to the shared `guestModeGate`.
// The gate now reads the UNIFIED `player_mode_stats` table and distinguishes
// modes by a `where mode = $mode` filter (plus `scope = 'lifetime'`), NOT by
// choosing a different table:
//   - Race          -> reads player_mode_stats WHERE mode = 'race'
//   - Battle Royale -> reads player_mode_stats WHERE mode = 'battle_royale'
//
// Because each seam filters on its own mode, a block in one mode (that mode's
// lifetime row has `gamesPlayed >= 1`) must leave the OTHER mode startable when
// the other mode has no row.
//
// We mock the `db` module like guest-mode-gate.test.ts: the chainable
// select().from().where(and(...)).limit() captures the `mode` out of the
// composed where clause, records it, and resolves that mode's own scripted
// rows. This lets us assert BOTH which mode each seam filtered on and that the
// per-mode decisions are independent.
//
// Validates: Requirements 6.2, 6.4

// Per-mode scripted rows, keyed by the GameMode string. A missing entry models
// an absent row ([] -> ALLOW); an entry with { gamesPlayed } models a present row.
let rowsByMode: Record<string, Array<{ gamesPlayed: number }>> = {};

// Records the `mode` captured from every where clause, in order, so a test can
// assert which mode a seam actually filtered on (and which it never did).
let readModes: string[] = [];

vi.mock("db", () => {
  // playerModeStats behaves like a bag of column identifiers; property access
  // returns the key (playerModeStats.mode -> "mode") so a captured eq can be
  // matched to the column it filters on.
  const playerModeStats = new Proxy({}, { get: (_t, key) => key });

  // Chainable stub mirroring
  //   db.select({...}).from(table).where(and(...)).limit(1) -> Promise<rows>.
  // `where(clause)` pulls the mode out of the composed and(), records it, and
  // resolves that mode's scripted rows.
  const select = () => ({
    from: () => ({
      where: (clause: { and?: Array<{ col: unknown; value: unknown }> }) => {
        const modeEq = clause.and?.find((c) => c.col === "mode");
        const mode = (modeEq?.value as string | undefined) ?? "<unknown>";
        readModes.push(mode);
        const rows = rowsByMode[mode] ?? [];
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
    eq: (col: unknown, value: unknown) => ({ col, value }),
    and: (...clauses: Array<{ col: unknown; value: unknown }>) => ({
      and: clauses,
    }),
  };
});

// Import AFTER the mock is registered.
const raceSeam = await import("./race/daily-limit.js");
const brSeam = await import("./battle-royale/daily-limit.js");

const GUEST_USER_ID = "11111111-1111-4111-8111-111111111111";

describe("Daily-limit seam per-mode stats selection (R6.2, R6.4)", () => {
  beforeEach(() => {
    rowsByMode = {};
    readModes = [];
  });

  it("Race's gate filters player_mode_stats on mode='race' and never 'battle_royale'", async () => {
    // No rows anywhere -> ALLOW; we only care which mode was filtered on.
    await raceSeam.canStartMatch(GUEST_USER_ID, true);

    expect(readModes).toEqual(["race"]);
    expect(readModes).not.toContain("battle_royale");
  });

  it("Battle Royale's gate filters on mode='battle_royale' and never 'race'", async () => {
    await brSeam.canStartMatch(GUEST_USER_ID, true);

    expect(readModes).toEqual(["battle_royale"]);
    expect(readModes).not.toContain("race");
  });

  it("a block in Race leaves Battle Royale startable (and vice versa)", async () => {
    // Script a BLOCK in Race (gamesPlayed >= 1) while BR has no row.
    rowsByMode = {
      race: [{ gamesPlayed: 1 }],
      // battle_royale intentionally absent -> [] -> ALLOW.
    };

    const raceDecision = await raceSeam.canStartMatch(GUEST_USER_ID, true);
    const brDecision = await brSeam.canStartMatch(GUEST_USER_ID, true);

    // Race is blocked by its own row; BR, with no row, remains startable.
    expect(raceDecision).toBe(false);
    expect(brDecision).toBe(true);

    // Each seam filtered only on its own mode.
    expect(readModes).toEqual(["race", "battle_royale"]);
  });

  it("a block in Battle Royale leaves Race startable", async () => {
    // Script a BLOCK in BR (gamesPlayed >= 1) while Race has no row.
    rowsByMode = {
      battle_royale: [{ gamesPlayed: 1 }],
      // race intentionally absent -> [] -> ALLOW.
    };

    const brDecision = await brSeam.canStartMatch(GUEST_USER_ID, true);
    const raceDecision = await raceSeam.canStartMatch(GUEST_USER_ID, true);

    // BR is blocked by its own row; Race, with no row, remains startable.
    expect(brDecision).toBe(false);
    expect(raceDecision).toBe(true);

    expect(readModes).toEqual(["battle_royale", "race"]);
  });
});
