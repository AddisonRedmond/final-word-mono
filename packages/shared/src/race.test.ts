import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { raceConfigSchema } from "./race.js";

// Feature: round-based-elimination-race, Property 1: Config validity captures all invariants
//
// For any candidate Race_Config object, raceConfigSchema.safeParse succeeds if
// and only if it has at least one round, minLobbySize <= maxLobbySize, all
// timers/word-lengths/qualifying-counts are positive, every eliminationPct is in
// [0, 1], and the final round's qualifyingCount equals 1.
//
// Validates: Requirements 2.7, 2.8

// A number arbitrary that mixes clearly-valid and clearly-invalid candidates so
// both branches of the iff are exercised. It intentionally emits zero, negative,
// non-integer, and out-of-range values alongside good ones.
const messyInt = fc.oneof(
  fc.integer({ min: 1, max: 100_000 }), // valid positive int
  fc.integer({ min: -100, max: 0 }), // zero / negative
  fc.double({ min: 0.5, max: 5.5, noNaN: true, noDefaultInfinity: true }), // non-integer
);

// wordLength candidate: mixes in-range [3,8], out-of-range, non-integer.
const messyWordLength = fc.oneof(
  fc.integer({ min: 3, max: 8 }), // valid
  fc.integer({ min: -5, max: 2 }), // too small / non-positive
  fc.integer({ min: 9, max: 30 }), // too large
  fc.double({ min: 3, max: 8, noNaN: true, noDefaultInfinity: true }), // non-integer
);

// eliminationPct candidate: mixes in-range [0,1] and out-of-range.
const messyPct = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), // valid
  fc.double({ min: -2, max: -0.01, noNaN: true, noDefaultInfinity: true }), // negative
  fc.double({ min: 1.01, max: 5, noNaN: true, noDefaultInfinity: true }), // > 1
);

const roundArb = fc.record({
  timerMs: messyInt,
  wordLength: messyWordLength,
  qualifyingCount: messyInt,
  eliminationPct: messyPct,
});

// The candidate config. updateWindowMs is optional in the schema (it has a
// default), so we sometimes omit it entirely to exercise that path.
const configArb = fc
  .record(
    {
      rounds: fc.array(roundArb, { minLength: 0, maxLength: 5 }),
      minLobbySize: messyInt,
      maxLobbySize: messyInt,
      lobbyCountdownMs: messyInt,
      penaltyThresholdMs: messyInt,
      debounceAmountMs: messyInt,
      updateWindowMs: fc.option(messyInt, { nil: undefined }),
    },
    { requiredKeys: ["rounds", "minLobbySize", "maxLobbySize", "lobbyCountdownMs", "penaltyThresholdMs", "debounceAmountMs"] },
  )
  .map((c) => {
    // Drop updateWindowMs entirely when the option produced undefined, so we
    // also cover the "field absent -> default applies" case.
    if (c.updateWindowMs === undefined) {
      const { updateWindowMs: _omit, ...rest } = c;
      return rest as typeof c;
    }
    return c;
  });

// Independent predicates: recomputed from the invariants, NOT by calling the
// schema. These mirror the schema's stated rules by hand.
const isPositiveInt = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

const isWordLength = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n >= 3 && n <= 8;

const isPct = (n: unknown): boolean =>
  typeof n === "number" && n >= 0 && n <= 1;

// updateWindowMs is optional; when present it must be a positive int, when
// absent the schema default applies (so absence is valid).
const isOptionalPositiveInt = (n: unknown): boolean =>
  n === undefined || isPositiveInt(n);

function expectedValid(c: {
  rounds: Array<{
    timerMs: number;
    wordLength: number;
    qualifyingCount: number;
    eliminationPct: number;
  }>;
  minLobbySize: number;
  maxLobbySize: number;
  lobbyCountdownMs: number;
  penaltyThresholdMs: number;
  debounceAmountMs: number;
  updateWindowMs?: number;
}): boolean {
  // At least one round (Req 2.1).
  if (c.rounds.length < 1) return false;

  // Every round's fields satisfy their per-field invariants.
  for (const r of c.rounds) {
    if (!isPositiveInt(r.timerMs)) return false;
    if (!isWordLength(r.wordLength)) return false;
    if (!isPositiveInt(r.qualifyingCount)) return false;
    if (!isPct(r.eliminationPct)) return false;
  }

  // Top-level positive-int fields.
  if (!isPositiveInt(c.minLobbySize)) return false;
  if (!isPositiveInt(c.maxLobbySize)) return false;
  if (!isPositiveInt(c.lobbyCountdownMs)) return false;
  if (!isPositiveInt(c.penaltyThresholdMs)) return false;
  if (!isPositiveInt(c.debounceAmountMs)) return false;
  if (!isOptionalPositiveInt(c.updateWindowMs)) return false;

  // Lobby-size ordering (Req 2.3).
  if (!(c.minLobbySize <= c.maxLobbySize)) return false;

  // Final round qualifyingCount must equal 1 (Req 2.8).
  const finalRound = c.rounds[c.rounds.length - 1];
  if (finalRound.qualifyingCount !== 1) return false;

  return true;
}

describe("raceConfigSchema validity (Property 1)", () => {
  it("safeParse succeeds iff all invariants hold", () => {
    fc.assert(
      fc.property(configArb, (candidate) => {
        const actual = raceConfigSchema.safeParse(candidate).success;
        const expected = expectedValid(candidate as Parameters<typeof expectedValid>[0]);
        expect(actual).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  // A couple of concrete anchors so the property's intent is legible and any
  // regression in a specific invariant is easy to localize.
  it("accepts a fully valid config", () => {
    const ok = {
      rounds: [
        { timerMs: 1000, wordLength: 4, qualifyingCount: 3, eliminationPct: 0.3 },
        { timerMs: 1000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0.5 },
      ],
      minLobbySize: 2,
      maxLobbySize: 8,
      lobbyCountdownMs: 5000,
      penaltyThresholdMs: 300,
      debounceAmountMs: 600,
    };
    expect(raceConfigSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects when final round qualifyingCount != 1", () => {
    const bad = {
      rounds: [{ timerMs: 1000, wordLength: 4, qualifyingCount: 2, eliminationPct: 0.3 }],
      minLobbySize: 2,
      maxLobbySize: 8,
      lobbyCountdownMs: 5000,
      penaltyThresholdMs: 300,
      debounceAmountMs: 600,
    };
    expect(raceConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects when minLobbySize > maxLobbySize", () => {
    const bad = {
      rounds: [{ timerMs: 1000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0.3 }],
      minLobbySize: 9,
      maxLobbySize: 8,
      lobbyCountdownMs: 5000,
      penaltyThresholdMs: 300,
      debounceAmountMs: 600,
    };
    expect(raceConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty rounds array", () => {
    const bad = {
      rounds: [],
      minLobbySize: 2,
      maxLobbySize: 8,
      lobbyCountdownMs: 5000,
      penaltyThresholdMs: 300,
      debounceAmountMs: 600,
    };
    expect(raceConfigSchema.safeParse(bad).success).toBe(false);
  });
});
