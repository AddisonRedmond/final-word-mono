import { useAnimate } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuessAck } from "@/hooks/useRaceSocket";
import { eliminationCount, RACE_CONFIG } from "@/shared/race";
import type { ClientRaceMatch } from "@/types/race.types";
import { isValidGuess } from "@/utils/race";
import GuessTiles, { type TileSlot } from "../../game-components/guess-tiles";
import Keyboard from "../../game-components/keyboard";
import MatchTimer from "../../game-components/match-timer";
import ProgressBars from "../../game-components/progress-bars";
import QualifiedSpots from "../../game-components/qualified-spots";

type RoundBoardProps = {
	/** Current match snapshot from the Race socket. */
	match: ClientRaceMatch;
	/** This player's id. */
	userId: string;
	/**
	 * Latest `guess:ack` from the Race socket. Carries both the per-letter
	 * grading and the server-accumulated keyboard hints (revealed/partial/absent)
	 * for the current word, with the duplicate-letter rule already applied.
	 */
	lastAck: GuessAck | undefined;
	/** Emit a guess for the player's current word. */
	onGuess: (guess: string) => void;
	/** Leave the match. */
	onLeave: () => void;
};

/**
 * In-round board, matching Battle Royale's look-and-feel AND client-side guess
 * behaviour (Req 10.2, 10.6). The round number, word length, and
 * Qualifying_Count are read from `RACE_CONFIG.rounds[currentRoundIndex]` — the
 * same config the server drives the round from. The round timer is the shared
 * `MatchTimer` counting down to `room.roundEndsAt` (clock-skew corrected inside
 * the timer), identical to the live timer Battle Royale shows during play.
 *
 * Guess handling mirrors Battle Royale's `battle-royale.tsx` exactly:
 *   - letters are typed a character at a time up to the word length;
 *   - on submit the guess is spell-checked client-side (`isValidGuess`), and an
 *     invalid word shakes the board and is KEPT so the player can edit it (no
 *     silent clear);
 *   - a valid guess is sent and the input auto-clears so the player never has
 *     to backspace the previous word;
 *   - the on-screen `Keyboard` colours its keys from the ACCUMULATED feedback
 *     of every guess of the current word (correct/present/absent), so guesses
 *     add to the indications instead of overwriting them; the accumulation
 *     resets when a new word starts (a correct guess or a new round);
 *   - the active guess tiles render green (like Battle Royale), and each known
 *     correct letter is pinned to that tile's top-right corner as a match hint.
 *
 * Round progress toward the Qualifying_Count is shown as segmented
 * `ProgressBars` (one empty bar per required word, each filling as a word is
 * completed) rather than an "N / M" text counter.
 */
const RoundBoard: React.FC<RoundBoardProps> = ({
	match,
	userId,
	lastAck,
	onGuess,
	onLeave,
}) => {
	const player = match.players[userId];
	const roundIndex = match.room.currentRoundIndex;
	const roundConfig = RACE_CONFIG.rounds[roundIndex];

	const lastFeedback = lastAck?.perLetter;

	// Fall back to the length of the last graded feedback if the config is ever
	// out of range, so the input length still matches the server's word.
	const wordLength =
		roundConfig?.wordLength ??
		lastFeedback?.length ??
		player?.lastFeedback?.length ??
		5;
	const qualifyingCount = roundConfig?.qualifyingCount ?? 1;
	const completedWords = player?.completedWords ?? 0;
	const isEliminated = player?.isEliminated ?? false;
	// Once qualified this round the player is safe and waiting — input is locked
	// (the server also rejects guesses from a qualified player).
	const isQualified = player?.qualified ?? false;
	// The board accepts input only while actively racing: in the round phase,
	// not eliminated, and not yet qualified.
	const inputLocked =
		match.room.phase !== "round" || isEliminated || isQualified;

	// Field-wide qualifying progress: how many players have qualified so far vs
	// the number of advancing spots this round. `totalSpots` = alive minus the
	// round's percentage elimination (the same clamped `eliminationCount` the
	// server uses), so it matches how many actually advance. The final round has
	// eliminationPct 0, so its "spots" is the whole surviving field.
	const { qualifiedCount, totalSpots } = useMemo(() => {
		const alivePlayers = Object.values(match.players).filter(
			(p) => !p.isEliminated,
		);
		const alive = alivePlayers.length;
		const qualifiedCount = alivePlayers.filter((p) => p.qualified).length;
		const eliminationPct = roundConfig?.eliminationPct ?? 0;
		const totalSpots = Math.max(
			1,
			alive - eliminationCount(alive, eliminationPct),
		);
		return { qualifiedCount, totalSpots };
	}, [match.players, roundConfig?.eliminationPct]);

	const [guess, setGuess] = useState("");
	// Scope for the invalid-guess shake, mirroring Battle Royale's `useAnimate`.
	const [scope, animate] = useAnimate();

	// A stable key for the CURRENT word: it changes when a word is completed
	// (completedWords advances) or the round changes. All accumulated
	// hint/keyboard state is scoped to this key so it resets on a correct guess
	// or a new round.
	const wordKey = `${roundIndex}:${completedWords}`;

	// Keyboard hints for the CURRENT word. The server computes and accumulates
	// these per word (revealed/partial/absent) with the duplicate-letter rule
	// already applied — so a letter like the second P in APPLE stays yellow
	// while a copy is still unfound, instead of going fully green. We just mirror
	// the latest ack for the current word here (no client-side re-grading).
	const [matches, setMatches] = useState<{
		wordKey: string;
		revealedLetters: Record<number, string>;
		partialMatches: string[];
		noMatch: string[];
	}>({ wordKey, revealedLetters: {}, partialMatches: [], noMatch: [] });

	// Reset the in-progress guess whenever a new word is graded (completedWords
	// advances) or the round changes, so stale letters don't linger.
	const wordKeyRef = useRef(wordKey);
	useEffect(() => {
		if (wordKeyRef.current !== wordKey) {
			wordKeyRef.current = wordKey;
			setGuess("");
		}
	}, [wordKey]);

	// Apply each incoming `guess:ack`'s server-accumulated keyboard hints to the
	// current word, consuming each ack exactly once. Two cases need care:
	//   - New word (wordKey changed): drop the previous word's hints and start
	//     blank. On a CORRECT guess the server sends the solved word's ack AND
	//     then a snapshot advancing completedWords; those arrive separately, so
	//     `lastAck` still points at the solved word's ack when the word changes.
	//     We mark that carried-over ack consumed so it is NOT re-applied to the
	//     fresh word (which would wrongly inherit the solved word's corner hints).
	//   - Stale previous-round ack: an ack whose grading length doesn't match the
	//     current round's word length belongs to a previous round and is ignored.
	const lastAppliedAckRef = useRef<GuessAck | undefined>(undefined);
	useEffect(() => {
		const wordChanged = matches.wordKey !== wordKey;

		if (wordChanged) {
			// Fresh word: start blank and mark any carried-over ack as consumed.
			lastAppliedAckRef.current = lastAck;
			setMatches({
				wordKey,
				revealedLetters: {},
				partialMatches: [],
				noMatch: [],
			});
			return;
		}

		// Nothing new to apply, or this exact ack was already applied.
		if (!lastAck || lastAck === lastAppliedAckRef.current) {
			return;
		}

		// Guard against a stale previous-round ack carrying over into a new round.
		if (
			lastAck.perLetter.length > 0 &&
			lastAck.perLetter.length !== wordLength
		) {
			return;
		}

		lastAppliedAckRef.current = lastAck;
		setMatches({
			wordKey,
			revealedLetters: lastAck.revealedLetters ?? {},
			partialMatches: lastAck.partialMatches ?? [],
			noMatch: lastAck.noMatch ?? [],
		});
	}, [lastAck, wordKey, wordLength, matches.wordKey]);

	const handleLetter = useCallback(
		(letter: string) => {
			if (!/^[A-Z]$/.test(letter) || inputLocked) {
				return;
			}
			setGuess((prev) => (prev.length < wordLength ? prev + letter : prev));
		},
		[inputLocked, wordLength],
	);

	const handleBackspace = useCallback(() => {
		setGuess((prev) => prev.slice(0, -1));
	}, []);

	const handleSubmit = useCallback(() => {
		if (inputLocked) {
			return;
		}

		// Spell-check client-side exactly like Battle Royale: an invalid word
		// (wrong length or not in the round's dictionary) shakes the board and is
		// kept so the player can fix it — it is NOT sent or cleared.
		if (!isValidGuess(guess, wordLength)) {
			animate(scope.current, { x: [-10, 10, -10, 10, 0] });
			return;
		}

		onGuess(guess);
		// Auto-clear on a valid submit so the player never has to delete the
		// previous word (matches Battle Royale).
		setGuess("");
	}, [animate, guess, inputLocked, onGuess, scope, wordLength]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				handleSubmit();
				return;
			}
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
	}, [handleBackspace, handleLetter, handleSubmit]);

	// Keyboard colouring + corner hints come straight from the server-accumulated
	// hints for the current word (duplicate-letter rule already applied):
	//   - fullMatch: Record<index, letter> of every position revealed `correct`.
	//     The Keyboard checks `Object.values(fullMatch).includes(letter)`, so
	//     this colours those keys green; it also drives the per-tile corner hint.
	//   - partialMatch: letters present but with an occurrence still unfound (so
	//     a duplicate like the second P in APPLE stays yellow, not green).
	//   - noMatch: letters absent from the word.
	const { fullMatch, partialMatch, noMatch } = useMemo(
		() => ({
			fullMatch: matches.revealedLetters,
			partialMatch: matches.partialMatches,
			noMatch: matches.noMatch,
		}),
		[matches],
	);

	// Build the active guess row exactly like Battle Royale's `GuessContainer`:
	// the in-progress guess renders on green tiles, and each known correct letter
	// (from `fullMatch`) is pinned to that position's top-right corner as a hint.
	const slots: TileSlot[] = Array.from({ length: wordLength }, (_, index) => ({
		letter: (guess[index] ?? "").toUpperCase(),
		state: "correct",
		cornerHint: fullMatch[index],
	}));

	return (
		<div className="flex flex-col items-center gap-4 text-center">
			<div className="flex flex-col items-center gap-1">
				<p className="font-semibold text-lg">Round {roundIndex + 1}</p>
				<p className="text-sm text-stone-500">
					{wordLength}-letter words · qualify with {qualifyingCount}
				</p>
				<QualifiedSpots qualified={qualifiedCount} totalSpots={totalSpots} />
			</div>

			<MatchTimer
				expiryTimestamp={match.room.roundEndsAt}
				label="Round Ends In"
			/>

			<div className="flex flex-col items-center gap-2">
				<ProgressBars
					filled={completedWords}
					label={`Progress: ${Math.min(completedWords, qualifyingCount)} of ${qualifyingCount} words`}
					total={qualifyingCount}
				/>
				{player?.qualified && (
					<p className="font-semibold text-emerald-500 text-sm">Qualified!</p>
				)}
			</div>

			<div
				className="rounded-md border border-white/30 bg-white/10 p-2 shadow-lg backdrop-blur-md"
				ref={scope}
			>
				<GuessTiles slots={slots} />
			</div>

			<Keyboard
				disabled={inputLocked}
				fullMatch={fullMatch}
				noMatch={noMatch}
				onBackspace={handleBackspace}
				onEnter={handleSubmit}
				onLetter={handleLetter}
				partialMatch={partialMatch}
			/>

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

export default RoundBoard;
