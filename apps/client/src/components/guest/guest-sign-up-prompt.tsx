// Feature: anonymous-sign-in
// The guest one-game-per-mode sign-up prompt (R6.5). A named seam under
// components/guest so the whole feature stays greppable and removable in one
// pass (R9). Presentational only: it renders when a `join:error` carrying the
// guest-mode-limit reason has arrived and offers a navigable action to begin
// sign-up at `/sign-in`.
import Link from "next/link";

/**
 * The `join:error` reason the server emits when a guest has already played their
 * one game in the requested mode (mirrors the server-side
 * `GUEST_MODE_LIMIT_REASON`). Duplicated here as a client-side constant because
 * the client and server are separate packages; keeping the literal co-located
 * with its only consumer keeps the feature greppable and removable (R9).
 */
export const GUEST_MODE_LIMIT_REASON = "guest-mode-limit";

type GuestSignUpPromptProps = {
	/**
	 * The reason from the most recent `join:error` surfaced by the race/BR socket
	 * handling, or `undefined`/`null` when no join error is active. The prompt
	 * renders only when this equals the guest-mode-limit reason (R6.5); any other
	 * reason (e.g. the registered-user `daily-limit`) renders nothing.
	 */
	reason?: string | null;
};

/**
 * Renders a sign-up invitation when a guest hits the one-game-per-mode limit.
 *
 * Shown when a `join:error` with reason `guest-mode-limit` arrives (via the
 * existing `useRaceSocket` / Battle Royale socket handling). It invites the
 * guest to sign up to keep playing and offers a navigable action to `/sign-in`.
 *
 * The component is purely presentational — it holds no socket state. The parent
 * (the race/BR UI) passes the latest join-error `reason`; the prompt decides
 * whether to render based solely on that value, so wiring it in or tearing it
 * out is a single edit (R9).
 *
 * _Requirements: 6.5_
 */
const GuestSignUpPrompt: React.FC<GuestSignUpPromptProps> = ({ reason }) => {
	if (reason !== GUEST_MODE_LIMIT_REASON) {
		return null;
	}

	return (
		<section
			aria-labelledby="guest-sign-up-prompt-title"
			className="flex max-w-xs flex-col items-center gap-3 rounded-md border border-gray-200 bg-white p-5 text-center"
			role="status"
		>
			<h2
				className="font-bold text-gray-700 text-sm uppercase tracking-widest"
				id="guest-sign-up-prompt-title"
			>
				That&apos;s your guest game
			</h2>
			<p className="text-gray-500 text-xs">
				Guests get one game per mode. Sign up for a free account to keep playing
				and unlock duels, friends, and saved stats.
			</p>
			<Link
				className="rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
				href="/sign-in"
			>
				Sign up to continue
			</Link>
		</section>
	);
};

export default GuestSignUpPrompt;
