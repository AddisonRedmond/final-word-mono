// Feature: anonymous-sign-in
// The "Play as guest" control (R1.1). A named seam under components/guest so the
// whole feature stays greppable and removable in one pass (R9). Delegates all
// sign-in behavior to the useGuestSession hook: the hook already ignores repeat
// activations while a request is in flight (R1.6) and exposes the two-way error
// kind this button maps to distinct messages (R2.5, R2.6).
//
// Captcha: a Cloudflare Turnstile widget is rendered inline and the solved token
// is held in local state. The button stays disabled until a token exists, and
// the token is forwarded to the hook so the server can verify it before minting
// a guest account.
import { useRef, useState } from "react";
import TurnstileWidget, {
	type TurnstileWidgetHandle,
} from "@/components/guest/turnstile-widget";
import { useGuestSession } from "@/hooks/useGuestSession";

/**
 * Maps the hook's error kind to the user-facing copy:
 * - `"cap"`   — the concurrent-guest cap was reached (R2.5).
 * - `"other"` — any other, non-cap failure (count failure, provider failure,
 *   timeout, or a failed captcha verification) (R2.6, R1.7).
 */
const ERROR_MESSAGES = {
	cap: "Guest play is temporarily unavailable. Please try again later.",
	other: "Sign-in failed. Please try again.",
} as const;

/**
 * Renders the "Play as guest" button, its Turnstile captcha, and loading/error
 * UI.
 *
 * The button is disabled until the captcha is solved (a token is present) and
 * while a sign-in attempt is in flight; extra activations are ignored by the
 * hook's in-flight guard (R1.6). On failure the hook re-enables the control and
 * surfaces an error kind that drives the two distinct messages below (R2.5,
 * R2.6). An expired/errored captcha clears the token, re-disabling the button
 * until the user solves a fresh challenge.
 *
 * _Requirements: 1.1, 1.6, 1.7, 2.5, 2.6_
 */
const GuestPlayButton: React.FC = () => {
	const { signInAsGuest, isPending, error } = useGuestSession();
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const widgetRef = useRef<TurnstileWidgetHandle>(null);

	// Disabled while signing in, or until the captcha has produced a token.
	const isDisabled = isPending || captchaToken === null;

	const handleClick = async () => {
		if (captchaToken === null) {
			return;
		}
		await signInAsGuest(captchaToken);
		// Turnstile tokens are single-use: the attempt above consumed this one, so
		// on any outcome where we remain on this screen (every failure — success
		// navigates away) reset the widget to issue a fresh token. This clears the
		// token via `onExpire`, re-disabling the button until a new challenge is
		// solved, and prevents a retry from re-sending the spent token (which
		// Cloudflare rejects as `timeout-or-duplicate`).
		widgetRef.current?.reset();
	};

	return (
		<div className="flex flex-col items-center gap-2">
			<button
				aria-busy={isPending}
				aria-disabled={isDisabled}
				className="flex w-full items-center justify-center gap-2 rounded-md bg-green-400 py-2 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-green-400"
				disabled={isDisabled}
				onClick={() => void handleClick()}
				type="button"
			>
				{isPending ? (
					<span
						aria-label="Signing in"
						className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
						role="status"
					/>
				) : null}
				Play as guest
			</button>

			<TurnstileWidget
				onExpire={() => setCaptchaToken(null)}
				onVerify={(token) => setCaptchaToken(token)}
				ref={widgetRef}
			/>

			{error ? (
				<p className="text-center text-red-500 text-xs" role="alert">
					{ERROR_MESSAGES[error]}
				</p>
			) : null}
		</div>
	);
};

export default GuestPlayButton;
