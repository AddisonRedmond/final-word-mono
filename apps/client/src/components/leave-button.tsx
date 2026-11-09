import { LogOut } from "lucide-react";

type LeaveButtonProps = {
	onClick: () => void;
	/** Accessible name; the visible tiles spell LEAVE but read as five letters. */
	label?: string;
};

const WORD = "LEAVE".split("");

/**
 * Leave / give-up control for the realtime games (Battle Royale, Race lobby and
 * rounds).
 *
 * It stays visually quiet (graphite keycaps spelling LEAVE) so it isn't an
 * attractive thing to tap by accident right under the keyboard, then lights up
 * hot pink on hover/focus so the destructive intent is unmistakable before the
 * click. The tiles echo the game's own letter tiles.
 */
const LeaveButton = ({ onClick, label = "Leave game" }: LeaveButtonProps) => (
	<button
		aria-label={label}
		className="group flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 outline-none transition-colors hover:bg-hot/10 focus-visible:ring-2 focus-visible:ring-hot"
		onClick={onClick}
		type="button"
	>
		<span aria-hidden="true" className="flex gap-1">
			{WORD.map((letter, index) => (
				<span
					className="keycap grid size-7 place-content-center rounded-md bg-gray-300 font-display text-[11px] text-white/60 transition-colors [--keycap-edge:var(--color-slot-edge)] group-hover:bg-hot group-hover:text-white group-focus-visible:bg-hot group-focus-visible:text-white group-hover:[--keycap-edge:var(--color-hot-edge)] group-focus-visible:[--keycap-edge:var(--color-hot-edge)]"
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed word, letters repeat (E)
					key={index}
				>
					{letter}
				</span>
			))}
		</span>
		<LogOut
			aria-hidden="true"
			className="text-gray-500 transition-colors group-hover:text-hot group-focus-visible:text-hot"
			size={16}
		/>
	</button>
);

export default LeaveButton;
