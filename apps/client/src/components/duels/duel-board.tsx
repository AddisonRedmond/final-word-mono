import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimate } from "motion/react";
import Keyboard from "@/components/game-components/keyboard";
import type { DuelParticipant } from "@/db/schema";
import * as br from "@/utils/battle-royale";
import type { KeyboardState, MatchResult } from "@/utils/duel";
import DuelGuess from "./duel-guess";
import DuelResult from "./duel-result";
import DuelTimer from "./duel-timer";
import Guesses from "./guesses";

type DuelBoardProps = {
	duelData: DuelParticipant & {
		matchResults: MatchResult[];
		keyboardState: KeyboardState;
		secretWord?: string;
	};
	onSubmitGuess: (guess: string) => Promise<void>;
	onClose: () => void;
	opponents: Array<{
		id: string;
		name: string;
		status: string;
		guesses: string[];
	}>;
};

const DuelBoard: React.FC<DuelBoardProps> = ({
	duelData,
	onSubmitGuess,
	onClose,
	opponents,
}) => {
	const [guess, setGuess] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isSubmittingRef = useRef(false);
	const [scope, animate] = useAnimate();

	const { correct, present, absent } = duelData.keyboardState;
	const isResultView = Boolean(duelData.endTime);

	// Keyboard expects fullMatch as Record<number, string> — build a positional
	// map from the correct letters list so the existing keyboard prop contract is satisfied.
	const fullMatch = Object.fromEntries(
		correct.map((letter, i) => [i, letter]),
	) as Record<number, string>;

	const onLetter = useCallback((letter: string) => {
		setGuess((prev) => (prev.length < 5 ? prev + letter.toUpperCase() : prev));
	}, []);

	const onEnter = useCallback(async () => {
		if (guess.length !== 5 || isSubmittingRef.current) return;
		if (!br.isValidGuess(guess)) {
			animate(scope.current, { x: [-10, 10, -10, 10, 0] });
			return;
		}

		isSubmittingRef.current = true;
		setIsSubmitting(true);
		try {
			await onSubmitGuess(guess);
			setGuess("");
		} finally {
			isSubmittingRef.current = false;
			setIsSubmitting(false);
		}
	}, [animate, guess, onSubmitGuess, scope]);

	const onBackspace = useCallback(() => {
		setGuess((prev) => prev.slice(0, -1));
	}, []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			if (e.key === "Enter") {
				void onEnter();
			} else if (e.key === "Backspace") {
				onBackspace();
			} else if (/^[a-zA-Z]$/.test(e.key)) {
				onLetter(e.key);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onBackspace, onEnter, onLetter]);

	if (isResultView) {
		return (
			<DuelResult duelData={duelData} onClose={onClose} opponents={opponents} />
		);
	}

	return (
		<div className="w-full max-w-2xl space-y-2 rounded-2xl">
			{duelData.startTime && <DuelTimer startTime={duelData.startTime} />}
			<Guesses
				guesses={duelData.guesses}
				key={duelData.guesses.join("-")}
				matchResults={duelData.matchResults}
			/>
			<div ref={scope}>
				<DuelGuess guess={guess} />
			</div>
			<Keyboard
				disabled={isSubmitting}
				fullMatch={fullMatch}
				noMatch={absent}
				onBackspace={onBackspace}
				onEnter={() => void onEnter()}
				onLetter={onLetter}
				partialMatch={present}
			/>
		</div>
	);
};

export default DuelBoard;
