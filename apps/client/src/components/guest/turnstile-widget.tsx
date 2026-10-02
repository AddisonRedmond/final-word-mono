// Feature: anonymous-sign-in
// Cloudflare Turnstile widget — a named seam under components/guest so the whole
// captcha surface stays greppable and removable in one pass (R9). Loads the
// Turnstile script once, renders a widget with the public site key, and reports
// the solved token (and verify/expire/error transitions) to the parent. The
// parent gates the "Play as guest" button on having a non-null token.
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useRef,
} from "react";

import { env } from "@/env";

/** URL of Cloudflare's Turnstile script, loaded once and shared process-wide. */
const TURNSTILE_SCRIPT_SRC =
	"https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * The slice of the global `turnstile` API we use. Declared locally (rather than
 * via @types) to keep the feature self-contained and removable.
 */
type TurnstileApi = {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string;
			callback: (token: string) => void;
			"expired-callback"?: () => void;
			"error-callback"?: () => void;
			theme?: "light" | "dark" | "auto";
		},
	) => string;
	remove: (widgetId: string) => void;
	reset: (widgetId: string) => void;
};

declare global {
	interface Window {
		turnstile?: TurnstileApi;
		// Named onload callback Turnstile invokes once its script is ready; see
		// `?onload=` below. Shared so repeated mounts don't re-add the script.
		onTurnstileLoad?: () => void;
	}
}

/**
 * Ensure the Turnstile script is present exactly once. Resolves as soon as the
 * global `window.turnstile` API is available (either already loaded, or when the
 * script's `onload` fires). Safe to call from multiple widget instances.
 */
const loadTurnstileScript = (): Promise<void> =>
	new Promise((resolve) => {
		if (typeof window === "undefined") {
			return;
		}
		if (window.turnstile) {
			resolve();
			return;
		}

		const existing = document.querySelector<HTMLScriptElement>(
			`script[src^="${TURNSTILE_SCRIPT_SRC}"]`,
		);

		// Whether the script tag exists or not, the global onload callback is how
		// Turnstile signals readiness; chain any previously registered one.
		const previousOnload = window.onTurnstileLoad;
		window.onTurnstileLoad = () => {
			previousOnload?.();
			resolve();
		};

		if (existing) {
			// Script already injected by another instance; the onload above will
			// resolve us. If it somehow already loaded, resolve defensively.
			if (window.turnstile) {
				resolve();
			}
			return;
		}

		const script = document.createElement("script");
		script.src = `${TURNSTILE_SCRIPT_SRC}?onload=onTurnstileLoad`;
		script.async = true;
		script.defer = true;
		document.head.appendChild(script);
	});

export type TurnstileWidgetProps = {
	/** Called with the solved token when the challenge is passed. */
	onVerify: (token: string) => void;
	/** Called when the token expires or the challenge errors — clears the token. */
	onExpire?: () => void;
	/** Visual theme of the widget. */
	theme?: "light" | "dark" | "auto";
};

/**
 * Imperative handle the parent uses to force a fresh challenge. Turnstile tokens
 * are single-use: once the server verifies a token it is spent, so after every
 * sign-in attempt the parent calls `reset()` to discard the dead widget state
 * and issue a new token (otherwise a retry re-sends the spent token and
 * Cloudflare rejects it with `timeout-or-duplicate`).
 */
export type TurnstileWidgetHandle = {
	reset: () => void;
};

/**
 * Renders a single Cloudflare Turnstile challenge.
 *
 * On mount it loads the script (once) and explicitly renders a widget bound to
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The solved token is handed up via
 * `onVerify`; expiry/error clear it via `onExpire` and auto-reset the widget so
 * the user can solve it again. The parent can also force a reset via the
 * imperative `reset()` handle after consuming a token.
 */
const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
	({ onVerify, onExpire, theme = "auto" }, ref) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const widgetIdRef = useRef<string | null>(null);
		const containerId = useId();

		// Keep the latest callbacks in refs so the render effect can run once on
		// mount without re-rendering the widget every time a parent re-renders.
		const onVerifyRef = useRef(onVerify);
		const onExpireRef = useRef(onExpire);
		onVerifyRef.current = onVerify;
		onExpireRef.current = onExpire;

		const handleExpireOrError = useCallback(() => {
			onExpireRef.current?.();
			const api = window.turnstile;
			if (api && widgetIdRef.current) {
				api.reset(widgetIdRef.current);
			}
		}, []);

		// Expose an imperative reset so the parent can issue a fresh challenge
		// after a token has been consumed by a sign-in attempt. Resetting also
		// clears any solved token via `onExpire`, re-disabling the parent's button
		// until the user solves the new challenge.
		useImperativeHandle(
			ref,
			() => ({
				reset: () => {
					const api = window.turnstile;
					if (api && widgetIdRef.current) {
						api.reset(widgetIdRef.current);
					}
					onExpireRef.current?.();
				},
			}),
			[],
		);

		useEffect(() => {
			let cancelled = false;

			void loadTurnstileScript().then(() => {
				if (cancelled || !containerRef.current || !window.turnstile) {
					return;
				}
				// Guard against a double render (e.g. React 19 StrictMode remount).
				if (widgetIdRef.current) {
					return;
				}
				widgetIdRef.current = window.turnstile.render(containerRef.current, {
					sitekey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
					callback: (token) => onVerifyRef.current(token),
					"expired-callback": handleExpireOrError,
					"error-callback": handleExpireOrError,
					theme,
				});
			});

			return () => {
				cancelled = true;
				const api = window.turnstile;
				if (api && widgetIdRef.current) {
					api.remove(widgetIdRef.current);
					widgetIdRef.current = null;
				}
			};
		}, [handleExpireOrError, theme]);

		return <div id={containerId} ref={containerRef} />;
	},
);

TurnstileWidget.displayName = "TurnstileWidget";

export default TurnstileWidget;
