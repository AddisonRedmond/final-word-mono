import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature: retention-foundation Task 5.3 — Rematch + head-to-head on the duel
// result view (R5.1, R5.6, R6.6).
//
// DuelResult pulls in `api` (tRPC/react-query) for the rematch mutation, the
// head-to-head query, and `useUtils` for cache invalidation, plus the toast
// store. We mock those boundaries so the component renders in jsdom without a
// provider/network and we can assert the wiring: the Rematch button only shows
// for a completed duel, firing it calls the mutation + invalidates the active
// list, and the H2H panel renders the rivalry summary line.

const rematchMutateAsync = vi.fn(async () => ({ id: "new-duel" }));
const allDuelsInvalidate = vi.fn(async () => {});
const headToHeadQuery =
	vi.fn<
		() => {
			data:
				| {
						totalGames: number;
						selfWins: number;
						opponentWins: number;
						draws: number;
						streak: {
							outcome: "self" | "opponent" | "draw";
							count: number;
						};
				  }
				| undefined;
			isLoading: boolean;
		}
	>();

vi.mock("@/utils/api", () => ({
	api: {
		useUtils: () => ({
			duels: { allDuels: { invalidate: allDuelsInvalidate } },
		}),
		duels: {
			rematchDuel: {
				useMutation: () => ({ mutateAsync: rematchMutateAsync }),
			},
			headToHead: {
				useQuery: () => headToHeadQuery(),
			},
		},
	},
}));

const toastMock = vi.fn();
vi.mock("@/state/toast-store", () => ({
	toast: (...args: unknown[]) => toastMock(...args),
}));

import type { DuelParticipant } from "@/db/schema";
import type { KeyboardState } from "@/utils/duel";
import DuelResult from "./duel-result";

const baseParticipant: DuelParticipant = {
	userId: "me",
	duelId: "duel-1",
	guesses: ["CRANE"],
	totalGuesses: 1,
	success: true,
	startTime: new Date("2026-01-01T00:00:00Z"),
	endTime: new Date("2026-01-01T00:01:00Z"),
} as DuelParticipant;

const makeDuelData = (completed: boolean) => ({
	duel: {
		id: "duel-1",
		initiatedBy: "me",
		createdAt: new Date("2026-01-01T00:00:00Z"),
		completed,
		winner: "me" as string | null,
		participants: ["me", "sarah"],
	},
	participant: [baseParticipant],
	matchResults: [],
	keyboardState: {} as KeyboardState,
	secretWord: "CRANE",
});

const opponents = [
	{ id: "sarah", name: "Sarah", status: "finished", guesses: ["SLATE"] },
];

beforeEach(() => {
	headToHeadQuery.mockReturnValue({
		data: {
			totalGames: 23,
			selfWins: 11,
			opponentWins: 10,
			draws: 2,
			streak: { outcome: "opponent", count: 2 },
		},
		isLoading: false,
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("DuelResult rematch + head-to-head (R5.1, R5.6, R6.6)", () => {
	it("renders the head-to-head rivalry line for an opponent", () => {
		render(
			<DuelResult
				currentUserId="me"
				duelData={makeDuelData(true)}
				onClose={vi.fn()}
				opponents={opponents}
			/>,
		);

		expect(screen.getByText(/You vs\. Sarah/)).toBeDefined();
		expect(
			screen.getByText(/23 games, 11-10, 2 draws, Sarah won the last 2/),
		).toBeDefined();
	});

	it("shows the Rematch button for a completed duel and wires it to the mutation + list refresh", async () => {
		const onClose = vi.fn();
		render(
			<DuelResult
				currentUserId="me"
				duelData={makeDuelData(true)}
				onClose={onClose}
				opponents={opponents}
			/>,
		);

		const button = screen.getByRole("button", { name: "Rematch" });
		fireEvent.click(button);

		// The mutation targets the source duel, then the active duels list is
		// invalidated so the new duel surfaces like any other, and the view closes.
		await vi.waitFor(() => {
			expect(rematchMutateAsync).toHaveBeenCalledWith({
				sourceDuelId: "duel-1",
			});
			expect(allDuelsInvalidate).toHaveBeenCalledTimes(1);
			expect(onClose).toHaveBeenCalledTimes(1);
		});
	});

	it("hides the Rematch button while the duel is still in progress", () => {
		render(
			<DuelResult
				currentUserId="me"
				duelData={makeDuelData(false)}
				onClose={vi.fn()}
				opponents={opponents}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Rematch" })).toBeNull();
	});

	it("surfaces the server's tier-aware error message when a rematch is rejected", async () => {
		rematchMutateAsync.mockRejectedValueOnce(
			new Error("You already have the maximum number of active duels."),
		);
		const onClose = vi.fn();
		render(
			<DuelResult
				currentUserId="me"
				duelData={makeDuelData(true)}
				onClose={onClose}
				opponents={opponents}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rematch" }));

		await vi.waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith(
				"You already have the maximum number of active duels.",
				{ variant: "error" },
			);
		});
		// A rejected rematch leaves the result view open so the user can retry.
		expect(onClose).not.toHaveBeenCalled();
	});
});
