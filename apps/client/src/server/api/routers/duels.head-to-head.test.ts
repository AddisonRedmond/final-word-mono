// Feature: retention-foundation, Task 4.4 — head-to-head aggregation.
//
// `computeHeadToHead` is the pure core behind the `duels.headToHead` query: it
// takes the caller's and the opponent's `duel_results` rows, keeps only the
// duels BOTH played (the shared-duel intersection), derives one outcome per
// shared duel, and rolls up totals + the rivalry streak. `rivalryStreak` reads
// the run of identical outcomes back from the most recent shared duel.
//
// These helpers do no DB access, so they are unit-tested in isolation here,
// covering draws and the multi-player case where a third party won the duel
// (R6.2, R6.3).
//
// We stub `@/db/stats` and `@/server/api/trpc` for the same reason the sibling
// completion test does: importing the duels router module otherwise pulls the
// live tRPC/db/env context.
//
// Validates: Requirements 6.2, 6.3

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/stats", () => ({
	upsertModeStats: vi.fn(async () => undefined),
}));

vi.mock("@/server/api/trpc", () => ({
	createTRPCRouter: (routes: unknown) => routes,
	guestProtectedProcedure: new Proxy(
		{},
		{
			get: () => () => ({ query: () => ({}), mutation: () => ({}) }),
		},
	),
}));

const { computeHeadToHead, rivalryStreak } = await import("./duels");

// A caller `duel_results` row (the fields computeHeadToHead reads).
const selfRow = (duelId: string, won: boolean, completedAt: string) => ({
	duelId,
	won,
	completedAt: new Date(completedAt),
});

// An opponent `duel_results` row.
const oppRow = (duelId: string, won: boolean) => ({ duelId, won });

const OPP = "opponent-id";

describe("computeHeadToHead — shared-duel aggregation", () => {
	it("returns an empty record when there is no shared history", () => {
		const h2h = computeHeadToHead(OPP, [], []);
		expect(h2h).toEqual({
			opponentId: OPP,
			totalGames: 0,
			selfWins: 0,
			opponentWins: 0,
			draws: 0,
			streak: { outcome: "draw", count: 0 },
			recent: [],
		});
	});

	it("only counts duels BOTH players have a result row for", () => {
		// d1 + d2 are shared; d3 is caller-only, d4 is opponent-only.
		const self = [
			selfRow("d1", true, "2026-01-01T00:00:00Z"),
			selfRow("d2", false, "2026-01-02T00:00:00Z"),
			selfRow("d3", true, "2026-01-03T00:00:00Z"),
		];
		const opp = [oppRow("d1", false), oppRow("d2", true), oppRow("d4", true)];

		const h2h = computeHeadToHead(OPP, self, opp);

		expect(h2h.totalGames).toBe(2);
		expect(h2h.selfWins).toBe(1); // d1
		expect(h2h.opponentWins).toBe(1); // d2
		expect(h2h.draws).toBe(0);
		expect(h2h.recent.map((g) => g.duelId).sort()).toEqual(["d1", "d2"]);
	});

	it("counts a duel as a draw for the pair when neither of the two won it", () => {
		// Multi-player duel won by a THIRD party: both self and opponent lost, so
		// between these two it is a draw (R6.2 draw status).
		const self = [selfRow("d1", false, "2026-02-01T00:00:00Z")];
		const opp = [oppRow("d1", false)];

		const h2h = computeHeadToHead(OPP, self, opp);

		expect(h2h.totalGames).toBe(1);
		expect(h2h.selfWins).toBe(0);
		expect(h2h.opponentWins).toBe(0);
		expect(h2h.draws).toBe(1);
	});

	it("orders recent results newest-first", () => {
		const self = [
			selfRow("old", true, "2026-01-01T00:00:00Z"),
			selfRow("new", false, "2026-03-01T00:00:00Z"),
			selfRow("mid", true, "2026-02-01T00:00:00Z"),
		];
		const opp = [
			oppRow("old", false),
			oppRow("new", true),
			oppRow("mid", false),
		];

		const h2h = computeHeadToHead(OPP, self, opp);

		expect(h2h.recent.map((g) => g.duelId)).toEqual(["new", "mid", "old"]);
	});

	it("tallies wins, losses, and draws across a mixed history", () => {
		const self = [
			selfRow("w1", true, "2026-01-01T00:00:00Z"),
			selfRow("w2", true, "2026-01-02T00:00:00Z"),
			selfRow("l1", false, "2026-01-03T00:00:00Z"),
			selfRow("drawn", false, "2026-01-04T00:00:00Z"),
		];
		const opp = [
			oppRow("w1", false),
			oppRow("w2", false),
			oppRow("l1", true),
			oppRow("drawn", false), // third-party win -> draw for the pair
		];

		const h2h = computeHeadToHead(OPP, self, opp);

		expect(h2h.totalGames).toBe(4);
		expect(h2h.selfWins).toBe(2);
		expect(h2h.opponentWins).toBe(1);
		expect(h2h.draws).toBe(1);
	});
});

describe("rivalryStreak — run ending at the most recent duel", () => {
	it("is a 0-count draw streak for an empty history", () => {
		expect(rivalryStreak([])).toEqual({ outcome: "draw", count: 0 });
	});

	it("counts the opponent's consecutive wins ending at the latest game", () => {
		// Newest-first: opponent won the last 2, then the caller won before that.
		const games = [
			{
				duelId: "d4",
				completedAt: new Date("2026-04-04T00:00:00Z"),
				outcome: "opponent" as const,
			},
			{
				duelId: "d3",
				completedAt: new Date("2026-04-03T00:00:00Z"),
				outcome: "opponent" as const,
			},
			{
				duelId: "d2",
				completedAt: new Date("2026-04-02T00:00:00Z"),
				outcome: "self" as const,
			},
			{
				duelId: "d1",
				completedAt: new Date("2026-04-01T00:00:00Z"),
				outcome: "self" as const,
			},
		];

		expect(rivalryStreak(games)).toEqual({ outcome: "opponent", count: 2 });
	});

	it("breaks the streak at the first differing outcome", () => {
		const games = [
			{
				duelId: "d3",
				completedAt: new Date("2026-04-03T00:00:00Z"),
				outcome: "self" as const,
			},
			{
				duelId: "d2",
				completedAt: new Date("2026-04-02T00:00:00Z"),
				outcome: "draw" as const,
			},
			{
				duelId: "d1",
				completedAt: new Date("2026-04-01T00:00:00Z"),
				outcome: "self" as const,
			},
		];

		expect(rivalryStreak(games)).toEqual({ outcome: "self", count: 1 });
	});

	it("counts the whole history when every outcome matches", () => {
		const games = [
			{
				duelId: "d3",
				completedAt: new Date("2026-04-03T00:00:00Z"),
				outcome: "self" as const,
			},
			{
				duelId: "d2",
				completedAt: new Date("2026-04-02T00:00:00Z"),
				outcome: "self" as const,
			},
			{
				duelId: "d1",
				completedAt: new Date("2026-04-01T00:00:00Z"),
				outcome: "self" as const,
			},
		];

		expect(rivalryStreak(games)).toEqual({ outcome: "self", count: 3 });
	});
});
