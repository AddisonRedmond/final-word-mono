import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	GUEST_NAME_FALLBACK,
	generateGuestDisplayName,
} from "./guest-name.js";

// Feature: anonymous-sign-in, Property 2: Display-name generator is total and well-formed
//
// For any random number generator (including adversarial sequences),
// generateGuestDisplayName(rng) never throws and its output either matches
// ^Player#[A-Z0-9]{4,6}$ or equals the fallback "Player" — never an empty string
// and never a value outside the alphabet/length bounds.
//
// Validates: Requirements 3.1, 3.4

/** The well-formed shape of a generated guest name (R3.1). */
const WELL_FORMED = /^Player#[A-Z0-9]{4,6}$/;

// A single adversarial rng output. Mixes the hostile values called out by the
// spec — NaN, negatives, values >= 1, zero — alongside valid [0, 1) draws so
// both the fallback and the well-formed branches get exercised.
const adversarialDraw = fc.oneof(
	fc.constant(Number.NaN),
	fc.constant(Number.POSITIVE_INFINITY),
	fc.constant(Number.NEGATIVE_INFINITY),
	fc.constant(0),
	fc.constant(1),
	fc.double({ min: -1000, max: -0.000001, noNaN: true }), // negatives
	fc.double({ min: 1, max: 1000, noNaN: true }), // >= 1
	fc.double({ min: 0, max: 0.9999999999999999, noNaN: true }), // valid [0, 1)
);

// A finite sequence of adversarial draws. The generator consumes one draw for
// the length and one per character, so a sequence of several values drives a
// full generation. When the sequence runs out we fall back to a fixed value so
// the rng remains total.
const rngFromSequence = (values: readonly number[]): (() => number) => {
	let i = 0;
	return () => {
		const value = values[i] ?? 0.5;
		i += 1;
		return value;
	};
};

describe("generateGuestDisplayName", () => {
	it("is total and well-formed across adversarial rng sequences", () => {
		fc.assert(
			fc.property(
				fc.array(adversarialDraw, { minLength: 0, maxLength: 20 }),
				(values) => {
					const rng = rngFromSequence(values);

					// Never throws (R3.4): any throw propagates and fails the property.
					const name = generateGuestDisplayName(rng);

					// Never empty (R3.4).
					expect(name.length).toBeGreaterThan(0);

					// Either well-formed (R3.1) or the fallback (R3.4) — nothing else.
					const isWellFormed = WELL_FORMED.test(name);
					const isFallback = name === GUEST_NAME_FALLBACK;
					expect(isWellFormed || isFallback).toBe(true);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("stays well-formed when the rng always yields a hostile value", () => {
		// A pathological rng (always NaN) is clamped to a safe draw, so the result
		// is still non-empty and well-formed rather than a throw or garbage. The
		// output is guaranteed to be either well-formed or the fallback.
		const name = generateGuestDisplayName(() => Number.NaN);
		expect(name.length).toBeGreaterThan(0);
		expect(WELL_FORMED.test(name) || name === GUEST_NAME_FALLBACK).toBe(true);
	});

	it("produces a well-formed name for a benign rng", () => {
		// A mid-range constant rng lands inside the alphabet/length bounds, so the
		// well-formed branch is reachable (keeps the property from being vacuous).
		const name = generateGuestDisplayName(() => 0.5);
		expect(WELL_FORMED.test(name)).toBe(true);
	});
});
