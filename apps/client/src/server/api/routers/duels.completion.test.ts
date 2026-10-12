// Feature: retention-foundation, Task 2.5 — duel-completion pipeline tests.
//
// `persistDuelCompletion` runs inside the transaction that flips a duel to
// `completed = true` (shared by handleDuelGuess / declineDuel / forfeitDuel).
// For every participant who actually finished a timed attempt it:
//   1. inserts exactly one immutable `duel_results` row, idempotent on
//      (duelId, userId) via onConflictDoNothing — a replay is a no-op; and
//   2. folds the finisher into `player_mode_stats` with mode "duel" for both the
//      lifetime and the current-season scope, carrying NO points (duel is not a
//      scored mode).
//
// We mock the writer's two collaborators: `@/db/stats` so the mode-stats fold is
// captured instead of hitting a DB, and `@/server/api/trpc` so importing the
// duels module doesn't pull in the live db/env context. The `duel_results`
// insert is exercised for real against a stub transaction that faithfully
// models the `(duelId, userId)` primary key + `onConflictDoNothing`, so the
// idempotency assertion is about the production insert, not the stub.
//
// Validates: Requirements 1.5, 2A.6, 6.1

import type { DuelParticipant } from "@/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture every upsertModeStats call so we can assert the duel fold writes a
// lifetime + seasonal row carrying no points.
type ModeStatsCall = {
	userId: string;
	mode: string;
	scope: string;
	outcome: Record<string, unknown>;
};
const modeStatsCalls: ModeStatsCall[] = [];

vi.mock("@/db/stats", () => ({
	upsertModeStats: vi.fn(
		async (
			_tx: unknown,
			args: { userId: string; mode: string; scope: string; outcome: Record<string, unknown> },
		) => {
			modeStatsCalls.push({
				userId: args.userId,
				mode: args.mode,
				scope: args.scope,
				outcome: args.outcome,
			});
		},
	),
}));

// Importing the duels router module would otherwise pull the real tRPC context
// (db connection, supabase, env). Stub the trpc surface so the module imports
// cleanly; the test only touches the exported `persistDuelCompletion`.
vi.mock("@/server/api/trpc", () => ({
	createTRPCRouter: (routes: unknown) => routes,
	protectedProcedure: new Proxy(
		{},
		{
			get: () => () => ({ query: () => ({}), mutation: () => ({}) }),
		},
	),
}));

// Import AFTER the mocks are registered.
const { persistDuelCompletion } = await import("./duels");

// A stub transaction that records duel_results inserts and models the
// (duelId, userId) PK + onConflictDoNothing exactly: a second insert for a key
// already present is dropped. Returned by makeTx so each test is isolated.
type DuelResultRow = {
	duelId: string;
	userId: string;
	won: boolean;
	isDraw: boolean;
	solved: boolean;
	guesses: number;
	solveMs: number | null;
	completedAt: Date;
	season: string;
};

const makeTx = () => {
	const rows: DuelResultRow[] = [];
	const seen = new Set<string>();
	const tx = {
		insert: (_table: unknown) => ({
			values: (row: DuelResultRow) => ({
				// Mirror onConflictDoNothing on the composite PK: skip a duplicate.
				onConflictDoNothing: (_cfg: unknown) => {
					const key = `${row.duelId}:${row.userId}`;
					if (!seen.has(key)) {
						seen.add(key);
						rows.push(row);
					}
					return Promise.resolve(undefined);
				},
			}),
		}),
	};
	return { tx, rows };
};

// Deterministic v4-shaped UUIDs so UUID_RE treats generated ids as real players.
const uuid = (n: number): string => {
	const hex = n.toString(16).padStart(12, "0").slice(-12);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makeParticipant = (
	fields: Partial<DuelParticipant> & { userId: string },
): DuelParticipant => ({
	duelId: "d",
	userId: fields.userId,
	// Use `in` so an explicitly-passed null (a never-finished participant) is
	// honored rather than coalesced back to a default end time.
	startTime: "startTime" in fields ? (fields.startTime ?? null) : new Date(0),
	endTime: "endTime" in fields ? (fields.endTime ?? null) : new Date(1000),
	totalGuesses: fields.totalGuesses ?? 3,
	success: fields.success ?? true,
	guesses: fields.guesses ?? [],
	accepted: fields.accepted ?? true,
	forfeited: fields.forfeited ?? false,
	completed_game_acknowledged: fields.completed_game_acknowledged ?? false,
});

describe("persistDuelCompletion — duel_results per finisher + mode-stats fold", () => {
	beforeEach(() => {
		modeStatsCalls.length = 0;
	});

	it("writes exactly one duel_results row per finisher (winner + loser)", async () => {
		const winner = uuid(1);
		const loser = uuid(2);
		const duelId = uuid(100);
		const completedAt = new Date("2026-03-15T12:00:00Z");

		const { tx, rows } = makeTx();
		await persistDuelCompletion(tx as never, {
			duelId,
			winner,
			participants: [
				makeParticipant({ userId: winner, success: true }),
				makeParticipant({ userId: loser, success: false }),
			],
			completedAt,
		});

		// One row for each of the two finishers, no more.
		expect(rows).toHaveLength(2);
		const byUser = new Map(rows.map((r) => [r.userId, r]));

		expect(byUser.get(winner)?.won).toBe(true);
		expect(byUser.get(winner)?.isDraw).toBe(false);
		expect(byUser.get(loser)?.won).toBe(false);

		// Denormalized completion fields are carried onto every row.
		for (const row of rows) {
			expect(row.duelId).toBe(duelId);
			expect(row.completedAt).toBe(completedAt);
			expect(row.season).toBe("2026-03"); // YYYY-MM of completedAt (UTC)
			// A finisher's solveMs is endTime - startTime (1000 - 0 here).
			expect(row.solveMs).toBe(1000);
		}
	});

	it("records no duel_results row for a participant who never finished (no endTime)", async () => {
		const player = uuid(3);
		const neverPlayed = uuid(4);

		const { tx, rows } = makeTx();
		await persistDuelCompletion(tx as never, {
			duelId: uuid(101),
			winner: player,
			participants: [
				makeParticipant({ userId: player }),
				// An invitee who let the duel resolve: no endTime -> no result row.
				makeParticipant({ userId: neverPlayed, endTime: null }),
			],
			completedAt: new Date("2026-03-15T12:00:00Z"),
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.userId).toBe(player);
		// The non-finisher is not folded into mode stats either.
		expect(modeStatsCalls.some((c) => c.userId === neverPlayed)).toBe(false);
	});

	it("is idempotent on replay: re-running completion never double-writes a result row", async () => {
		const a = uuid(5);
		const b = uuid(6);
		const duelId = uuid(102);
		const args = {
			duelId,
			winner: a,
			participants: [
				makeParticipant({ userId: a, success: true }),
				makeParticipant({ userId: b, success: false }),
			],
			completedAt: new Date("2026-04-01T00:00:00Z"),
		};

		const { tx, rows } = makeTx();
		await persistDuelCompletion(tx as never, args);
		expect(rows).toHaveLength(2);

		// Replay the SAME completion (e.g. a retried transaction): the composite
		// PK + onConflictDoNothing drops the duplicates, so the fact table is
		// unchanged.
		await persistDuelCompletion(tx as never, args);
		expect(rows).toHaveLength(2);
	});

	it("folds each finisher into player_mode_stats (lifetime + season) with mode 'duel' and no points", async () => {
		const a = uuid(7);
		const b = uuid(8);

		await (async () => {
			const { tx } = makeTx();
			await persistDuelCompletion(tx as never, {
				duelId: uuid(103),
				winner: a,
				participants: [
					makeParticipant({ userId: a, success: true }),
					makeParticipant({ userId: b, success: false }),
				],
				completedAt: new Date("2026-04-10T08:30:00Z"),
			});
		})();

		// Two finishers x (lifetime + season) = four mode-stats upserts.
		expect(modeStatsCalls).toHaveLength(4);

		for (const call of modeStatsCalls) {
			// Every fold targets the duel mode...
			expect(call.mode).toBe("duel");
			// ...and NEVER carries points — duel is not a scored mode (R2A.8).
			expect(call.outcome).not.toHaveProperty("points");
		}

		// Each finisher got exactly one lifetime row and one seasonal row.
		for (const userId of [a, b]) {
			const scopes = modeStatsCalls
				.filter((c) => c.userId === userId)
				.map((c) => c.scope)
				.sort();
			expect(scopes).toEqual(["2026-04", "lifetime"]);
		}
	});

	it("marks everyone a draw when the completed duel has no winner", async () => {
		const a = uuid(9);
		const b = uuid(10);

		const { tx, rows } = makeTx();
		await persistDuelCompletion(tx as never, {
			duelId: uuid(104),
			winner: null, // a draw: nobody won
			participants: [
				makeParticipant({ userId: a, success: true }),
				makeParticipant({ userId: b, success: true }),
			],
			completedAt: new Date("2026-05-20T10:00:00Z"),
		});

		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.won).toBe(false);
			expect(row.isDraw).toBe(true);
		}
	});
});
