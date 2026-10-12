import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The home screen shows the duels entry point (HeadToHeadCard) and the two
// realtime game cards (Battle Royale, Race) for a signed-in user, and holds the
// menu until auth resolves. We mock the heavy, non-UI dependencies the page
// pulls in at module load (socket.io, Supabase client, env, the mounted game
// bodies, Navbar, and the Zustand stores) so the component renders in jsdom
// without network/env.

// A registered-looking user id so the "play" branch could mount, though these
// tests stay on the pre-play menu where the cards live.
// `authResolved` gates the menu: when false the home screen holds a neutral
// loading state (by design, to avoid flashing the wrong guest/registered UI
// before the session resolves). Controllable per-test via this mock.
const authResolvedMock = vi.fn<() => boolean>(() => true);
vi.mock("@/state/auth-store", () => {
	const makeState = () => ({
		user: { id: "user-1" },
		authResolved: authResolvedMock(),
	});
	const useAuthStore = (
		selector: (s: ReturnType<typeof makeState>) => unknown,
	) => selector(makeState());
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

// The home screen reads `stats.champion` to decide whether to gild the hero
// tiles. That tRPC query needs a provider this gating test doesn't mount and is
// unrelated to the card gating under test, so stub `api` to resolve it to a
// non-champion default (no gold, no sparkle).
vi.mock("@/utils/api", () => ({
	api: {
		stats: {
			champion: {
				useQuery: () => ({ data: { isChampion: false } }),
			},
		},
	},
}));

// The duels entry point (HeadToHeadCard) links via next/router, which has no
// mounted router in jsdom; stub it so the registered-user render succeeds.
vi.mock("next/router", () => ({
	useRouter: () => ({ pathname: "/", push: vi.fn(), replace: vi.fn() }),
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

// Navbar runs its own auth init; swap it for a marker so this test focuses on
// the home-screen cards only.
vi.mock("@/components/navigation/navbar", () => ({
	default: () => <nav data-testid="navbar" />,
}));

// The realtime-games-remaining indicator issues a tRPC query (billing.realtimeUsage)
// which needs the tRPC/react-query provider this gating test doesn't mount. It's
// unrelated to the card gating under test, so stub it to an inert marker.
vi.mock("@/components/realtime-games-remaining", () => ({
	default: () => <div data-testid="realtime-games-remaining" />,
}));

import Home from "../pages/index";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	// Default to resolved so the gating tests below render the menu; the
	// readiness test overrides this.
	authResolvedMock.mockReturnValue(true);
});

describe("Home screen", () => {
	it("shows the duels entry point and the realtime game cards for a signed-in user", () => {
		render(<Home />);

		expect(screen.getByText("Head to head")).toBeDefined();
		expect(screen.getByText("Battle Royale")).toBeDefined();
		expect(screen.getByText("Elimination Race")).toBeDefined();
	});

	it("holds the menu (no cards) until auth has resolved, to avoid flashing", () => {
		// Session not yet read: the readiness gate keeps the menu hidden so the
		// UI never flashes the wrong state on first paint.
		authResolvedMock.mockReturnValue(false);

		render(<Home />);

		expect(screen.queryByText("Head to head")).toBeNull();
		expect(screen.queryByText("Battle Royale")).toBeNull();
		expect(screen.queryByText("Elimination Race")).toBeNull();
	});
});
