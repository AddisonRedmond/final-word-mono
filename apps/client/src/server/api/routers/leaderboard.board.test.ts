// Feature: retention-foundation, Task 4.5 — leaderboard router tests.
//
// `leaderboard.board` ranks a scored mode's season field live from
// `player_mode_stats` (current season) using the shared `compareSeasonRanking`
// comparator, applies the qualifying filter (QUALIFYING_MIN_GAMES), paginates,
// and ALWAYS surfaces the caller's own rank in `me` even when it falls outside
// the returned page (R3.2, R3.4, R3.6, R8.3). Archived seasons read already
// ordered rows from `season_placements`.
//
// These tests drive the real resolver through `createCaller`, feeding it a
// programmable db stub whose `select(...).from(table)` resolves to a queued
// result set keyed by the table it reads. That exercises the resolver's
// filtering/ranking/pagination/me-surfacing against the production code path
// (not a reimplementation), while the comparator's own tiebreaker ordering is
// covered directly in `apps/server/src/games/season-archival.test.ts`.
//
// `@/env` is stubbed so importing the server barrel needs no real secrets, and
// `@/db/stats` is stubbed so the duels module the barrel pulls imports cleanly.
//
// Validates: Requirements 3.2

import type { PlayerModeStats } from "@/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub env so the server barrel (db + env validation) imports without secrets.
vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "test",
		DATABASE_URL: "postgres://user:pass@localhost:5432/test",
		SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
		NEXT_PUBLIC_WS_URL: "ws://localhost:3001",
	},
}));

// The duels router (pulled in via the root barrel) imports `@/db/stats`; stub it
// so the barrel import does not reach a live db.
vi.mock("@/db/stats", () => ({
	upsertModeStats: vi.fn(async () => undefined),
}));

import { createCaller } from "@/server/api/root";
import {
	playerModeStats,
	profiles,
	seasonKey,
	seasonPlacements,
} from "@/db/schema";

type Caller = ReturnType<typeof createCaller>;
type Context = Extract<Parameters<typeof createCaller>[0], { db: unknown }>;

// Deterministic v4-shaped UUIDs so ids read as real players everywhere.
const uuid = (n: number): string => {
	const hex = n.toString(16).padStart(12, "0").slice(-12);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

/**
 * A seasonal `player_mode_stats` row. Only the fields the ranking + mapping
 * read need to be meaningful; the rest take schema-plausible defaults.
 */
const statsRow = (
	fields: Partial<PlayerModeStats> & { userId: string },
): PlayerModeStats =>
	({
		userId: fields.userId,
		mode: fields.mode ?? "battle_royale",
		scope: fields.scope ?? seasonKey(),
		gamesPlayed: fields.gamesPlayed ?? 1,
		wins: fields.wins ?? 0,
		draws: fields.draws ?? 0,
		currentWinStreak: fields.currentWinStreak ?? 0,
		bestWinStreak: fields.bestWinStreak ?? 0,
		wonLastGame: fields.wonLastGame ?? false,
		totalGuesses: fields.totalGuesses ?? 0,
		totalCorrectGuesses: fields.totalCorrectGuesses ?? 0,
		averagePlacement: fields.averagePlacement ?? null,
		bestPlacement: fields.bestPlacement ?? null,
		solveCount: fields.solveCount ?? 0,
		totalSolveMs: fields.totalSolveMs ?? 0,
		fastestSolveMs: fields.fastestSolveMs ?? null,
		seasonPoints: fields.seasonPoints ?? 0,
		bestMatchPoints: fields.bestMatchPoints ?? 0,
		lastPlayedAt: fields.lastPlayedAt ?? null,
	}) as unknown as PlayerModeStats;

/**
 * A programmable, drizzle-ish `ctx.db`. Each terminal query the resolver runs
 * is `select(...).from(table)...` and is awaited as a thenable. We key a queued
 * result set by the table passed to `.from()`, so the stats query, the archived
 * query, and the names query each receive the right rows regardless of the
 * builder-method chain (`where`, `sort`, `limit`, ...) that follows.
 */
const makeDb = (results: {
	playerModeStats?: unknown[];
	seasonPlacements?: unknown[];
	profiles?: unknown[];
}): Context["db"] => {
	const tableFor = (table: unknown): unknown[] => {
		if (table === playerModeStats) return results.playerModeStats ?? [];
		if (table === seasonPlacements) return results.seasonPlacements ?? [];
		if (table === profiles) return results.profiles ?? [];
		return [];
	};

	// A thenable chain that resolves to `rows`; any builder method returns the
	// same chain so arbitrarily long chains still resolve to `rows`.
	const chainFor = (rows: unknown[]): unknown => {
		const chain: Record<string | symbol, unknown> = {};
		const proxy: unknown = new Proxy(chain, {
			get(_t, prop) {
				if (prop === "then") {
					return (resolve: (v: unknown[]) => unknown) => resolve(rows);
				}
				return () => proxy;
			},
		});
		return proxy;
	};

	const db = {
		select: (_projection?: unknown) => ({
			from: (table: unknown) => chainFor(tableFor(table)),
		}),
	};
	return db as unknown as Context["db"];
};

const buildContext = (
	db: Context["db"],
	userId: string,
): Context =>
	({
		db,
		supabase: null,
		user: { id: userId, is_anonymous: false },
	}) as unknown as Context;

const nameRow = (userId: string, name: string | null) => ({
	id: userId,
	name,
});

describe("leaderboard.board — current season ranking + qualifying + pagination", () => {
	let caller: Caller;
	const callerId = uuid(1);

	beforeEach(() => {
		caller = createCaller(
			buildContext(makeDb({}), callerId),
		);
	});

	it("ranks the current season by the shared comparator (points DESC, then wins)", async () => {
		const a = uuid(10); // most points -> rank 1
		const b = uuid(11); // fewer points -> rank 3
		const c = uuid(12); // same points as none; wins tiebreak over b

		const rows = [
			statsRow({ userId: b, seasonPoints: 20, wins: 1, gamesPlayed: 5 }),
			statsRow({ userId: a, seasonPoints: 50, wins: 3, gamesPlayed: 5 }),
			statsRow({ userId: c, seasonPoints: 20, wins: 4, gamesPlayed: 5 }),
		];

		caller = createCaller(
			buildContext(
				makeDb({
					playerModeStats: rows,
					profiles: [nameRow(a, "A"), nameRow(b, "B"), nameRow(c, "C")],
				}),
				callerId,
			),
		);

		const res = await caller.leaderboard.board({ mode: "battle_royale" });

		expect(res.isCurrentSeason).toBe(true);
		expect(res.totalQualified).toBe(3);
		// a (50 pts) first; then c and b tie on 20 pts, broken by wins DESC (c=4 > b=1).
		expect(res.entries.map((e) => e.userId)).toEqual([a, c, b]);
		expect(res.entries.map((e) => e.placement)).toEqual([1, 2, 3]);
		expect(res.entries[0]?.name).toBe("A");
	});

	it("excludes players below QUALIFYING_MIN_GAMES (default: at least one game)", async () => {
		const played = uuid(20);
		const zero = uuid(21);

		caller = createCaller(
			buildContext(
				makeDb({
					playerModeStats: [
						statsRow({ userId: played, seasonPoints: 10, gamesPlayed: 1 }),
						// A row that exists but recorded zero games must not rank.
						statsRow({ userId: zero, seasonPoints: 99, gamesPlayed: 0 }),
					],
					profiles: [nameRow(played, "Played")],
				}),
				callerId,
			),
		);

		const res = await caller.leaderboard.board({ mode: "battle_royale" });

		expect(res.totalQualified).toBe(1);
		expect(res.entries.map((e) => e.userId)).toEqual([played]);
	});

	it("paginates and surfaces the caller's own rank in `me` even when off-page", async () => {
		// 5 ranked players ahead of the caller, who sits last (rank 6). A page of
		// size 2 shows only the top 2, but `me` still carries the caller's rank.
		const others = [uuid(30), uuid(31), uuid(32), uuid(33), uuid(34)];
		const rows = [
			...others.map((id, i) =>
				statsRow({ userId: id, seasonPoints: 100 - i, gamesPlayed: 3 }),
			),
			statsRow({ userId: callerId, seasonPoints: 1, gamesPlayed: 3 }),
		];

		caller = createCaller(
			buildContext(
				makeDb({
					playerModeStats: rows,
					profiles: [
						...others.map((id, i) => nameRow(id, `P${i}`)),
						nameRow(callerId, "Me"),
					],
				}),
				callerId,
			),
		);

		const res = await caller.leaderboard.board({
			mode: "battle_royale",
			page: 0,
			pageSize: 2,
		});

		// Only the top 2 are on the visible page...
		expect(res.entries).toHaveLength(2);
		expect(res.entries.every((e) => e.isCurrentUser)).toBe(false);
		// ...yet the caller's own row is surfaced with its true rank (6 of 6).
		expect(res.me).not.toBeNull();
		expect(res.me?.userId).toBe(callerId);
		expect(res.me?.isCurrentUser).toBe(true);
		expect(res.me?.placement).toBe(6);
		expect(res.me?.name).toBe("Me");
		expect(res.totalQualified).toBe(6);
	});

	it("returns a null `me` when the caller has no qualifying row", async () => {
		const other = uuid(40);
		caller = createCaller(
			buildContext(
				makeDb({
					playerModeStats: [
						statsRow({ userId: other, seasonPoints: 10, gamesPlayed: 2 }),
					],
					profiles: [nameRow(other, "Other")],
				}),
				callerId,
			),
		);

		const res = await caller.leaderboard.board({ mode: "battle_royale" });

		expect(res.entries.map((e) => e.userId)).toEqual([other]);
		expect(res.me).toBeNull();
	});
});

describe("leaderboard.board — archived season reads from season_placements", () => {
	const callerId = uuid(1);

	it("reads a past season's stored placements already ordered by placement", async () => {
		const first = uuid(50);
		const second = uuid(51);
		const pastSeason = "2020-01"; // definitively not the current season

		const placementRow = (
			userId: string,
			placement: number,
			rankingValue: number,
		) => ({
			userId,
			mode: "battle_royale",
			season: pastSeason,
			placement,
			gamesPlayed: 3,
			wins: 1,
			rankingValue,
			archivedAt: new Date(),
		});

		const caller = createCaller(
			buildContext(
				makeDb({
					// Deliberately out of order to prove the resolver sorts by placement.
					seasonPlacements: [
						placementRow(second, 2, 10),
						placementRow(first, 1, 40),
					],
					profiles: [nameRow(first, "First"), nameRow(second, "Second")],
				}),
				callerId,
			),
		);

		const res = await caller.leaderboard.board({
			mode: "battle_royale",
			season: pastSeason,
		});

		expect(res.isCurrentSeason).toBe(false);
		expect(res.season).toBe(pastSeason);
		expect(res.entries.map((e) => e.userId)).toEqual([first, second]);
		expect(res.entries.map((e) => e.placement)).toEqual([1, 2]);
		// Archived rows carry the stored ranking metric as seasonPoints.
		expect(res.entries[0]?.seasonPoints).toBe(40);
	});
});
