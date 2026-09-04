import type { RevealedLetters } from "@/types/battle-royale.types";

// Grid layout constants
export const GAP = 8;
export const GUESS_LENGTH = 5;

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
