// Feature: anonymous-sign-in — guest display-name generation (pure seam).

/** Fixed prefix prepended to a guest's random identifier (R3.1). */
export const GUEST_NAME_PREFIX = "Player#";

/** Fallback name used whenever generation can't produce a well-formed value (R3.3, R3.4). */
export const GUEST_NAME_FALLBACK = "Player";

/** The character set a guest identifier is drawn from: [A-Z0-9]. */
export const GUEST_NAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Minimum length of the random identifier (inclusive). */
export const GUEST_NAME_MIN = 4;

/** Maximum length of the random identifier (inclusive). */
export const GUEST_NAME_MAX = 6;

/**
 * Pure. Returns `Player#` + 4-6 chars from [A-Z0-9] (R3.1).
 *
 * If the random identifier ever comes out empty or outside the alphabet/length
 * bounds, returns the fallback "Player" rather than throwing (R3.4) — generation
 * must never block account creation. Not unique by design (R3.5).
 *
 * @param rng A function returning a number in [0, 1). Defaults to Math.random.
 */
export const generateGuestDisplayName = (
	rng: () => number = Math.random,
): string => {
	try {
		const span = GUEST_NAME_MAX - GUEST_NAME_MIN + 1;
		const length = GUEST_NAME_MIN + Math.floor(clamp01(rng()) * span);

		// Out-of-bounds length (e.g. an adversarial rng) → fallback.
		if (
			!Number.isFinite(length) ||
			length < GUEST_NAME_MIN ||
			length > GUEST_NAME_MAX
		) {
			return GUEST_NAME_FALLBACK;
		}

		let identifier = "";
		for (let i = 0; i < length; i++) {
			const index = Math.floor(clamp01(rng()) * GUEST_NAME_ALPHABET.length);
			const char = GUEST_NAME_ALPHABET[index];

			// Any index that fails to land on a valid alphabet char → fallback.
			if (char === undefined) {
				return GUEST_NAME_FALLBACK;
			}

			identifier += char;
		}

		// Empty or out-of-bounds result → fallback (R3.4).
		if (
			identifier.length < GUEST_NAME_MIN ||
			identifier.length > GUEST_NAME_MAX
		) {
			return GUEST_NAME_FALLBACK;
		}

		return GUEST_NAME_PREFIX + identifier;
	} catch {
		// Never throw (R3.4).
		return GUEST_NAME_FALLBACK;
	}
};

/**
 * Coerce an arbitrary rng output into the [0, 1) range so a hostile or buggy
 * rng (NaN, negatives, values >= 1) can't push an index out of the alphabet.
 */
const clamp01 = (value: number): number => {
	if (!Number.isFinite(value) || value < 0) {
		return 0;
	}
	if (value >= 1) {
		// Largest representable value strictly below 1.
		return 0.9999999999999999;
	}
	return value;
};
