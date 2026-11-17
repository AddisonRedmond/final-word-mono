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
 * Same idea as the Battle Royale card: a slim fixed frame plus a row of tiles
 * sized from the card width, so the card can shrink far enough for a full
 * 99-player lobby (~49 opponents per column) without overflowing.
 *
 *   p-1 padding
 *   header: initials, progress bar, "x/N" or tick  RACE_HEADER_HEIGHT
 *   gap
 *   found-letter tiles (one per letter)            tile
 *
 *   tile = (width - padding - (letters - 1) * gap) / letters
 *   height = fixed frame + tile
 *
 * Word length changes between rounds, so every function takes `letters`.
 */

/** Upper bound on a Race opponent card's width, so a small field stays small. */
export const MAX_RACE_OPPONENT_WIDTH = 150;

const RACE_PADDING = 8; // p-1, both sides (must match the card's class)
export const RACE_HEADER_HEIGHT = 11; // (must match the card's header row)
export const RACE_SECTION_GAP = 3; // (must match the card's gap)

export const RACE_TILE_GAP = 1;
const RACE_MIN_TILE = 2;

const raceTileFixed = (letters: number) =>
	RACE_PADDING + (letters - 1) * RACE_TILE_GAP;

// The progress bar sits inside the header row, so it adds no height.
const RACE_FIXED_CARD_HEIGHT =
	RACE_PADDING + RACE_HEADER_HEIGHT + RACE_SECTION_GAP;

/** Edge length of a found-letter tile on a card of the given width. */
export const getRaceRevealTileSize = (width: number, letters = GUESS_LENGTH) =>
	Math.max(RACE_MIN_TILE, (width - raceTileFixed(letters)) / letters);

/** Race card height for a given width. */
export const getRaceCardHeight = (width: number, letters = GUESS_LENGTH) =>
	RACE_FIXED_CARD_HEIGHT + getRaceRevealTileSize(width, letters);

/**
 * Inverse of getRaceCardHeight: the widest card whose height fits `height`.
 * Returns 0 below the minimum tile size, so the layout never plans a card
 * whose real (clamped) height is taller than it allowed for.
 */
export const getRaceWidthForHeight = (
	height: number,
	letters = GUESS_LENGTH,
) => {
	const tile = height - RACE_FIXED_CARD_HEIGHT;
	if (tile < RACE_MIN_TILE) {
		return 0;
	}
	return tile * letters + raceTileFixed(letters);
};

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
