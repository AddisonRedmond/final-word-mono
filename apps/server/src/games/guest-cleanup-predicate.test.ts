import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Feature: anonymous-sign-in, Property 13: Cleanup predicate selects only aged
// anonymous accounts
//
// The scheduled cleanup job (supabase/migrations/*_guest_cleanup.sql) deletes
// rows from auth.users with the SQL WHERE clause:
//
//   is_anonymous = true AND now() - created_at > interval '24 hours'
//
// This test models that WHERE clause as a PURE predicate and asserts the two
// guarantees the SQL makes (R8.2):
//   1. ONLY rows with is_anonymous === true AND age strictly greater than 24h
//      are selected.
//   2. No row with is_anonymous === false or null is EVER selected, regardless
//      of its age.
// It also pins the strict (>) boundary: a row aged exactly 24h is NOT selected,
// matching `> interval '24 hours'` rather than `>=`.
//
// Validates: Requirements 8.2

// A fixed reference "now" (ms since epoch). created_at is modelled relative to
// this so a run can place a row at any age without wall-clock flakiness. SQL
// computes age as now() - created_at, so a row's age in hours is:
//   (NOW_MS - createdAtMs) / 3_600_000.
const NOW_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const MS_PER_HOUR = 60 * 60 * 1000;
const AGE_THRESHOLD_HOURS = 24;

// A modelled auth.users row: only the two columns the WHERE clause reads.
// is_anonymous mirrors the DB's three observed states — true, false, null.
type UserRow = {
  isAnonymous: boolean | null;
  createdAtMs: number;
};

// Pure model of the SQL WHERE clause. ageHours = (now - created_at) in hours.
// Selected iff the row is a true anonymous row AND older than the threshold.
// `=== true` is deliberate: a null never satisfies it (SQL `is_anonymous = true`
// is likewise not satisfied by NULL), and `>` (not `>=`) models the strict
// interval comparison.
const isSelectedForCleanup = (row: UserRow, nowMs: number): boolean => {
  const ageHours = (nowMs - row.createdAtMs) / MS_PER_HOUR;
  return row.isAnonymous === true && ageHours > AGE_THRESHOLD_HOURS;
};

// is_anonymous generator spanning the three real states: true / false / null.
const isAnonymousArb = fc.constantFrom<boolean | null>(true, false, null);

// created_at generator spanning a wide window on BOTH sides of the threshold —
// well-aged (far in the past), borderline (just under / just over 24h), and
// even "future" rows (created_at after now, i.e. negative age) — so the age
// comparison is exercised across its whole range.
const createdAtArb = fc.integer({
  // From ~100h in the FUTURE (negative age) ...
  min: NOW_MS - 1_000 * MS_PER_HOUR,
  // ... to ~1000h in the past (far older than the threshold).
  max: NOW_MS + 100 * MS_PER_HOUR,
});

const userRowArb: fc.Arbitrary<UserRow> = fc.record({
  isAnonymous: isAnonymousArb,
  createdAtMs: createdAtArb,
});

describe("guest cleanup predicate (Property 13)", () => {
  it("selects only aged anonymous rows; never a false/null row, over mixed input", () => {
    fc.assert(
      fc.property(fc.array(userRowArb, { maxLength: 50 }), (rows) => {
        const selected = rows.filter((r) => isSelectedForCleanup(r, NOW_MS));

        for (const row of selected) {
          // Every selected row MUST be a true anonymous row ...
          expect(row.isAnonymous).toBe(true);
          // ... AND strictly older than 24h.
          const ageHours = (NOW_MS - row.createdAtMs) / MS_PER_HOUR;
          expect(ageHours).toBeGreaterThan(AGE_THRESHOLD_HOURS);
        }

        // No false/null row is ever selected, regardless of age.
        const anyNonAnonSelected = selected.some(
          (r) => r.isAnonymous !== true,
        );
        expect(anyNonAnonSelected).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("non-anonymous (false/null) rows are never selected, at any age", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<boolean | null>(false, null),
        createdAtArb,
        (isAnonymous, createdAtMs) => {
          const selected = isSelectedForCleanup(
            { isAnonymous, createdAtMs },
            NOW_MS,
          );
          expect(selected).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("an anonymous row is selected iff its age is strictly greater than 24h", () => {
    fc.assert(
      fc.property(createdAtArb, (createdAtMs) => {
        const row: UserRow = { isAnonymous: true, createdAtMs };
        const ageHours = (NOW_MS - createdAtMs) / MS_PER_HOUR;
        expect(isSelectedForCleanup(row, NOW_MS)).toBe(
          ageHours > AGE_THRESHOLD_HOURS,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("the boundary at exactly 24h is NOT selected (strict >, not >=)", () => {
    // created_at placed exactly 24h before now -> ageHours === 24.
    const exactlyThreshold: UserRow = {
      isAnonymous: true,
      createdAtMs: NOW_MS - AGE_THRESHOLD_HOURS * MS_PER_HOUR,
    };
    expect(isSelectedForCleanup(exactlyThreshold, NOW_MS)).toBe(false);

    // One millisecond older than the boundary -> selected.
    const justOverThreshold: UserRow = {
      isAnonymous: true,
      createdAtMs: NOW_MS - AGE_THRESHOLD_HOURS * MS_PER_HOUR - 1,
    };
    expect(isSelectedForCleanup(justOverThreshold, NOW_MS)).toBe(true);
  });
});
