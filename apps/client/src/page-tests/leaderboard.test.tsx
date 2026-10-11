import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature: retention-foundation Task 5.5 — Page/UI tests for the /leaderboard
// page (R3.4 caller row pinned when off-page, R3.7 premium columns gated
// without hiding the core ranking, plus loading/empty states).
//
// The page reads the auth store (authResolved + user), the guest selector, and
// two tRPC queries (billing.status for the premium gate, leaderboard.board for
// the ranked page). We mock those boundaries so it renders in jsdom and drive
// each state through the mock return values.

const isGuestMock = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useIsGuest", () => ({
	useIsGuest: () => isGuestMock(),
}));

// The page selects `authResolved` and `user` from the auth store; the real
// store builds a Supabase browser client at module load, so stub it.
const authState = {
	authResolved: true,
	user: { id: "me" } as { id: string } | null,
};
vi.mock("@/state/auth-store", () => {
	const useAuthStore = (selector: (s: typeof authState) => unknown) =>
		selector(authState);
	return { useAuthStore };
});

vi.mock("@/components/navigation/navbar", () => ({
	default: () => <nav data-testid="navbar" />,
}));

const billingStatusQuery = vi.fn();
const boardQuery = vi.fn();
vi.mock("@/utils/api", () => ({
	api: {
		billing: {
			status: { useQuery: () => billingStatusQuery() },
		},
		leaderboard: {
			board: { useQuery: () => boardQuery() },
		},
	},
}));

import Leaderboard from "@/pages/leaderboard";

type Entry = {
	placement: number;
	userId: string;
	name: string | null;
	seasonPoints: number;
	wins: number;
	gamesPlayed: number;
	averagePlacement: number | null;
	bestMatchPoints: number;
	isCurrentUser: boolean;
};

const makeEntry = (over: Partial<Entry> & { placement: number; userId: string }): Entry => ({
	name: `Player ${over.userId}`,
	seasonPoints: 100 - over.placement,
	wins: 5,
	gamesPlayed: 10,
	averagePlacement: 3.2,
	bestMatchPoints: 30,
	isCurrentUser: false,
	...over,
});

const setBoard = (value: {
	data?: {
		entries: Entry[];
		me: Entry | null;
		totalQualified: number;
		isCurrentSeason: boolean;
	};
	isLoading?: boolean;
	isError?: boolean;
	error?: { message: string } | null;
}) =>
	boardQuery.mockReturnValue({
		isLoading: false,
		isError: false,
		error: null,
		...value,
	});

beforeEach(() => {
	authState.authResolved = true;
	authState.user = { id: "me" };
	isGuestMock.mockReturnValue(false);
	billingStatusQuery.mockReturnValue({ data: { isPremium: false } });
	setBoard({ data: undefined, isLoading: true });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("/leaderboard page states (R3.4, R3.7)", () => {
	it("renders a loading state while the board is being fetched", () => {
		setBoard({ data: undefined, isLoading: true });

		render(<Leaderboard />);

		expect(screen.getByText("Loading…")).toBeDefined();
	});

	it("renders an empty board state when no one qualifies this season", () => {
		setBoard({
			isLoading: false,
			data: {
				entries: [],
				me: null,
				totalQualified: 0,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		expect(
			screen.getByText(/No qualifying games this season yet/),
		).toBeDefined();
	});

	it("renders the ranked table for a populated board", () => {
		setBoard({
			isLoading: false,
			data: {
				entries: [
					makeEntry({ placement: 1, userId: "a", name: "Alice" }),
					makeEntry({ placement: 2, userId: "b", name: "Bob" }),
				],
				me: null,
				totalQualified: 2,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		expect(screen.getByText("Alice")).toBeDefined();
		expect(screen.getByText("Bob")).toBeDefined();
		// The core headline columns are always present.
		expect(screen.getByText("Points")).toBeDefined();
		expect(screen.getByText("Wins")).toBeDefined();
		expect(screen.getByText("Games")).toBeDefined();
	});

	it("pins the caller's own row when it falls outside the visible page (R3.4)", () => {
		const me = makeEntry({
			placement: 142,
			userId: "me",
			name: "Me",
			isCurrentUser: true,
		});
		setBoard({
			isLoading: false,
			data: {
				entries: [
					makeEntry({ placement: 1, userId: "a", name: "Alice" }),
					makeEntry({ placement: 2, userId: "b", name: "Bob" }),
				],
				me,
				totalQualified: 142,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		// The caller is not in the top page but is still surfaced, with the "You"
		// marker and their off-page placement.
		expect(screen.getByText("Me")).toBeDefined();
		expect(screen.getByText("You")).toBeDefined();
		expect(screen.getByText("142")).toBeDefined();
	});

	it("does not duplicate the caller's row when it is already on the visible page", () => {
		const me = makeEntry({
			placement: 2,
			userId: "me",
			name: "Me",
			isCurrentUser: true,
		});
		setBoard({
			isLoading: false,
			data: {
				entries: [makeEntry({ placement: 1, userId: "a", name: "Alice" }), me],
				me,
				totalQualified: 2,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		// Only one row for the caller — the pinned block is suppressed when the
		// caller is already visible.
		expect(screen.getAllByText("Me")).toHaveLength(1);
	});

	it("hides premium columns for a free user without hiding the core ranking (R3.7)", () => {
		billingStatusQuery.mockReturnValue({ data: { isPremium: false } });
		setBoard({
			isLoading: false,
			data: {
				entries: [makeEntry({ placement: 1, userId: "a", name: "Alice" })],
				me: null,
				totalQualified: 1,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		// Core ranking visible to free users...
		expect(screen.getByText("Alice")).toBeDefined();
		expect(screen.getByText("Points")).toBeDefined();
		// ...expanded premium columns gated out.
		expect(screen.queryByText("Avg Place")).toBeNull();
		expect(screen.queryByText("Best Match")).toBeNull();
		// And an upgrade nudge is offered.
		expect(screen.getByRole("link", { name: "Upgrade" })).toBeDefined();
	});

	it("shows the premium columns for a premium user", () => {
		billingStatusQuery.mockReturnValue({ data: { isPremium: true } });
		setBoard({
			isLoading: false,
			data: {
				entries: [makeEntry({ placement: 1, userId: "a", name: "Alice" })],
				me: null,
				totalQualified: 1,
				isCurrentSeason: true,
			},
		});

		render(<Leaderboard />);

		expect(screen.getByText("Avg Place")).toBeDefined();
		expect(screen.getByText("Best Match")).toBeDefined();
	});

	it("prompts a guest to sign in instead of showing ranked data (R3.1)", () => {
		isGuestMock.mockReturnValue(true);

		render(<Leaderboard />);

		expect(screen.getByText("Sign in to see the leaderboard")).toBeDefined();
		expect(screen.getByRole("link", { name: "Sign in" })).toBeDefined();
	});
});
