import { useCallback, useEffect, useState } from "react";
import { RACE_CONFIG } from "@/shared/race";
import type { ClientRaceMatch } from "@/types/race.types";
import GuessTiles, { type TileSlot } from "../../game-components/guess-tiles";
import Keyboard from "../../game-components/keyboard";
import ShareCode from "../../game-components/share-code";
import CountDownTimer from "../../game-components/timer";

type LobbyViewProps = {
	/** Current lobby snapshot from the Race socket. */
	match: ClientRaceMatch;
	/** This player's id (unused now the roster is shown as flanking opponents). */
	userId: string;
	/** Leave the lobby/match. */
	onLeave: () => void;
	/**
	 * v1 play-with-friends — this lobby's share code, shown so the player can
	 * invite friends into the SAME race. Undefined if the room has no code.
	 */
	shareCode?: string;
	/**
	 * v1 play-with-friends — set to `room-unavailable` when a share-code join
	 * fell back to a fresh lobby, so the player is told they didn't land with
	 * their friend.
	 */
	joinNotice?: string;
};

/**
 * Pre-start lobby view, mirroring Battle Royale's pre-start board (Req 10.1).
 *
 * Instead of a "Players in Lobby (N)" roster, the lobby renders the same board
 * the round uses — opponents flank it (handled by the Race root) and join/leave
 * in real time — beneath a "Game Starting" countdown to `room.lobbyDeadline`.
 * The player may TYPE into the guess tiles to warm up, but guessing is disabled:
 * there is no `onEnter`/submit wired here, and the server rejects any `guess`
 * outside the `round` phase — so nothing can be submitted until the match
 * actually starts. The tiles show the in-progress letters on the shared
 * `GuessTiles` (first round's word length); the keyboard colours nothing yet.
 */
const LobbyView: React.FC<LobbyViewProps> = ({
	match,
	onLeave,
	shareCode,
	joinNotice,
}) => {
	// Warm-up input length = the first round's word length (the length players
	// will actually guess once the match starts).
	const wordLength = RACE_CONFIG.rounds[0]?.wordLength ?? 5;

	const [guess, setGuess] = useState("");

	const handleLetter = useCallback(
		(letter: string) => {
			if (!/^[A-Z]$/.test(letter)) {
				return;
			}
			setGuess((prev) => (prev.length < wordLength ? prev + letter : prev));
		},
		[wordLength],
	);

	const handleBackspace = useCallback(() => {
		setGuess((prev) => prev.slice(0, -1));
	}, []);

	// Allow typing/backspacing to warm up, but NOT Enter — there is no submit in
	// the lobby. (The physical Enter key is intentionally ignored too.)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Backspace") {
				handleBackspace();
				return;
			}
			if (/^[a-zA-Z]$/.test(e.key)) {
				handleLetter(e.key.toUpperCase());
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleBackspace, handleLetter]);

	const slots: TileSlot[] = Array.from({ length: wordLength }, (_, index) => ({
		letter: (guess[index] ?? "").toUpperCase(),
		state: "correct",
	}));

	return (
		<div className="flex flex-col items-center gap-4 text-center">
			<CountDownTimer
				expiryTimestamp={match.room.lobbyDeadline}
				timerTitle="Game Starting"
			/>

			{/* v1 play-with-friends — invite friends into this same race. */}
			{shareCode && <ShareCode code={shareCode} />}
			{joinNotice === "room-unavailable" && (
				<p className="max-w-xs rounded-md bg-amber-100 px-3 py-2 text-[11px] text-amber-700">
					That race couldn't be joined (it may have already started), so we
					started a new one for you.
				</p>
			)}

			<div className="rounded-md border border-white/30 bg-white/10 p-2 shadow-lg backdrop-blur-md">
				<GuessTiles slots={slots} />
			</div>

			{/* Keyboard is usable for warm-up typing, but no `onEnter` is wired so
			    the Enter key is disabled — guessing only begins when the match does. */}
			<Keyboard onBackspace={handleBackspace} onLetter={handleLetter} />

			<div className="flex gap-2">
				<button
					className="flex cursor-pointer gap-x-0.5 rounded-md p-2 font-semibold text-xs shadow-lg"
					onClick={onLeave}
					type="button"
				>
					<p className="aspect-square rounded-md bg-red-300 p-1">L</p>
					<p className="aspect-square rounded-md bg-red-300 p-1">E</p>
					<p className="aspect-square rounded-md bg-red-300 p-1">A</p>
					<p className="aspect-square rounded-md bg-red-300 p-1">V</p>
					<p className="aspect-square rounded-md bg-red-300 p-1">E</p>
				</button>
			</div>
		</div>
	);
};

export default LobbyView;
