import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Feature: anonymous-sign-in — client UI gating (R7.3, R7.5).
//
// The home screen hides the duels entry point (HeadToHeadCard) for guests while
// keeping the two realtime game cards (Battle Royale, Race) visible — the single
// permitted exception (R7.5). We drive the gate through the real `useIsGuest`
// selector and mock the heavy, non-UI dependencies the page pulls in at module
// load (socket.io, Supabase client, env, the mounted game bodies, Navbar, and
// the Zustand stores) so the component renders in jsdom without network/env.

const isGuestMock = vi.fn<() => boolean>();
vi.mock("@/hooks/useIsGuest", () => ({
	useIsGuest: () => isGuestMock(),
}));

// A registered-looking user id so the "play" branch could mount, though these
// tests stay on the pre-play menu where the cards live.
vi.mock("@/state/auth-store", () => {
	const state = { user: { id: "user-1" } };
	const useAuthStore = (selector: (s: typeof state) => unknown) =>
		selector(state);
	return { useAuthStore };
});

vi.mock("@/state/game-session-store", () => {
	const state = { setRealtimeGameActive: vi.fn() };
	const useGameSessionStore = (selector: (s: typeof state) => unknown) =>
		selector(state);
	return { useGameSessionStore };
});

vi.mock("@/state/server-clock-store", () => ({
	useServerClockStore: {
		getState: () => ({ sync: vi.fn(), reset: vi.fn() }),
	},
}));

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_WS_URL: "ws://localhost" } }));

// The duels entry point (HeadToHeadCard) links via next/router, which has no
// mounted router in jsdom; stub it so the registered-user render succeeds.
vi.mock("next/router", () => ({
	useRouter: () => ({ pathname: "/", push: vi.fn() }),
}));

vi.mock("socket.io-client", () => ({ io: vi.fn() }));

vi.mock("@/utils/supabase/client", () => ({
	createClient: () => ({
		auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
	}),
}));

// The realtime game bodies open socket connections on mount; the pre-play menu
// never renders them in these tests, but they are imported at module load so we
// stub them to inert placeholders.
vi.mock("@/components/games/battle-royale", () => ({
	default: () => <div data-testid="battle-royale-game" />,
}));
vi.mock("@/components/games/race", () => ({
	default: () => <div data-testid="race-game" />,
}));

// Navbar runs its own auth init + guest read; swap it for a marker so this test
// focuses on the home-screen card gating only.
vi.mock("@/components/navigation/navbar", () => ({
	default: () => <nav data-testid="navbar" />,
}));

import Home from "./index";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Home screen guest gating (R7.3, R7.5)", () => {
	it("hides the duels entry point for a guest but keeps the realtime game cards", () => {
		isGuestMock.mockReturnValue(true);

		render(<Home />);

		// Duels (HeadToHeadCard) is gone for guests...
		expect(screen.queryByText("Head to head")).toBeNull();
		// ...while the two realtime game cards remain (R7.5, the exception).
		expect(screen.getByText("Battle Royale")).toBeDefined();
		expect(screen.getByText("Elimination Race")).toBeDefined();
	});

	it("shows the duels entry point and the realtime game cards for a registered user", () => {
		isGuestMock.mockReturnValue(false);

		render(<Home />);

		// Registered users see the duels entry point and both realtime cards.
		expect(screen.getByText("Head to head")).toBeDefined();
		expect(screen.getByText("Battle Royale")).toBeDefined();
		expect(screen.getByText("Elimination Race")).toBeDefined();
	});
});
