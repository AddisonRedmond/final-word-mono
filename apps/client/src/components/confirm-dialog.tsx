import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

import Button from "./button";
import Tile from "./tile";

type ConfirmDialogProps = {
	/** Short word rendered as Final Word tiles above the title (<= ~6 letters). */
	tileWord?: string;
	/** Dialog heading, e.g. "Forfeit duel?". */
	title: string;
	/** Supporting copy explaining the consequence of confirming. */
	message: string;
	/** Label for the confirming action button. */
	confirmLabel?: string;
	/** Label for the dismissing action button. */
	cancelLabel?: string;
	/** Visual weight of the confirm button; destructive actions use "red". */
	confirmVariant?: "red" | "solid" | "yellow";
	/** True while the confirm action is in flight; disables both buttons. */
	isPending?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

/**
 * A small "are you sure?" confirmation dialog in the Final Word style: the same
 * blurred backdrop and card as <Modal>, topped with a word rendered as game
 * tiles so destructive prompts feel on-theme rather than like a generic alert.
 *
 * Self-contained (its own portal + backdrop) rather than built on <Modal> so it
 * shows only Cancel/Confirm — no extra Close button competing with Cancel.
 */
const ConfirmDialog = ({
	tileWord = "SURE",
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	confirmVariant = "red",
	isPending = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) => {
	// Portal only after mount so SSR (no `document`) is skipped and hydration
	// stays consistent — mirrors <Modal>.
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	// Esc cancels, matching the backdrop click. Ignored while a confirm is in
	// flight so the user can't dismiss mid-request.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !isPending) {
				onCancel();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onCancel, isPending]);

	if (!mounted) {
		return null;
	}

	return createPortal(
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.2, ease: "easeInOut" }}
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !isPending) {
					onCancel();
				}
			}}
		>
			<motion.div
				initial={{ opacity: 0, scale: 0.95, y: 12 }}
				animate={{ opacity: 1, scale: 1, y: 0 }}
				exit={{ opacity: 0, scale: 0.95, y: 12 }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				aria-modal="true"
				role="alertdialog"
				className="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-xl"
			>
				<div className="mb-4 flex justify-center">
					<Tile revealed={true} size="sm" variant="present" word={tileWord} />
				</div>

				<h2 className="font-bold text-lg text-stone-800">{title}</h2>
				<p className="mt-1.5 text-sm text-stone-600">{message}</p>

				<div className="mt-5 flex justify-center gap-2">
					<Button
						disabled={isPending}
						onClick={onCancel}
						variant="outline"
					>
						{cancelLabel}
					</Button>
					<Button
						disabled={isPending}
						onClick={onConfirm}
						variant={confirmVariant}
					>
						{isPending ? (
							<span className="inline-block size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
						) : (
							confirmLabel
						)}
					</Button>
				</div>
			</motion.div>
		</motion.div>,
		document.body,
	);
};

export default ConfirmDialog;
