import type { CSSProperties } from "react";
import { keyStateClasses, type LetterState } from "@/utils/letter-states";

const TOP_ROW = "QWERTYUIOP";
const MIDDLE_ROW = "ASDFGHJKL";
const BOTTOM_ROW = "ZXCVBNM";

type KeyboardProps = {
	onLetter: (letter: string) => void;
	onEnter?: () => void;
	onBackspace?: () => void;
	disabled?: boolean;
	className?: string;
	fullMatch?: Record<number, string>;
	partialMatch?: string[];
	noMatch?: string[];
	/**
	 * When true, the bottom row renders Delete on the left and Enter on the
	 * right (default is Enter-left / Delete-right). Lets a player put the key
	 * they use most under their dominant thumb.
	 */
	swapActionKeys?: boolean;
};

type LetterKeyProps = {
	letter: string;
	onLetter: (letter: string) => void;
	disabled?: boolean;
	fullMatch?: Record<number, string>;
	partialMatch?: string[];
	noMatch?: string[];
};

/*
 * iOS-style layout. Each row is its own CSS grid with 20 equal columns (half a
 * key unit per column). A letter spans 2 columns = 1 unit; Enter/Delete span 3
 * columns = 1.5 units. The grid tracks absorb all the width math, so:
 *   - Row 1 (10 letters) fills all 20 columns.
 *   - Row 2 (9 letters) is centered, inset by half a unit each side.
 *   - Row 3 is Enter(3) + 7 letters(14) + Delete(3) = 20 columns.
 * Letting the grid size the columns (instead of percentage widths on each key)
 * is what keeps every key the same width and perfectly aligned without the
 * squishing we had before. Mobile-first; from `sm:` up we revert to the
 * original compact auto-width keyboard.
 */
const gridRowClass =
	"grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[var(--key-gap)] sm:flex sm:items-center sm:justify-center sm:gap-1.5";

const keyBaseClass =
	// Mobile key height scales with viewport height (clamped so keys stay
	// tappable) so the keyboard shrinks on short screens instead of forcing the
	// board to scroll. From sm+ we fall back to auto height.
	"keycap flex h-[clamp(38px,6.5dvh,52px)] items-center justify-center rounded-lg font-display text-base sm:h-auto sm:min-w-9 sm:px-3 sm:py-2 sm:text-sm";

// Column spans (ignored at sm+, where the layout falls back to flex).
const letterKeySpan = "col-span-2";
const actionKeySpan = "col-span-3";

const resolveVariant = (
	letter: string,
	fullMatch?: Record<number, string>,
	partialMatch?: string[],
	noMatch?: string[],
): LetterState => {
	// Precedence matters: a letter can legitimately be in BOTH `fullMatch` and
	// `partialMatch` when the word has duplicates. E.g. the answer AROMA has two
	// A's; guessing ARMOR places one A (green position) but the second A is still
	// unfound, so the key must stay yellow.
	//
	// This relies on the server pruning `partialMatch`: Battle Royale and Race
	// only keep a letter there while it has an UNREVEALED occurrence left
	// (`hasUnrevealedOccurrence`), so once every copy is placed the letter drops
	// out of `partialMatch` and the key turns green. Duels build disjoint sets
	// (see `buildKeyboardState`), so they are unaffected by the order.
	//
	// Order: present (yellow) > correct (green) > absent (grey).
	if (partialMatch?.includes(letter)) {
		return "present";
	}
	if (Object.values(fullMatch ?? {}).includes(letter)) {
		return "correct";
	}
	if (noMatch?.includes(letter)) {
		return "absent";
	}
	return "default";
};

const LetterKey = ({
	letter,
	onLetter,
	disabled,
	fullMatch,
	partialMatch,
	noMatch,
}: LetterKeyProps) => {
	const variant = resolveVariant(letter, fullMatch, partialMatch, noMatch);

	return (
		<button
			aria-label={`Type ${letter}`}
			className={`${keyBaseClass} ${letterKeySpan} ${keyStateClasses[variant]} ${
				disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
			}`}
			disabled={disabled}
			onClick={() => onLetter(letter)}
			type="button"
		>
			{letter}
		</button>
	);
};

const Keyboard = ({
	onLetter,
	onEnter,
	onBackspace,
	disabled = false,
	className = "",
	fullMatch,
	partialMatch,
	noMatch,
	swapActionKeys = false,
}: KeyboardProps) => {
	const keyProps = { onLetter, disabled, fullMatch, partialMatch, noMatch };

	const enterKey = (
		<button
			className={`${keyBaseClass} ${actionKeySpan} bg-paper text-ink text-xs uppercase tracking-wide [--keycap-edge:var(--color-paper-edge)] sm:min-w-16 sm:text-sm ${disabled || !onEnter ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
			disabled={disabled || !onEnter}
			onClick={onEnter}
			type="button"
		>
			Enter
		</button>
	);

	const deleteKey = (
		<button
			aria-label="Backspace"
			className={`${keyBaseClass} ${actionKeySpan} bg-hot text-white text-xs uppercase tracking-wide [--keycap-edge:var(--color-hot-edge)] sm:min-w-16 sm:text-sm ${disabled || !onBackspace ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
			disabled={disabled || !onBackspace}
			onClick={onBackspace}
			type="button"
		>
			Delete
		</button>
	);

	// Default is Enter on the left, Delete on the right; the preference flips
	// them. Source order drives both the mobile grid and the sm+ flex layout, so
	// the swap applies on every screen size.
	const [leftActionKey, rightActionKey] = swapActionKeys
		? [deleteKey, enterKey]
		: [enterKey, deleteKey];

	return (
		<div
			aria-label="On-screen keyboard"
			className={`flex w-full max-w-2xl flex-col gap-(--key-gap) rounded-2xl bg-ink/60 p-2 backdrop-blur-sm sm:gap-1.5 ${className}`}
			role="group"
			// One shared inter-key gap for the mobile grid rows.
			style={{ "--key-gap": "6px" } as CSSProperties}
		>
			<div className={gridRowClass}>
				{TOP_ROW.split("").map((letter) => (
					<LetterKey key={letter} letter={letter} {...keyProps} />
				))}
			</div>

			{/* Row 2 is 18 columns of keys; a half-unit (1 column) spacer on each
          side centers it like the iOS inset. */}
			<div className={gridRowClass}>
				<span aria-hidden className="col-span-1 sm:hidden" />
				{MIDDLE_ROW.split("").map((letter) => (
					<LetterKey key={letter} letter={letter} {...keyProps} />
				))}
				<span aria-hidden className="col-span-1 sm:hidden" />
			</div>

			<div className={gridRowClass}>
				{leftActionKey}
				{BOTTOM_ROW.split("").map((letter) => (
					<LetterKey key={letter} letter={letter} {...keyProps} />
				))}
				{rightActionKey}
			</div>
		</div>
	);
};

export default Keyboard;
