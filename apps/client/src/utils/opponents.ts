import type { RevealedLetters } from "@/types/battle-royale.types";

// Grid layout constants
export const GAP = 8;
export const GUESS_LENGTH = 5;

/**
 * Upper bound on an opponent card's width. The layout sizes cards to fill the
 * available column space, which is good when the field is full (shrinks cards
 * to fit many opponents) but balloons each card when only a few opponents
 * remain — making them larger than the player's own board. Clamping the
 * computed width here keeps cards a sensible size with a small field (extra
 * space becomes whitespace) while still allowing them to shrink below the cap
 * when the field is large. Roughly matches Race's fixed `w-28` card feel.
 */
export const MAX_OPPONENT_WIDTH = 150;

// Tile sizes scale with card width
export const HOPPER_TILE_RATIO = 0.11;
export const HOPPER_FONT_RATIO = 0.7;
export const REVEALED_TILE_RATIO = 0.16;
export const REVEALED_FONT_RATIO = 0.6;

// Fixed (non-width-scaled) vertical space inside a card: p-1.5 padding,
// the timer row, gap-y-1 gaps between rows, and gap-y-0.5 gaps between
// hopper rows
const CARD_PADDING = 12;
const TIMER_ROW_HEIGHT = 11;
const CONTENT_GAP_TOTAL = 8;
const HOPPER_GAP = 2;
const MAX_QUEUE_ROWS = 4;

/**
 * Card height is linear relative to its width:
 * height = FIXED_CARD_HEIGHT + width * CARD_HEIGHT_RATIO
 *
 * Reserves room for a full (4-row) hopper queue so attack words in flight
 * never spill past the bottom of the card.
 */
const CARD_HEIGHT_RATIO =
	MAX_QUEUE_ROWS * HOPPER_TILE_RATIO + REVEALED_TILE_RATIO;

const FIXED_CARD_HEIGHT =
	CARD_PADDING +
	TIMER_ROW_HEIGHT +
	CONTENT_GAP_TOTAL +
	(MAX_QUEUE_ROWS - 1) * HOPPER_GAP;

export const getCardHeight = (width: number) =>
	FIXED_CARD_HEIGHT + width * CARD_HEIGHT_RATIO;

export const getWidthForHeight = (height: number) =>
	Math.max(0, (height - FIXED_CARD_HEIGHT) / CARD_HEIGHT_RATIO);

/* --------------------------------------------------------------------------
 * Race opponent card sizing
 * --------------------------------------------------------------------------
 * Race shares Battle Royale's grow-to-fill flanking layout but its cards have a
 * different, simpler anatomy: an initials/qualified row, a thin progress bar,
 * and a "x / N" count — no attack-word hopper. So it needs its own width->height
 * relationship rather than reusing getCardHeight (which reserves room for a
 * 4-row hopper that Race never shows).
 *
 * Like Battle Royale, Race sizes cards to fill the available column space and
 * then CLAMPS to a max so a small field (a few survivors) doesn't balloon each
 * card past the player's own board. The clamp is a fixed pixel cap (approach
 * "a") — simple and jank-free; cards still shrink below it when the field is
 * large.
 */

/** Upper bound on a Race opponent card's width (mirrors MAX_OPPONENT_WIDTH). */
export const MAX_RACE_OPPONENT_WIDTH = 150;

/**
 * Upper bound on a Race opponent card's height. Derived from the max width via
 * the Race height formula so a card at full width is never taller than this —
 * keeps the explicit height cap and the width cap consistent.
 */
export const MAX_RACE_OPPONENT_HEIGHT = 96;

// Fixed vertical space inside a Race card, independent of width: p-2 padding,
// the initials row, the progress bar, the count row, and the gap-y-1.5 gaps
// between the three rows. Only the (small) horizontal content scales with
// width, so Race height grows gently with width.
const RACE_CARD_PADDING = 16; // p-2 top+bottom
const RACE_INITIALS_ROW = 16; // initials / qualified tick row
const RACE_PROGRESS_ROW = 12; // progress bar incl. its p-0.5 track
const RACE_COUNT_ROW = 14; // "x / N" text row
const RACE_ROW_GAP_TOTAL = 12; // two gap-y-1.5 gaps (6px each)
const RACE_FIXED_CARD_HEIGHT =
	RACE_CARD_PADDING +
	RACE_INITIALS_ROW +
	RACE_PROGRESS_ROW +
	RACE_COUNT_ROW +
	RACE_ROW_GAP_TOTAL;

// Gentle width coupling so wider cards get a little taller and keep their
// proportions, without the large hopper reservation BR needs.
const RACE_CARD_HEIGHT_RATIO = 0.12;

/** Race card height for a given (already-clamped) width, capped at the max. */
export const getRaceCardHeight = (width: number) =>
	Math.min(
		MAX_RACE_OPPONENT_HEIGHT,
		RACE_FIXED_CARD_HEIGHT + width * RACE_CARD_HEIGHT_RATIO,
	);

/** Inverse of getRaceCardHeight: the width whose card height fills `height`. */
export const getRaceWidthForHeight = (height: number) =>
	Math.max(0, (height - RACE_FIXED_CARD_HEIGHT) / RACE_CARD_HEIGHT_RATIO);

// socket.io round-trips every player through JSON each tick, so object
// identity is never stable - compare rendered fields instead of identity.
export const isSameRevealedLetters = (
	previous?: RevealedLetters,
	next?: RevealedLetters,
) => {
	if (previous === next) {
		return true;
	}

	if (!previous || !next) {
		return false;
	}

	const previousKeys = Object.keys(previous);
	const nextKeys = Object.keys(next);

	if (previousKeys.length !== nextKeys.length) {
		return false;
	}

	return previousKeys.every(
		(key) => previous[Number(key)] === next[Number(key)],
	);
};

export const isSameQueue = (
	previous?: RevealedLetters[],
	next?: RevealedLetters[],
) => {
	if (previous === next) {
		return true;
	}

	if (!previous || !next) {
		return false;
	}

	if (previous.length !== next.length) {
		return false;
	}

	return previous.every((entry, index) =>
		isSameRevealedLetters(entry, next[index]),
	);
};

export const getInitials = (name?: string | null) => {
	if (!name) return "?";

	const initials = name
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return initials || "?";
};
