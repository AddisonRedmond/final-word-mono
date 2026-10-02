// Feature: anonymous-sign-in
// First-sign-in welcome carousel for guests — a named seam under components/guest
// so the whole guest feature stays greppable and removable in one pass (R9).
// Shown once (gated by the persisted guest-welcome store) the first time an
// anonymous user signs in, it highlights what a full account unlocks that a
// guest one does not, and offers a navigable action to create one.

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import Modal from "@/components/modal";

type Slide = {
	title: string;
	body: string;
	emoji: string;
};

/**
 * The perks a full account unlocks over a guest session. Kept as plain data so
 * the slide list is trivial to extend or trim.
 */
const SLIDES: Slide[] = [
	{
		emoji: "🎮",
		title: "More games",
		body: "Guests get one game per mode. A free account lets you play more Battle Royale and Race games.",
	},
	{
		emoji: "⚔️",
		title: "Duels & friends",
		body: "Challenge friends head-to-head and build your friends list — features that stay locked for guest sessions.",
	},
	{
		emoji: "📈",
		title: "Saved stats",
		body: "Your wins, streaks, and progress are saved to your account instead of disappearing when your guest session ends.",
	},
];

type GuestWelcomeCarouselProps = {
	/** Close the carousel (also marks it as seen on the parent). */
	onClose: () => void;
};

/**
 * A small modal carousel of full-account perks. Purely presentational: the
 * parent decides whether to render it (first guest sign-in) and persists the
 * "seen" flag on close.
 */
const GuestWelcomeCarousel: React.FC<GuestWelcomeCarouselProps> = ({
	onClose,
}) => {
	const [index, setIndex] = useState(0);

	const slide = SLIDES[index];
	const isLast = index === SLIDES.length - 1;

	if (!slide) {
		return null;
	}

	const goNext = () => {
		setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
	};

	return (
		<Modal onClose={onClose}>
			<div className="flex flex-col items-center gap-5 text-center">
				<h2 className="font-bold text-gray-800 text-lg uppercase tracking-widest">
					Welcome, guest!
				</h2>
				<p className="text-gray-500 text-xs">
					You&apos;re playing as a guest. Here&apos;s what a free account adds.
				</p>

				<div className="relative h-40 w-full overflow-hidden">
					<AnimatePresence initial={false} mode="wait">
						<motion.div
							animate={{ opacity: 1, x: 0 }}
							className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4"
							exit={{ opacity: 0, x: -40 }}
							initial={{ opacity: 0, x: 40 }}
							key={index}
							transition={{ duration: 0.25, ease: "easeInOut" }}
						>
							<span aria-hidden="true" className="text-4xl">
								{slide.emoji}
							</span>
							<h3 className="font-bold text-gray-800 text-sm uppercase tracking-widest">
								{slide.title}
							</h3>
							<p className="text-gray-600 text-xs">{slide.body}</p>
						</motion.div>
					</AnimatePresence>
				</div>

				{/* Slide position dots */}
				<div className="flex items-center gap-2">
					{SLIDES.map((s, i) => (
						<button
							aria-current={i === index}
							aria-label={`Go to slide ${i + 1}`}
							className={`size-2 rounded-full transition-colors ${
								i === index ? "bg-green-400" : "bg-gray-300 hover:bg-gray-400"
							}`}
							key={s.title}
							onClick={() => setIndex(i)}
							type="button"
						/>
					))}
				</div>

				{isLast ? (
					<Link
						className="w-full rounded-md bg-green-400 py-2 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
						href="/sign-in"
					>
						Create a free account
					</Link>
				) : (
					<button
						className="w-full rounded-md bg-green-400 py-2 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
						onClick={goNext}
						type="button"
					>
						Next
					</button>
				)}

				<button
					className="font-semibold text-gray-400 text-xs uppercase tracking-widest transition-colors hover:text-gray-600"
					onClick={onClose}
					type="button"
				>
					Keep playing as guest
				</button>
			</div>
		</Modal>
	);
};

export default GuestWelcomeCarousel;
