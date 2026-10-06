import { KeyRound, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	type FormEvent,
	type ReactNode,
	useContext,
	useId,
	useRef,
	useState,
} from "react";

/**
 * Coordinates the open/closed state of every Join Game panel so that only ONE
 * can be open at a time across all game cards. Each `Key` registers under its
 * own id; opening a panel makes it the sole `openId`, which closes any other.
 * Scales to any number of game modes without the cards knowing about each other.
 */
type KeyGroupContextValue = {
	openId: string | null;
	setOpenId: (id: string | null) => void;
};

const KeyGroupContext = createContext<KeyGroupContextValue | null>(null);

/**
 * Wrap the set of game cards in this so opening one card's Join Game panel
 * closes the others. Optional — a lone `Key` works without it.
 */
export const KeyGroupProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const [openId, setOpenId] = useState<string | null>(null);
	return (
		<KeyGroupContext.Provider value={{ openId, setOpenId }}>
			{children}
		</KeyGroupContext.Provider>
	);
};

type KeyProps = {
	/**
	 * Called with the trimmed game ID when the user submits (Join button or
	 * Enter key). Wiring this to the socket join-by-code flow is v1 server work;
	 * for now the parent decides what to do with the id.
	 */
	onJoin?: (gameId: string) => void;
};

/**
 * "Join Game" affordance for a game card. The button sits in the card body;
 * clicking it slides a panel up from the bottom of the card (the card clips it
 * via `overflow-hidden`) where the user types a game ID. Submit with the Join
 * button or the Enter key; close with the X or Escape.
 *
 * When rendered inside a `KeyGroupProvider`, opening this panel closes any
 * other open panel in the group (only one Join Game panel open at a time).
 */
const Key: React.FC<KeyProps> = ({ onJoin }) => {
	const instanceId = useId();
	const group = useContext(KeyGroupContext);
	// Fall back to local state when there is no surrounding group, so a lone Key
	// still works standalone.
	const [localOpen, setLocalOpen] = useState(false);
	const isOpen = group ? group.openId === instanceId : localOpen;

	const [gameId, setGameId] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const open = () => {
		if (group) {
			group.setOpenId(instanceId);
		} else {
			setLocalOpen(true);
		}
	};

	const close = () => {
		if (group) {
			// Only clear the group if this panel is the one currently open, so a
			// close here never stomps another card's freshly opened panel.
			if (group.openId === instanceId) {
				group.setOpenId(null);
			}
		} else {
			setLocalOpen(false);
		}
		// NB: the input is cleared in AnimatePresence's onExitComplete, not here,
		// so the field doesn't visibly blank out while the panel is still sliding
		// down (which read as a flash).
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = gameId.trim();
		if (!trimmed) {
			return;
		}
		onJoin?.(trimmed);
		close();
	};

	return (
		<>
			<button
				className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-gray-200 py-2 font-semibold text-[11px] text-gray-500 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
				onClick={(event) => {
					// The whole card is clickable; don't let the trigger bubble up.
					event.stopPropagation();
					open();
				}}
				type="button"
			>
				<KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
				Join Game
			</button>

			<AnimatePresence onExitComplete={() => setGameId("")}>
				{isOpen && (
					<motion.div
						animate={{ y: 0 }}
						// Fills the card and starts fully below it; the card's
						// `overflow-hidden` clips it until it eases into place. `z-30`
						// keeps it above the card's badge (`z-20`) so the close button in
						// the panel's top-right corner isn't covered by the badge.
						className="absolute inset-0 z-30 flex flex-col justify-center gap-3 bg-stone-800/95 p-5 backdrop-blur-sm"
						exit={{ y: "100%" }}
						initial={{ y: "100%" }}
						onAnimationComplete={(definition) => {
							// onAnimationComplete fires for BOTH enter and exit. Only focus
							// after the enter animation (y: 0), and use preventScroll so
							// focusing never scrolls the input into view inside the
							// overflow-hidden card — that scroll was shifting the card's
							// contents up and causing a flash.
							if (
								typeof definition === "object" &&
								definition !== null &&
								"y" in definition &&
								definition.y === 0
							) {
								inputRef.current?.focus({ preventScroll: true });
							}
						}}
						transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
					>
						<button
							aria-label="Close join game"
							className="absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-stone-400 transition-all hover:bg-white/10 hover:text-white active:scale-95"
							onClick={(event) => {
								event.stopPropagation();
								close();
							}}
							type="button"
						>
							<X className="h-4 w-4" />
						</button>

						<label
							className="font-semibold text-[11px] text-green-400 uppercase tracking-widest"
							htmlFor="join-game-id"
						>
							Enter game code
						</label>

						<form className="flex flex-col gap-2" onSubmit={submit}>
							<input
								autoCapitalize="characters"
								autoComplete="off"
								className="w-full rounded-md border border-stone-600 bg-stone-900/60 px-3 py-2 text-center font-mono text-sm text-white uppercase tracking-widest outline-none transition-all placeholder:text-stone-500 focus:border-green-400"
								id="join-game-id"
								onChange={(event) => setGameId(event.target.value)}
								onClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										close();
									}
								}}
								placeholder="GAME CODE"
								ref={inputRef}
								value={gameId}
							/>
							<button
								className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-green-400 py-2 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={!gameId.trim()}
								type="submit"
							>
								Join
							</button>
						</form>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
};

export default Key;
