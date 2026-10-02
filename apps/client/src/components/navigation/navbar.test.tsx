import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in — client UI gating (R7.4).
//
// The Navbar hides the Friends link for guests. We drive the gate through the
// single `useIsGuest` selector so the test exercises the real conditional in
// the component. The auth store is mocked wholesale because importing it at
// module load constructs a Supabase browser client (which needs env + network
// shaping we don't want in jsdom); the Navbar only reads a few scalar fields
// and two callbacks from it.

const isGuestMock = vi.fn<() => boolean>();
vi.mock("@/hooks/useIsGuest", () => ({
	useIsGuest: () => isGuestMock(),
}));

// Minimal auth-store stub: Navbar selects profileName/profileEmail and the
// initializeAuth/signOut callbacks via selector functions.
vi.mock("@/state/auth-store", () => {
	const state = {
		profileName: "Jane Doe",
		profileEmail: "jane@example.com",
		initializeAuth: vi.fn(),
		signOut: vi.fn(async () => {}),
	};
	const useAuthStore = (selector: (s: typeof state) => unknown) =>
		selector(state);
	return { useAuthStore };
});

// next/router — Navbar reads router.pathname and calls router.push on sign-out.
vi.mock("next/router", () => ({
	useRouter: () => ({ pathname: "/", push: vi.fn() }),
}));

import Navbar from "./navbar";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Navbar guest gating (R7.4)", () => {
	it("hides the Friends link when the session is a guest", () => {
		isGuestMock.mockReturnValue(true);

		render(<Navbar />);

		// Home is always present; Friends must not be in the document for a guest.
		expect(screen.getByRole("link", { name: "Home" })).toBeDefined();
		expect(screen.queryByRole("link", { name: "Friends" })).toBeNull();
	});

	it("shows the Friends link when the session is a registered user", () => {
		isGuestMock.mockReturnValue(false);

		render(<Navbar />);

		expect(screen.getByRole("link", { name: "Home" })).toBeDefined();
		const friends = screen.getByRole("link", { name: "Friends" });
		expect(friends).toBeDefined();
		expect(friends.getAttribute("href")).toBe("/friends");
	});
});
