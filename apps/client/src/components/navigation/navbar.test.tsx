import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Navbar renders the primary nav links (Home, Friends, Stats, Leaderboard)
// for a signed-in user. The auth store is mocked wholesale because importing it
// at module load constructs a Supabase browser client (which needs env +
// network shaping we don't want in jsdom); the Navbar only reads a few scalar
// fields and two callbacks from it.

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

describe("Navbar", () => {
	it("renders the primary nav links for a signed-in user", () => {
		render(<Navbar />);

		expect(screen.getByRole("link", { name: "Home" })).toBeDefined();
		const friends = screen.getByRole("link", { name: "Friends" });
		expect(friends).toBeDefined();
		expect(friends.getAttribute("href")).toBe("/friends");
		expect(screen.getByRole("link", { name: "Stats" })).toBeDefined();
		expect(screen.getByRole("link", { name: "Leaderboard" })).toBeDefined();
	});
});
