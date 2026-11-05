import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/utils/posthog";

/**
 * Tier-1 practice onboarding: a lightweight "how to play" coach-mark overlay
 * shown on the first `/practice` visit (and replayable via a "How to play"
 * button). It sits ON TOP of the real practice game — it does not change the
 * game engine or the board. The goal is to kill the "didn't understand the
 * rules and bounced" drop-off seen in session recordings by teaching the core
 * loop in the first few seconds.
 *
 * Design decisions (locked with product):
 *   - Replayable: the page owns a "How to play" button that re-opens it.
 *   - Steps 2–3 auto-advance on the player's FIRST valid guess, so the tutorial
 *     feels responsive instead of click-through. The page tells us about that
 *     first guess via `guessMade`.
 *   - Centered, dimmed card (no element-anchored spotlight yet) — cheap and
 *     good enough to validate; precise spotlighting is a later upgrade.
 */

const SEEN_KEY = "fw_practice_tutorial_seen";

export type TutorialStep = {
	emoji: string;
	title: string;
	body: string;
	/** When true, a real first guess auto-advances past this step. */
	autoAdvanceOnGuess?: boolean;
};

const STEPS: TutorialStep[] = [
	{
		emoji: "👋",
		title: "Welcome to the race (practice)",
		body: "Be the first to solve 3 words and you win. Here's how it works.",
	},
	{
		emoji: "⌨️",
		title: "Make a guess",
		body: "Type any real 5-letter word and press Enter to lock it in.",
		autoAdvanceOnGuess: true,
	},
	{
		emoji: "🟩",
		title: "Read the colors",
		body: "Green = right letter, right spot. Yellow = right letter, wrong spot. Grey = not in the word.",
		autoAdvanceOnGuess: true,
	},
	{
		emoji: "🎁",
		title: "A head start",
		body: "We've revealed a couple of letters for free to get you going.",
	},
	{
		emoji: "🏁",
		title: "Beat the field",
		body: "The players on each side are your opponents. First to 3 words wins — good luck!",
	},
];

/**
 * Whether the first-visit tutorial should auto-open. Reads a localStorage flag
 * so returning visitors (and people who already like it) aren't nagged. SSR and
 * storage-blocked environments default to NOT showing, so the tutorial never
 * flashes before hydration or throws where storage is unavailable.
 */
export const useShouldShowTutorial = (): boolean => {
	const [show, setShow] = useState(false);
	useEffect(() => {
		try {
			if (!window.localStorage.getItem(SEEN_KEY)) {
				setShow(true);
			}
		} catch {
			// Storage blocked (private mode, etc.) — just skip auto-open.
		}
	}, []);
	return show;
};

/** Persist that the tutorial has been seen so it won't auto-open again. */
export const markTutorialSeen = (): void => {
	try {
		window.localStorage.setItem(SEEN_KEY, "1");
	} catch {
		// Non-fatal: worst case it auto-opens again next visit.
	}
};

type PracticeTutorialProps = {
	/** Whether the overlay is open. The page owns this (first-visit + replay). */
	open: boolean;
	/**
	 * Flips to true the first time the player submits a valid guess. Used to
	 * auto-advance the guess/colors steps so the tutorial tracks what the player
	 * is actually doing.
	 */
	guessMade: boolean;
	/** Called when the tutorial is dismissed (finished or skipped). */
	onClose: () => void;
	/**
	 * Whether closing should persist the "seen" flag that suppresses the
	 * first-visit auto-open on `/practice`. Defaults to true (the practice page's
	 * own usage). The sign-in "rules" button passes false so previewing the rules
	 * there doesn't rob a first-time practice visitor of the auto-tour.
	 */
	persistSeen?: boolean;
};

const PracticeTutorial: React.FC<PracticeTutorialProps> = ({
	open,
	guessMade,
	onClose,
	persistSeen = true,
}) => {
	const [step, setStep] = useState(0);
	// Guard so each step's "viewed" event fires once per appearance, and so the
	// auto-advance only fires on the FIRST guess (not every render after).
	const startedRef = useRef(false);
	const autoAdvancedRef = useRef(false);

	// Reset to the first step each time the overlay (re)opens, and fire start +
	// first-step-viewed. Closing resets the one-shot guards.
	useEffect(() => {
		if (open) {
			setStep(0);
			startedRef.current = false;
			autoAdvancedRef.current = false;
			track("practice_tutorial_started");
		}
	}, [open]);

	// Fire a step-viewed event whenever the visible step changes while open.
	useEffect(() => {
		if (open) {
			track("practice_tutorial_step_viewed", { step });
		}
	}, [open, step]);

	const close = useCallback(
		(reason: "completed" | "skipped") => {
			if (persistSeen) {
				markTutorialSeen();
			}
			track(
				reason === "completed"
					? "practice_tutorial_completed"
					: "practice_tutorial_skipped",
				{ step },
			);
			onClose();
		},
		[onClose, persistSeen, step],
	);

	const next = useCallback(() => {
		setStep((prev) => {
			if (prev >= STEPS.length - 1) {
				return prev;
			}
			return prev + 1;
		});
	}, []);

	const isLast = step >= STEPS.length - 1;

	const handlePrimary = useCallback(() => {
		if (isLast) {
			close("completed");
		} else {
			next();
		}
	}, [close, isLast, next]);

	// Auto-advance past a guess-driven step the first time a real guess lands.
	useEffect(() => {
		if (!open || !guessMade || autoAdvancedRef.current) {
			return;
		}
		if (STEPS[step]?.autoAdvanceOnGuess) {
			autoAdvancedRef.current = true;
			next();
		}
	}, [open, guessMade, step, next]);

	const current = STEPS[step];

	return (
		<AnimatePresence>
			{open && current && (
				<motion.div
					animate={{ opacity: 1 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 px-6 backdrop-blur-sm"
					exit={{ opacity: 0 }}
					initial={{ opacity: 0 }}
				>
					<motion.div
						animate={{ scale: 1, y: 0, opacity: 1 }}
						className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
						exit={{ scale: 0.95, opacity: 0 }}
						initial={{ scale: 0.95, y: 8, opacity: 0 }}
						key={step}
					>
						<p aria-hidden="true" className="text-5xl">
							{current.emoji}
						</p>
						<h2 className="mt-3 font-black text-stone-800 text-xl">
							{current.title}
						</h2>
						<p className="mt-2 text-sm text-stone-600">{current.body}</p>

						{/* Step progress dots */}
						<div className="mt-5 flex justify-center gap-1.5">
							{STEPS.map((s, i) => (
								<span
									className={`size-1.5 rounded-full transition-colors ${
										i === step ? "bg-emerald-500" : "bg-stone-300"
									}`}
									key={s.title}
								/>
							))}
						</div>

						<button
							className="mt-5 w-full rounded-lg bg-emerald-500 px-6 py-3 font-bold text-sm text-white uppercase tracking-wider transition-colors hover:bg-emerald-400"
							onClick={handlePrimary}
							type="button"
						>
							{isLast ? "Got it — let's play" : "Next"}
						</button>
						{!isLast && (
							<button
								className="mt-2 text-sm text-stone-500 underline-offset-2 hover:underline"
								onClick={() => close("skipped")}
								type="button"
							>
								Skip tutorial
							</button>
						)}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};

export default PracticeTutorial;
