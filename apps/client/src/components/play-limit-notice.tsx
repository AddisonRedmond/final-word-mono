// Persistent "you've hit a play limit" notification shown on the home screen
// after a realtime `join:error` blocks a match start. The server emits a
// `reason` on that event; this component maps each known reason to its own
// message and call-to-action.
//
// Extensible by design: to support a new limit (e.g. free accounts capped at N
// realtime games per 24h), add one entry to LIMIT_NOTICES keyed by the server's
// reason string — no changes to the games, the home screen, or this component's
// body are needed. Any unknown/absent reason renders nothing.
//
// Why this exists alongside the inline in-game prompt: when a start is blocked,
// the game tears its socket down and returns to the card menu, so an in-game
// message disappears with it. This notice lives on the menu and stays visible.

import { motion } from "motion/react";
import Link from "next/link";

/**
 * Reasons the server sends on a match-start `join:error`. These mirror the
 * server-side literals (the client and server are separate packages, so the
 * strings are duplicated here as the client's source of truth):
 *   - "guest-mode-limit": a guest used their one game in a mode (live today).
 *   - "daily-limit": a registered user hit their per-24h cap (wired on the
 *     server, dormant until the free-account cap is switched on).
 */
export const GUEST_MODE_LIMIT_REASON = "guest-mode-limit";
export const DAILY_LIMIT_REASON = "daily-limit";

/** The presentation for a single limit reason. */
type LimitNotice = {
	/** Short heading, uppercase in the UI. */
	title: string;
	/** One or two sentences explaining the limit and the way forward. */
	body: string;
	/** Optional call-to-action link (label + href). Omit for a message-only notice. */
	cta?: { label: string; href: string };
};

/**
 * The reason → notice map. This is the single extension point: add a key here
 * for any new `join:error` reason and the home-screen notice supports it.
 */
export const LIMIT_NOTICES: Record<string, LimitNotice> = {
	[GUEST_MODE_LIMIT_REASON]: {
		title: "You've used your guest game",
		body: "Guests get one game per mode. Sign in with a real account to keep playing and unlock duels, friends, and saved stats.",
		cta: { label: "Sign in to play more", href: "/sign-in" },
	},
	[DAILY_LIMIT_REASON]: {
		title: "Daily game limit reached",
		body: "Free accounts get 3 realtime games per day, shared across Battle Royale and Race. Your limit resets at midnight UTC — or go premium for unlimited play.",
		cta: { label: "Go premium", href: "/api/polar/checkout" },
	},
};

type PlayLimitNoticeProps = {
	/**
	 * The reason from the most recent realtime `join:error`, or `null`/`undefined`
	 * when none is active. The notice renders only for a reason present in
	 * {@link LIMIT_NOTICES}; any other reason (or none) renders nothing.
	 */
	reason?: string | null;
	/** Dismiss the notice (clears the reason on the parent). */
	onDismiss: () => void;
};

/**
 * A home-screen banner describing why a match start was blocked and how to keep
 * playing. Reason-driven and self-hiding, so it is safe to render
 * unconditionally with whatever reason the parent is holding.
 */
const PlayLimitNotice: React.FC<PlayLimitNoticeProps> = ({
	reason,
	onDismiss,
}) => {
	const notice = reason ? LIMIT_NOTICES[reason] : undefined;
	if (!notice) {
		return null;
	}

	return (
		<motion.aside
			animate={{ opacity: 1, y: 0 }}
			aria-labelledby="play-limit-notice-title"
			className="flex max-w-md items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left shadow-sm"
			exit={{ opacity: 0, y: -8 }}
			initial={{ opacity: 0, y: -8 }}
			role="status"
		>
			<div className="flex flex-col gap-1">
				<h2
					className="font-bold text-amber-900 text-sm uppercase tracking-widest"
					id="play-limit-notice-title"
				>
					{notice.title}
				</h2>
				<p className="text-amber-800 text-xs">{notice.body}</p>
				{notice.cta ? (
					<Link
						className="mt-1 w-fit rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
						href={notice.cta.href}
					>
						{notice.cta.label}
					</Link>
				) : null}
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

export default PlayLimitNotice;
