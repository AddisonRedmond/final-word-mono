import { useEffect, useState } from "react";
import type { DuelParticipant } from "@/db/schema";
import type { MatchResult, KeyboardState } from "@/utils/duel";
import Keyboard from "@/components/game-components/keyboard";
import DuelGuess from "./duel-guess";
import Guesses from "./guesses";
import DuelResult from "./duel-result";
import DuelTimer from "./duel-timer";

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

	const { correct, present, absent } = duelData.keyboardState;
	const isResultView = Boolean(duelData.endTime);

	// Keyboard expects fullMatch as Record<number, string> — build a positional
	// map from the correct letters list so the existing keyboard prop contract is satisfied.
	const fullMatch = Object.fromEntries(
		correct.map((letter, i) => [i, letter]),
	) as Record<number, string>;

	const onLetter = (letter: string) => {
		setGuess((prev) => (prev.length < 5 ? prev + letter.toUpperCase() : prev));
	};

	const onEnter = async () => {
		if (guess.length !== 5 || isSubmitting) return;
		setIsSubmitting(true);
		try {
			await onSubmitGuess(guess);
			setGuess("");
		} finally {
			setIsSubmitting(false);
		}
	};

	const onBackspace = () => {
		setGuess((prev) => prev.slice(0, -1));
	};

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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [guess, isSubmitting]);

	if (isResultView) {
		return (
			<DuelResult duelData={duelData} opponents={opponents} onClose={onClose} />
		);
	}

	return (
		<div className="w-full max-w-2xl rounded-2xl space-y-2">
			{duelData.startTime && <DuelTimer startTime={duelData.startTime} />}
			<Guesses
				key={duelData.guesses.join("-")}
				guesses={duelData.guesses}
				matchResults={duelData.matchResults}
			/>
			<DuelGuess guess={guess} />
			<Keyboard
				onLetter={onLetter}
				onEnter={() => void onEnter()}
				onBackspace={onBackspace}
				fullMatch={fullMatch}
				partialMatch={present}
				noMatch={absent}
			/>
		</div>
	);
};

export default DuelBoard;
