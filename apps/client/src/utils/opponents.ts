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

/*
 * Battle Royale opponent card: a mini board.
 *
 *   p-1 padding
 *   initials chip                               HEADER_ROW_HEIGHT
 *   gap
 *   current word (revealed letters)             tile
 *   gap
 *   life bar (divider)                          DIVIDER_HEIGHT
 *   gap
 *   queued attack words, up to MAX_QUEUE_ROWS   tile each, ROW_GAP between
 *
 * Tiles are sized from the card width so five always fit across exactly:
 *   tile = (width - padding - 4 * TILE_GAP) / 5
 * Height reserves room for every row (current + MAX_QUEUE_ROWS), so all cards
 * in the grid share one size whatever their queue holds. That makes height a
 * linear function of width, which is what the fit-to-column layout needs.
 */
// Kept tight on purpose: with ~50 opponents per column a card is only ~35px
// wide, so padding and gaps would otherwise eat most of the tile space.
const CARD_PADDING = 8; // p-1, both sides (must match the card's class)
const HEADER_ROW_HEIGHT = 11; // initials chip row (must match the card)
const SECTION_GAP = 3; // between card sections (must match the card's gap-y)
const DIVIDER_HEIGHT = 4; // the life bar (must match OpponentTimer's h-1)
const TILE_GAP = 1; // between tiles in a row
const ROW_GAP = 1; // between queued rows
export const MAX_QUEUE_ROWS = 4;
const BOARD_ROWS = 1 + MAX_QUEUE_ROWS;
const MIN_TILE = 2;

/** Font size as a fraction of the tile edge. */
export const CARD_TILE_FONT_RATIO = 0.62;

/** Edge length of one tile on a card of the given width. */
export const getCardTileSize = (width: number) =>
	Math.max(
		MIN_TILE,
		(width - CARD_PADDING - (GUESS_LENGTH - 1) * TILE_GAP) / GUESS_LENGTH,
	);

export const CARD_TILE_GAP = TILE_GAP;
export const CARD_ROW_GAP = ROW_GAP;
export const CARD_SECTION_GAP = SECTION_GAP;
export const CARD_HEADER_HEIGHT = HEADER_ROW_HEIGHT;

// height = FIXED + BOARD_ROWS * tile, and tile = (width - TILE_FIXED) / 5.
// Four sections (chip, current word, divider, queue) means three gaps.
const TILE_FIXED = CARD_PADDING + (GUESS_LENGTH - 1) * TILE_GAP;
const FIXED_CARD_HEIGHT =
	CARD_PADDING +
	HEADER_ROW_HEIGHT +
	3 * SECTION_GAP +
	DIVIDER_HEIGHT +
	(MAX_QUEUE_ROWS - 1) * ROW_GAP;

export const getCardHeight = (width: number) =>
	FIXED_CARD_HEIGHT + BOARD_ROWS * getCardTileSize(width);

/** Narrowest card we render; below this the tiles hit MIN_TILE. */
const MIN_CARD_WIDTH = MIN_TILE * GUESS_LENGTH + TILE_FIXED;

/**
 * Inverse of getCardHeight: the widest card whose height fits `height`. Kept
 * consistent with the MIN_TILE clamp so the layout never picks a width whose
 * real (clamped) height is taller than it planned for.
 */
export const getWidthForHeight = (height: number) => {
	const width =
		((height - FIXED_CARD_HEIGHT) / BOARD_ROWS) * GUESS_LENGTH + TILE_FIXED;
	return width < MIN_CARD_WIDTH ? 0 : width;
};

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
export const MAX_RACE_OPPONENT_HEIGHT = 116;

// Fixed vertical space inside a Race card, independent of width: p-2 padding,
// the initials row, the progress bar, the count row, and the gap-y-1.5 gaps
// between the three rows. Only the (small) horizontal content scales with
// width, so Race height grows gently with width.
const RACE_CARD_PADDING = 16; // p-2 top+bottom
const RACE_INITIALS_ROW = 16; // initials / qualified tick row
const RACE_PROGRESS_ROW = 12; // progress bar incl. its p-0.5 track
const RACE_COUNT_ROW = 14; // "x / N" text row
const RACE_REVEAL_ROW = 16; // row of reveal tiles (opponent's found letters)
const RACE_ROW_GAP_TOTAL = 18; // three gap-y-1.5 gaps (6px each)

/** Edge length of a Race reveal tile for a card of the given width. */
export const RACE_REVEAL_TILE_MAX = RACE_REVEAL_ROW;
export const getRaceRevealTileSize = (width: number, letters = GUESS_LENGTH) =>
	Math.max(
		6,
		Math.min(
			RACE_REVEAL_TILE_MAX,
			// card width minus p-2 padding and the 2px gaps between tiles
			(width - RACE_CARD_PADDING - (letters - 1) * 2) / letters,
		),
	);
const RACE_FIXED_CARD_HEIGHT =
	RACE_CARD_PADDING +
	RACE_INITIALS_ROW +
	RACE_PROGRESS_ROW +
	RACE_COUNT_ROW +
	RACE_REVEAL_ROW +
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
