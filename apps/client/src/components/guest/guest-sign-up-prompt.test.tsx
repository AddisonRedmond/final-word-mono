import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in — the guest one-game-per-mode sign-up prompt (R6.5).
//
// GuestSignUpPrompt is presentational: it renders a sign-up invitation and a
// navigable action to /sign-in only when the latest join:error reason is the
// guest-mode-limit reason, and renders nothing for any other reason.
//
// next/link renders a plain anchor in jsdom; next/router is stubbed only so the
// Link's module-load dependencies resolve cleanly. "Navigable action" is
// asserted via the rendered anchor's href (matching the navbar test's pattern).
vi.mock("next/router", () => ({
	useRouter: () => ({ pathname: "/", push: vi.fn() }),
}));

import GuestSignUpPrompt, {
	GUEST_MODE_LIMIT_REASON,
} from "./guest-sign-up-prompt";

afterEach(() => {
	cleanup();
});

describe("GuestSignUpPrompt (R6.5)", () => {
	it("renders the sign-up invitation and a navigable action to /sign-in on guest-mode-limit", () => {
		render(<GuestSignUpPrompt reason={GUEST_MODE_LIMIT_REASON} />);

		// The invitation copy is present (status region for assistive tech).
		expect(screen.getByRole("status")).toBeDefined();
		expect(screen.getByText(/one game per mode/i)).toBeDefined();

		// A navigable action pointing at the sign-up flow.
		const action = screen.getByRole("link", { name: /sign up to continue/i });
		expect(action).toBeDefined();
		expect(action.getAttribute("href")).toBe("/sign-in");
	});

	it("renders nothing for the registered-user daily-limit reason", () => {
		const { container } = render(<GuestSignUpPrompt reason="daily-limit" />);

		expect(container.firstChild).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
		expect(
			screen.queryByRole("link", { name: /sign up to continue/i }),
		).toBeNull();
	});

	it("renders nothing when no join-error reason is active", () => {
		const { container: undefinedContainer } = render(
			<GuestSignUpPrompt reason={undefined} />,
		);
		expect(undefinedContainer.firstChild).toBeNull();

		cleanup();

		const { container: nullContainer } = render(
			<GuestSignUpPrompt reason={null} />,
		);
		expect(nullContainer.firstChild).toBeNull();
	});
});
