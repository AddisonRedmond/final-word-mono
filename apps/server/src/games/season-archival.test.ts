import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compareSeasonRanking,
  rankSeasonRows,
  type PlayerModeStats,
  type ScoredMode,
} from "db";

// Feature: retention-foundation, Task 3.2 — Season archival ranking properties.
//
// Archival snapshots a finished season's standings into `season_placements`.
// Its deterministic heart is the pair of PURE functions in
// `packages/db/src/season-archival.ts`:
//   - `compareSeasonRanking(a, b)` — the total order a season board is ranked by
//     (seasonPoints DESC, wins DESC, averagePlacement ASC nulls-last,
//     gamesPlayed DESC, userId ASC).
//   - `rankSeasonRows(rows, mode, season)` — ranks a mode's seasonal rows into
//     dense 1-based placements WITHOUT mutating the input array (a proxy for the
//     guarantee that archival never touches `player_mode_stats`).
//
// `packages/db` has no test runner wired up, so — like the sibling
// `match-points.test.ts` for Task 2.1 — this suite lives in `apps/server` and
// imports the functions through the `db` workspace package. The two functions
// are the deterministic core of archival; testing them directly exercises
// idempotency, non-mutation and deterministic tiebreaks without a database.
//
// Validates: Requirements 4.5

const MODE: ScoredMode = "battle_royale";
const SEASON = "2026-10";

// A zeroed `player_mode_stats` seasonal row; tests override only the fields that
// drive ranking. Keeps generators focused on the ranking inputs while producing
// values that satisfy the full `PlayerModeStats` shape.
const makeRow = (over: Partial<PlayerModeStats>): PlayerModeStats => ({
  userId: "00000000-0000-0000-0000-000000000000",
  mode: MODE,
  scope: SEASON,
  gamesPlayed: 0,
  wins: 0,
  draws: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  wonLastGame: false,
  totalGuesses: 0,
  totalCorrectGuesses: 0,
  averagePlacement: null,
  bestPlacement: null,
  solveCount: 0,
  totalSolveMs: 0,
  fastestSolveMs: null,
  seasonPoints: 0,
  bestMatchPoints: 0,
  lastPlayedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

// fast-check generator for a ranking-relevant seasonal row. userIds are unique
// hex-ish strings so the final userId tiebreak is always decisive. The index is
// zero-padded so lexical order over the generated ids is well defined.
const rowArb = (index: number): fc.Arbitrary<PlayerModeStats> =>
  fc.record({
    seasonPoints: fc.integer({ min: 0, max: 500 }),
    wins: fc.integer({ min: 0, max: 50 }),
    averagePlacement: fc.option(fc.float({ min: 1, max: 20, noNaN: true }), {
      nil: null,
    }),
    gamesPlayed: fc.integer({ min: 0, max: 200 }),
  }).map((fields) =>
    makeRow({
      ...fields,
      userId: `user-${String(index).padStart(4, "0")}`,
    }),
  );

// A set of distinct rows (distinct userIds via the index).
const rowsArb = (max = 12): fc.Arbitrary<PlayerModeStats[]> =>
  fc.integer({ min: 0, max }).chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => rowArb(i))),
  );

// A deep snapshot of only the fields that could conceivably be mutated during
// ranking, for before/after equality checks.
const snapshot = (rows: PlayerModeStats[]) =>
  rows.map((r) => ({ ...r }));

describe("season archival ranking (Task 3.2)", () => {
  // R4.5: deterministic + reproducible. Re-running archival for a season must
  // yield IDENTICAL placements — same ranks in the same order, every time.
  it("is idempotent: re-ranking the same rows yields identical placements", () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const first = rankSeasonRows(rows, MODE, SEASON);
        const second = rankSeasonRows(rows, MODE, SEASON);
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  // R4.5: archival records placements but does NOT discard/alter the underlying
  // aggregates. `rankSeasonRows` copies before sorting, so the caller's array
  // (a stand-in for the retained `player_mode_stats` rows) is never mutated —
  // neither the array order nor any row's fields.
  it("never mutates the input rows (proxy for not touching player_mode_stats)", () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const before = snapshot(rows);
        rankSeasonRows(rows, MODE, SEASON);
        // Same length, same order, same field values after ranking.
        expect(rows).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });

  // R4.5: placements are dense and 1-based (1 = best) with no gaps or dupes,
  // regardless of input order — a well-formed final standing.
  it("produces dense, 1-based placements covering every input row exactly once", () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const ranked = rankSeasonRows(rows, MODE, SEASON);
        expect(ranked).toHaveLength(rows.length);
        const placements = ranked.map((p) => p.placement);
        expect(placements).toEqual(
          Array.from({ length: rows.length }, (_, i) => i + 1),
        );
        // Every input userId appears exactly once in the output.
        expect(new Set(ranked.map((p) => p.userId))).toEqual(
          new Set(rows.map((r) => r.userId)),
        );
      }),
      { numRuns: 200 },
    );
  });

  // R4.5: ordering is independent of the order rows arrive in. Shuffling the
  // input must not change who ends up at which placement — a prerequisite for a
  // stable, reproducible archive.
  it("ranks the same regardless of input order", () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const forward = rankSeasonRows(rows, MODE, SEASON);
        const reversed = rankSeasonRows([...rows].reverse(), MODE, SEASON);
        // Map userId -> placement must match across both input orders.
        const toMap = (ps: ReturnType<typeof rankSeasonRows>) =>
          Object.fromEntries(ps.map((p) => [p.userId, p.placement]));
        expect(toMap(reversed)).toEqual(toMap(forward));
      }),
      { numRuns: 200 },
    );
  });

  // The comparator is a strict, consistent total order: for any two DISTINCT
  // rows exactly one ranks ahead (never a 0 "tie" — userId breaks everything),
  // and the order is antisymmetric (compare(a,b) and compare(b,a) disagree).
  it("compareSeasonRanking is a strict total order down to userId", () => {
    fc.assert(
      fc.property(rowArb(0), rowArb(1), (a, b) => {
        const ab = compareSeasonRanking(a, b);
        const ba = compareSeasonRanking(b, a);
        // Distinct userIds => never a tie, and strictly antisymmetric sign.
        expect(ab).not.toBe(0);
        expect(Math.sign(ab)).toBe(-Math.sign(ba));
      }),
      { numRuns: 200 },
    );
  });

  describe("tiebreak chain (examples)", () => {
    // Rows identical on every field except the one tiebreak under test, so each
    // example pins exactly one level of the chain.
    const base = {
      seasonPoints: 100,
      wins: 5,
      averagePlacement: 3,
      gamesPlayed: 20,
    };

    it("ranks higher seasonPoints first", () => {
      const hi = makeRow({ ...base, seasonPoints: 200, userId: "u-a" });
      const lo = makeRow({ ...base, seasonPoints: 100, userId: "u-b" });
      const ranked = rankSeasonRows([lo, hi], MODE, SEASON);
      expect(ranked.map((p) => p.userId)).toEqual(["u-a", "u-b"]);
    });

    it("breaks equal points by wins DESC", () => {
      const more = makeRow({ ...base, wins: 9, userId: "u-a" });
      const fewer = makeRow({ ...base, wins: 2, userId: "u-b" });
      const ranked = rankSeasonRows([fewer, more], MODE, SEASON);
      expect(ranked.map((p) => p.userId)).toEqual(["u-a", "u-b"]);
    });

    it("breaks equal points+wins by averagePlacement ASC (nulls last)", () => {
      const better = makeRow({ ...base, averagePlacement: 1.5, userId: "u-a" });
      const worse = makeRow({ ...base, averagePlacement: 8.0, userId: "u-b" });
      const none = makeRow({ ...base, averagePlacement: null, userId: "u-c" });
      const ranked = rankSeasonRows([none, worse, better], MODE, SEASON);
      // Lower average first; the null (never placed) sorts last.
      expect(ranked.map((p) => p.userId)).toEqual(["u-a", "u-b", "u-c"]);
    });

    it("breaks ties above by gamesPlayed DESC", () => {
      const more = makeRow({ ...base, gamesPlayed: 50, userId: "u-a" });
      const fewer = makeRow({ ...base, gamesPlayed: 10, userId: "u-b" });
      const ranked = rankSeasonRows([fewer, more], MODE, SEASON);
      expect(ranked.map((p) => p.userId)).toEqual(["u-a", "u-b"]);
    });

    it("breaks a complete tie by userId ASC (fully deterministic)", () => {
      // Identical on every ranking field: only userId can decide.
      const z = makeRow({ ...base, userId: "u-z" });
      const a = makeRow({ ...base, userId: "u-a" });
      const ranked = rankSeasonRows([z, a], MODE, SEASON);
      expect(ranked.map((p) => p.userId)).toEqual(["u-a", "u-z"]);
    });
  });

  it("snapshots seasonPoints as the rankingValue for scored modes", () => {
    const row = makeRow({ seasonPoints: 123, userId: "u-a" });
    const [placement] = rankSeasonRows([row], MODE, SEASON);
    expect(placement.rankingValue).toBe(123);
    expect(placement.placement).toBe(1);
    expect(placement.mode).toBe(MODE);
    expect(placement.season).toBe(SEASON);
  });
});
