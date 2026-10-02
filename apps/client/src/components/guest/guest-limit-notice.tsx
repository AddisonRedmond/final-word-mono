// Feature: anonymous-sign-in
// Persistent "you've used your guest game" notification shown on the home
// screen after a guest hits the one-game-per-mode limit (R6.5). A named seam
// under components/guest so the whole feature stays greppable and removable in
// one pass (R9).
//
// This complements the inline `GuestSignUpPrompt` that renders briefly inside a
// game: when a guest is blocked from a mode, the game tears its socket down and
// returns to the card menu, so the inline prompt disappears with it. This notice
// lives on the home screen above the game cards and stays visible there, giving
// the guest a stable, dismissible call to sign up.

import { motion } from "motion/react";
import Link from "next/link";

/**
 * The `join:error` reason the server emits when a guest has already played their
 * one game in the requested mode (mirrors the server-side
 * `GUEST_MODE_LIMIT_REASON`). Duplicated client-side because the client and
 * server are separate packages; keeping it co-located keeps the feature
 * greppable and removable (R9).
 */
export const GUEST_MODE_LIMIT_REASON = "guest-mode-limit";

type GuestLimitNoticeProps = {
	/**
	 * The reason from the most recent realtime `join:error`, or `null`/`undefined`
	 * when none is active. The notice renders only for the guest-mode-limit
	 * reason; any other reason (or none) renders nothing.
	 */
	reason?: string | null;
	/** Dismiss the notice (clears the reason on the parent). */
	onDismiss: () => void;
};

/**
 * A home-screen banner inviting a rate-limited guest to sign up for a full
 * account. Self-hides for any reason other than the guest-mode-limit, so it is
 * safe to render unconditionally with whatever reason the parent is holding.
 *
 * _Requirements: 6.5_
 */
const GuestLimitNotice: React.FC<GuestLimitNoticeProps> = ({
	reason,
	onDismiss,
}) => {
	if (reason !== GUEST_MODE_LIMIT_REASON) {
		return null;
	}

	return (
		<motion.aside
			animate={{ opacity: 1, y: 0 }}
			aria-labelledby="guest-limit-notice-title"
			className="flex max-w-md items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left shadow-sm"
			exit={{ opacity: 0, y: -8 }}
			initial={{ opacity: 0, y: -8 }}
			role="status"
		>
			<div className="flex flex-col gap-1">
				<h2
					className="font-bold text-amber-900 text-sm uppercase tracking-widest"
					id="guest-limit-notice-title"
				>
					You&apos;ve used your guest game
				</h2>
				<p className="text-amber-800 text-xs">
					Guests get one game per mode. Sign in with a real account to keep
					playing and unlock duels, friends, and saved stats.
				</p>
				<Link
					className="mt-1 w-fit rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
					href="/sign-in"
				>
					Sign in to play more
				</Link>
			</div>
			<button
				aria-label="Dismiss"
				className="ml-auto rounded px-1 font-bold text-amber-700 text-lg leading-none transition-colors hover:text-amber-900"
				onClick={onDismiss}
				type="button"
			>
				×
			</button>
		</motion.aside>
	);
};

export default GuestLimitNotice;
