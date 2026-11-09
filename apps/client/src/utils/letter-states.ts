/**
 * Single source of truth for how a graded letter looks, shared by every tile
 * and key in the app (the on-screen keyboard, duel tiles, Race/Battle Royale
 * guess rows, and the decorative <Tile>).
 *
 * Change a state's look HERE and it updates everywhere. Notes:
 * - Class substrings like `bg-emerald-500`, `bg-amber-400` and `bg-stone-400`
 *   are kept on purpose: the palette variables in `globals.css` remap them to
 *   the lime / sun / dark-grey theme, and tests assert on them.
 * - `keycap` (see globals.css) gives the hard bottom edge; `--keycap-edge`
 *   picks that edge's colour.
 */

/** Grading state of a single letter. */
export type LetterState = "default" | "correct" | "present" | "absent";

/** Classes for a letter TILE (non-interactive), per state. */
export const tileStateClasses: Record<LetterState, string> = {
	default:
		"bg-panel-2 text-white shadow-[inset_0_0_0_2px_var(--color-graphite)]",
	correct:
		"bg-emerald-500 text-ink keycap [--keycap-edge:var(--color-lime-edge)] drop-shadow-[0_0_10px_rgba(182,255,46,0.4)]",
	present: "bg-amber-400 text-ink keycap [--keycap-edge:var(--color-sun-edge)]",
	absent: "bg-stone-200 text-white/90 keycap",
};

/**
 * Classes for an on-screen * Compact, FLAT tiles (no keycap edge or glow) for small boards such as the
 * opponent cards, where the full keycap treatment is too heavy at ~14px.
 * `default` doubles as the muted look for empty / queued ("hopper") tiles.
 */
export const flatTileClasses: Record<LetterState, string> = {
	default: "bg-gray-300 text-white/70",
	correct: "bg-emerald-500 text-ink",
	present: "bg-amber-400 text-ink",
	absent: "bg-stone-400 text-white/90",
};

/**
 KEYBOARD key, per state. Keys are interactive, so
 * they carry hover styles, and "absent" keys are dimmed further than absent
 * tiles so ruled-out letters recede.
 */
export const keyStateClasses: Record<LetterState, string> = {
	default: "bg-gray-300 text-white hover:bg-gray-500",
	correct:
		"bg-emerald-500 text-ink [--keycap-edge:var(--color-lime-edge)] hover:bg-emerald-500",
	present:
		"bg-amber-400 text-ink [--keycap-edge:var(--color-sun-edge)] hover:bg-amber-400",
	absent: "bg-stone-400/50 text-white/30 hover:bg-stone-400",
};

/**
 * Champion cosmetic for <Tile>: a gold face with a brighter glow, shown when
 * the player won their last realtime game. Not a letter-grading state.
 */
export const championTileClasses =
	"bg-gradient-to-br from-amber-300 to-yellow-500 text-ink keycap [--keycap-edge:var(--color-sun-edge)] drop-shadow-[0_0_14px_rgba(255,214,10,0.6)]";
