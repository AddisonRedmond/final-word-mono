import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in — client "Play as guest" UX unit tests.
//
// These cover the GuestPlayButton + useGuestSession seam:
//   R1.1  — the "Play as guest" control renders.
//   R1.6  — while a sign-in is in flight the button is disabled, shows the
//           spinner, and repeat clicks are ignored (mutateAsync called once).
//   R1.7  — on failure AND on the 5s timeout, the control re-enables, the
//           spinner is gone, an error shows, and NO session handoff happens
//           (supabase.auth.setSession is never called → no socket connect).
//   R2.5  — a CAP_REACHED error (tRPC code TOO_MANY_REQUESTS) → cap message.
//   R2.6  — any other error → the generic non-cap message.
//
// The tRPC api is mocked so the test controls the mutation's pending/resolve
// lifecycle, and the Supabase browser client is mocked so `setSession`
// (the session handoff that triggers the socket connect in index.tsx) is
// observable.

// -- Mutation control handle -------------------------------------------------
//
// A single mutateAsync spy the tests re-point per case. `useMutation` returns a
// stable object that reads through to the current spy so we can swap behavior
// (resolve/reject/hang) between tests without re-mocking the module.
const mutateAsync = vi.fn();

vi.mock("@/utils/api", () => ({
	api: {
		guest: {
			signIn: {
				useMutation: () => ({ mutateAsync }),
			},
		},
	},
}));

// Observable navigation. On a successful sign-in the hook pushes "/" (the same
// destination as the OAuth callback) so the user lands on the play screen. On
// failure/timeout it must NOT navigate.
const push = vi.fn(async () => true);

vi.mock("next/router", () => ({
	useRouter: () => ({ push }),
}));

// Observable session handoff. If setSession is called the socket would connect
// via the existing index.tsx getSession() path; R1.7 requires it NOT be called
// on failure/timeout.
const setSession = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("@/utils/supabase/client", () => ({
	createClient: () => ({ auth: { setSession } }),
}));

// Stub the Turnstile widget so no real Cloudflare script loads in jsdom. The
// stub renders two buttons the tests can click to drive the captcha lifecycle:
// "solve captcha" hands a token up via onVerify, and "expire captcha" clears it
// via onExpire. The button under test stays disabled until a token exists.
//
// The stub also forwards an imperative `reset()` handle (mirroring the real
// widget) that clears the token via `onExpire` — this is how the button
// invalidates a single-use token after each sign-in attempt.
vi.mock("@/components/guest/turnstile-widget", () => ({
	default: forwardRef<
		{ reset: () => void },
		{ onVerify: (token: string) => void; onExpire?: () => void }
	>(({ onVerify, onExpire }, ref) => {
		useImperativeHandle(ref, () => ({ reset: () => onExpire?.() }), [onExpire]);
		return (
			<div>
				<button onClick={() => onVerify("captcha-token")} type="button">
					solve captcha
				</button>
				<button onClick={() => onExpire?.()} type="button">
					expire captcha
				</button>
			</div>
		);
	}),
}));

import GuestPlayButton from "./guest-play-button";

/** Solve the mocked captcha so the "Play as guest" button becomes enabled. */
const solveCaptcha = () => {
	fireEvent.click(screen.getByRole("button", { name: /solve captcha/i }));
};

const CAP_MESSAGE =
	"Guest play is temporarily unavailable. Please try again later.";
const OTHER_MESSAGE = "Sign-in failed. Please try again.";

const getButton = () => screen.getByRole("button", { name: /play as guest/i });

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe("GuestPlayButton — control presence (R1.1)", () => {
	it("renders the 'Play as guest' control, gated on the captcha until solved", () => {
		render(<GuestPlayButton />);

		const button = getButton();
		expect(button).toBeDefined();
		// Disabled until the captcha produces a token; no spinner/error yet.
		expect(button).toHaveProperty("disabled", true);
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();

		// Once the captcha is solved the control becomes enabled.
		solveCaptcha();
		expect(getButton()).toHaveProperty("disabled", false);
	});
});

describe("GuestPlayButton — in-flight behavior (R1.6)", () => {
	it("disables the button, shows a spinner, and ignores repeat clicks while in flight", async () => {
		// A mutation that never resolves on its own → the request stays in flight
		// so we can observe the disabled/spinner state and the ignored re-clicks.
		mutateAsync.mockImplementation(() => new Promise(() => {}));

		render(<GuestPlayButton />);
		solveCaptcha();
		const button = getButton();

		await act(async () => {
			fireEvent.click(button);
		});

		// Disabled + loading indicator present.
		await waitFor(() => {
			expect(getButton()).toHaveProperty("disabled", true);
		});
		expect(getButton().getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("status")).toBeDefined();

		// Extra activations while in flight are ignored — the hook's in-flight
		// guard means mutateAsync is only ever called once.
		await act(async () => {
			fireEvent.click(getButton());
			fireEvent.click(getButton());
		});

		expect(mutateAsync).toHaveBeenCalledTimes(1);
		// Still no error shown while pending.
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("hands off the session and clears the spinner on a successful sign-in", async () => {
		mutateAsync.mockResolvedValue({
			accessToken: "guest-token",
			refreshToken: "guest-refresh",
		});

		render(<GuestPlayButton />);
		solveCaptcha();

		await act(async () => {
			fireEvent.click(getButton());
		});

		await waitFor(() => {
			expect(setSession).toHaveBeenCalledTimes(1);
		});
		expect(setSession).toHaveBeenCalledWith({
			access_token: "guest-token",
			refresh_token: "guest-refresh",
		});
		// Navigates to the play screen so the seeded session is picked up there.
		await waitFor(() => {
			expect(push).toHaveBeenCalledWith("/");
		});
		// Spinner gone and no error on success. The single-use captcha token was
		// consumed by the attempt, so the widget is reset and the button is
		// disabled again until a fresh challenge is solved (in real usage the page
		// has already navigated away via the session handoff).
		await waitFor(() => {
			expect(screen.queryByRole("status")).toBeNull();
		});
		expect(getButton()).toHaveProperty("disabled", true);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("GuestPlayButton — failure recovery and no handoff (R1.7, R2.6)", () => {
	it("re-enables, drops the spinner, shows an error, and does NOT hand off the session on failure", async () => {
		mutateAsync.mockRejectedValue(new Error("boom"));

		render(<GuestPlayButton />);
		solveCaptcha();

		await act(async () => {
			fireEvent.click(getButton());
		});

		// Error surfaced (generic non-cap message), spinner gone. The spent
		// single-use token is cleared by the post-attempt widget reset, so the
		// button is disabled until the user solves a fresh challenge — this is
		// what prevents a retry from re-sending a `timeout-or-duplicate` token.
		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe(OTHER_MESSAGE);
		});
		expect(screen.queryByRole("status")).toBeNull();
		expect(getButton()).toHaveProperty("disabled", true);

		// Re-solving the captcha re-enables the button for another attempt.
		solveCaptcha();
		expect(getButton()).toHaveProperty("disabled", false);

		// No session handoff and no navigation → the user stays put.
		expect(setSession).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});

	it("treats the 5s timeout as a failure: error shown, recovered, and no session handoff (R1.7)", async () => {
		vi.useFakeTimers();
		// A request that hangs forever so only the 5s client timeout can settle it.
		mutateAsync.mockImplementation(() => new Promise(() => {}));

		render(<GuestPlayButton />);
		solveCaptcha();

		await act(async () => {
			fireEvent.click(getButton());
		});

		// In flight before the timeout fires.
		expect(getButton()).toHaveProperty("disabled", true);
		expect(screen.getByRole("status")).toBeDefined();

		// Drive the 5s client timeout.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		// Timeout path = failure: generic error, no spinner, and the spent token
		// cleared by the post-attempt reset so the button is disabled again.
		expect(screen.getByRole("alert").textContent).toBe(OTHER_MESSAGE);
		expect(getButton()).toHaveProperty("disabled", true);
		expect(screen.queryByRole("status")).toBeNull();

		// Crucially, the hung request never handed off the session or navigated.
		expect(setSession).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});
});

describe("GuestPlayButton — cap vs non-cap message mapping (R2.5, R2.6)", () => {
	it("maps a CAP_REACHED error (tRPC TOO_MANY_REQUESTS) to the cap message", async () => {
		// The client distinguishes the cap case by the tRPC error code carried in
		// error.data.code (CAP_REACHED is surfaced as TOO_MANY_REQUESTS).
		mutateAsync.mockRejectedValue({ data: { code: "TOO_MANY_REQUESTS" } });

		render(<GuestPlayButton />);
		solveCaptcha();

		await act(async () => {
			fireEvent.click(getButton());
		});

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe(CAP_MESSAGE);
		});
		expect(setSession).not.toHaveBeenCalled();
	});

	it("maps any other error to the generic non-cap message", async () => {
		// A non-cap tRPC code (e.g. count failure / provider failure).
		mutateAsync.mockRejectedValue({ data: { code: "INTERNAL_SERVER_ERROR" } });

		render(<GuestPlayButton />);
		solveCaptcha();

		await act(async () => {
			fireEvent.click(getButton());
		});

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe(OTHER_MESSAGE);
		});
		expect(setSession).not.toHaveBeenCalled();
	});
});
