import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature: retention-foundation Task 5.5 — Page/UI tests for the /stats page
// (R2.6 loading/empty states, R2.7 premium gating must not break the free
// layout).
//
// The Stats page pulls in the tRPC `api` (two react-query reads), the auth
// store, and the require-auth hook. We mock those boundaries so the page
// renders in jsdom without a provider/network, and drive each state (loading,
// empty, populated, premium-gated) through the mock return values.

// useRequireAuth only reports whether auth has resolved for these tests; the
// redirect side-effect needs next/router, which we stub below.
const authResolvedMock = vi.fn<() => boolean>(() => true);
vi.mock("@/hooks/useRequireAuth", () => ({
	useRequireAuth: () => ({ authResolved: authResolvedMock() }),
}));

// The page selects `user` from the auth store; importing the real store at
// module load constructs a Supabase browser client (env + network), so stub it.
vi.mock("@/state/auth-store", () => {
	const state = { user: { id: "user-1" } as { id: string } | null };
	const useAuthStore = (selector: (s: typeof state) => unknown) =>
		selector(state);
	return { useAuthStore };
});

// Navbar runs its own auth init; swap it for an inert marker so these tests
// focus on the stats surface only.
vi.mock("@/components/navigation/navbar", () => ({
	default: () => <nav data-testid="navbar" />,
}));

// The two reads the page makes. Each test sets the return values it needs.
const statsMeQuery = vi.fn();
const myPlacementsQuery = vi.fn();
vi.mock("@/utils/api", () => ({
	api: {
		stats: {
			me: { useQuery: () => statsMeQuery() },
			myPlacements: { useQuery: () => myPlacementsQuery() },
		},
	},
}));

import Stats from "@/pages/stats";
import type { ModeStatsView } from "@/server/api/routers/stats";

/** A fully-populated mode view; override per test for the case under exercise. */
const makeMode = (over: Partial<ModeStatsView> = {}): ModeStatsView => ({
	mode: "battle_royale",
	// Free core.
	gamesPlayed: 10,
	wins: 4,
	losses: 5,
	draws: 1,
	winRate: 0.4,
	currentWinStreak: 2,
	averageGuesses: 4.2,
	seasonPoints: 0,
	// Premium-gated advanced (null when premiumLocked for a free caller).
	premiumLocked: true,
	bestWinStreak: 3,
	averagePlacement: 3.5,
	bestPlacement: 1,
	averageSolveMs: null,
	fastestSolveMs: null,
	accuracyRate: null,
	averageCorrectGuesses: null,
	bestMatchPoints: 0,
	...over,
});

/** The `myPlacements` read now returns an object, not a bare array. */
const makePlacements = (
	rows: Array<Record<string, unknown>> = [],
	over: Partial<{ isPremium: boolean; premiumLocked: boolean }> = {},
) => ({
	data: {
		isPremium: over.isPremium ?? false,
		premiumLocked: over.premiumLocked ?? true,
		currentSeason: "2026-10",
		placements: rows,
	},
});

const setStatsMe = (value: {
	data?: {
		scope: "lifetime" | "season";
		season: string | null;
		isPremium: boolean;
		modes: ModeStatsView[];
	};
	isLoading: boolean;
}) => statsMeQuery.mockReturnValue(value);

beforeEach(() => {
	authResolvedMock.mockReturnValue(true);
	myPlacementsQuery.mockReturnValue(makePlacements());
	setStatsMe({ isLoading: false, data: undefined });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("/stats page states (R2.6, R2.7)", () => {
	it("renders a loading state while stats are being fetched", () => {
		setStatsMe({ isLoading: true, data: undefined });

		render(<Stats />);

		expect(screen.getByText("Loading your stats…")).toBeDefined();
		// No mode card headers while loading.
		expect(screen.queryByText("No games yet")).toBeNull();
	});

	it("shows an empty state (not zeros) when the user has no games", () => {
		setStatsMe({
			isLoading: false,
			data: {
				scope: "lifetime",
				season: null,
				isPremium: false,
				modes: [],
			},
		});

		render(<Stats />);

		// The empty state copy stands in for a card full of misleading zeros.
		expect(screen.getByText("No games yet")).toBeDefined();
		expect(screen.getByRole("link", { name: "Play a game" })).toBeDefined();
	});

	it("renders per-mode cards with core counters when the user has stats", () => {
		setStatsMe({
			isLoading: false,
			data: {
				scope: "lifetime",
				season: null,
				isPremium: true,
				modes: [makeMode({ premiumLocked: false, averageCorrectGuesses: 3.1 })],
			},
		});

		render(<Stats />);

		expect(screen.getByText("Battle Royale")).toBeDefined();
		// Core counters are present (games/wins/losses/win rate from fixture).
		expect(screen.getByText("Games")).toBeDefined();
		expect(screen.getByText("Win rate")).toBeDefined();
		expect(screen.getByText("40%")).toBeDefined();
		// No empty/loading state when cards are present.
		expect(screen.queryByText("No games yet")).toBeNull();
		expect(screen.queryByText("Loading your stats…")).toBeNull();
	});

	it("renders a premium gate (not a broken layout) for a free user's advanced rows", () => {
		setStatsMe({
			isLoading: false,
			data: {
				scope: "lifetime",
				season: null,
				isPremium: false,
				modes: [makeMode({ premiumLocked: true, averageCorrectGuesses: null })],
			},
		});

		render(<Stats />);

		// The card still renders its core counters alongside the gated row...
		expect(screen.getByText("Battle Royale")).toBeDefined();
		expect(screen.getByText("Games")).toBeDefined();
		// ...and the advanced section shows the upgrade prompt rather than a value.
		expect(screen.getByText("Advanced stats")).toBeDefined();
		const upgrade = screen.getByRole("link", { name: "Upgrade" });
		expect(upgrade.getAttribute("href")).toBe("/api/polar/checkout");
		// The free-locked advanced metric is not rendered as a value.
		expect(screen.queryByText("Avg correct")).toBeNull();
	});

	it("shows the current-season placement badge on a scored mode when known", () => {
		setStatsMe({
			isLoading: false,
			data: {
				scope: "season",
				season: "2026-10",
				isPremium: true,
				modes: [
					makeMode({
						premiumLocked: false,
						seasonPoints: 42,
						bestMatchPoints: 20,
					}),
				],
			},
		});
		myPlacementsQuery.mockReturnValue(
			makePlacements(
				[
					{
						mode: "battle_royale",
						season: "2026-10",
						placement: 7,
						gamesPlayed: 10,
						wins: 4,
						rankingValue: 42,
						archivedAt: new Date(),
					},
				],
				{ isPremium: true, premiumLocked: false },
			),
		);

		render(<Stats />);

		// The placement badge and season-points rows are only shown on the
		// season view, so switch the toggle to "This season" first (R2.4/R2.5).
		fireEvent.click(screen.getByRole("button", { name: "This season" }));

		expect(screen.getByText("Season #7")).toBeDefined();
		// Season points surface on the scored seasonal card.
		expect(screen.getByText("Season points")).toBeDefined();
		expect(screen.getByText("42")).toBeDefined();
	});
});
