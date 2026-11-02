import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
	LIFETIME_SCOPE,
	type PlayerModeStats,
	playerModeStats,
	profiles,
	SCORED_MODES,
	type ScoredMode,
	seasonKey,
	seasonPlacements,
} from "@/db/schema";
import { compareSeasonRanking } from "@/db/ranking";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import type { db } from "@/server/db";

/** The server-side Drizzle handle, as exposed on the tRPC context. */
type Db = typeof db;

/**
 * Minimum games in a season/mode a player must have to appear on the
 * leaderboard (R3.6, R8.3). Trivially-ranked empty rows are excluded. Kept as a
 * module constant so the qualifying bar is tunable without a schema change;
 * default is "played at least one game".
 */
const QUALIFYING_MIN_GAMES = 1;

/** How many ranked rows a single board page returns by default (R3.4). */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** A single ranked leaderboard entry (R3.5). */
type LeaderboardEntry = {
	placement: number;
	userId: string;
	name: string | null;
	seasonPoints: number;
	wins: number;
	gamesPlayed: number;
	averagePlacement: number | null;
	bestMatchPoints: number;
	/** True for the caller's own row, so the client can highlight it. */
	isCurrentUser: boolean;
};

const boardInput = z.object({
	// Only scored modes have a Phase 1 points leaderboard (R3.2, R2A.8).
	mode: z.enum(SCORED_MODES),
	// Omitted => the live current UTC-month season. Otherwise a "YYYY-MM" key of
	// a (possibly archived) past season.
	season: z
		.string()
		.regex(/^\d{4}-\d{2}$/, "season must be a YYYY-MM key")
		.optional(),
	page: z.number().int().min(0).optional(),
	pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

/**
 * Attach display names to ranked rows, resolving them in one query. Rows whose
 * profile is missing (e.g. a deleted account) keep a null name rather than
 * dropping out of the ranking.
 */
const attachNames = async (
	tx: Db,
	userIds: string[],
): Promise<Map<string, string | null>> => {
	const names = new Map<string, string | null>();
	if (userIds.length === 0) {
		return names;
	}
	const rows = await tx
		.select({ id: profiles.id, name: profiles.name })
		.from(profiles)
		.where(inArray(profiles.id, userIds));
	for (const row of rows) {
		names.set(row.id, row.name);
	}
	return names;
};

/**
 * `leaderboard` router — the global, seasonal, scored-mode-only ranking surface
 * (R3). Phase 1 ranks `battle_royale` and `race` by Season_Points with the
 * deterministic tiebreakers defined once in `compareSeasonRanking` (so the live
 * board matches archival exactly). `duel` is intentionally not rankable here
 * (R2A.8).
 */
export const leaderboardRouter = createTRPCRouter({
	/**
	 * The list of seasons the season selector should offer, newest first.
	 *
	 * Derived live from the data rather than a hard-coded window: every distinct
	 * seasonal `scope` ("YYYY-MM") present in `player_mode_stats` for a scored
	 * mode is a selectable season (R3.3). The current UTC month is always
	 * included even if no games have been recorded yet, so the board never opens
	 * on a season that isn't in the list. `lifetime` is excluded — it is not a
	 * season.
	 */
	seasons: protectedProcedure.query(async ({ ctx }) => {
		const currentSeason = seasonKey();

		const rows = await ctx.db
			.selectDistinct({ scope: playerModeStats.scope })
			.from(playerModeStats)
			.where(
				and(
					inArray(playerModeStats.mode, [...SCORED_MODES]),
					sql`${playerModeStats.scope} <> ${LIFETIME_SCOPE}`,
				),
			)
			.orderBy(desc(playerModeStats.scope));

		// Merge in the current season (it may have no rows yet) and dedupe,
		// keeping newest-first order.
		const seasons = new Set<string>([currentSeason]);
		for (const row of rows) {
			seasons.add(row.scope);
		}

		return {
			currentSeason,
			seasons: [...seasons].sort((a, b) => b.localeCompare(a)),
		};
	}),

	/**
	 * A ranked page for `mode` in a season.
	 *
	 *   - **Current season** (default, or when `season` equals the current UTC
	 *     month): computed live from `player_mode_stats` seasonal rows, ranked by
	 *     {@link compareSeasonRanking}.
	 *   - **Archived/past season**: read from the `season_placements` snapshot,
	 *     already ordered by stored `placement`.
	 *
	 * Only qualifying real players appear (>= {@link QUALIFYING_MIN_GAMES} game;
	 * bots never have stats rows). The caller's own rank is always surfaced in
	 * `me`, even when it falls outside the returned page (R3.4).
	 */
	board: protectedProcedure
		.input(boardInput)
		.query(async ({ ctx, input }) => {
			const mode = input.mode as ScoredMode;
			const currentSeason = seasonKey();
			const season = input.season ?? currentSeason;
			const isCurrentSeason = season === currentSeason;
			const page = input.page ?? 0;
			const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
			const callerId = ctx.user.id;

			// Fully rank the qualifying field, then slice. Phase 1 leaderboards are
			// per-mode-per-season and already filtered to scored modes, so the field
			// is bounded and ranking in-process keeps the ordering identical to
			// archival (one comparator, no SQL/JS drift).
			//
			// Past seasons read from the `season_placements` snapshot — but only if
			// that season was actually archived. A season that has rolled over
			// without being archived (e.g. archival hasn't run yet) still has its
			// live aggregates in `player_mode_stats`, so we fall back to ranking
			// those. Without this, a past-but-unarchived month shows an empty board
			// even though it has recorded players.
			let archived = false;
			let ranked: RankedRow[];
			if (isCurrentSeason) {
				ranked = await rankCurrentSeason(ctx.db, mode, season);
			} else {
				ranked = await rankArchivedSeason(ctx.db, mode, season);
				archived = ranked.length > 0;
				if (!archived) {
					// Not archived yet — rank the retained seasonal aggregates live.
					ranked = await rankCurrentSeason(ctx.db, mode, season);
				}
			}

			const totalQualified = ranked.length;
			const start = page * pageSize;
			const pageRows = ranked.slice(start, start + pageSize);

			// Resolve names for the visible page plus the caller (so the pinned row
			// renders even when off-page).
			const idsToName = new Set(pageRows.map((r) => r.userId));
			idsToName.add(callerId);
			const names = await attachNames(ctx.db, [...idsToName]);

			const entries: LeaderboardEntry[] = pageRows.map((r) => ({
				...r,
				name: names.get(r.userId) ?? null,
				isCurrentUser: r.userId === callerId,
			}));

			// Surface the caller's own rank even when outside the visible page.
			const callerRank = ranked.find((r) => r.userId === callerId);
			const me: LeaderboardEntry | null = callerRank
				? {
						...callerRank,
						name: names.get(callerId) ?? null,
						isCurrentUser: true,
					}
				: null;

			return {
				mode,
				season,
				isCurrentSeason,
				// True only when the board was served from the archived snapshot. A
				// past season that hasn't been archived is served live, so this is
				// false even though it isn't the current season.
				isArchived: archived,
				page,
				pageSize,
				totalQualified,
				entries,
				me,
			};
		}),
});

/** A ranked row before names are attached. */
type RankedRow = {
	placement: number;
	userId: string;
	seasonPoints: number;
	wins: number;
	gamesPlayed: number;
	averagePlacement: number | null;
	bestMatchPoints: number;
};

/**
 * Rank the live current season from `player_mode_stats`. Reads the seasonal rows
 * for the mode, filters to qualifying players, and orders them with the shared
 * comparator so the ordering is byte-for-byte the same as what archival will
 * later snapshot.
 */
const rankCurrentSeason = async (
	db: Db,
	mode: ScoredMode,
	season: string,
): Promise<RankedRow[]> => {
	const rows = (await db
		.select()
		.from(playerModeStats)
		.where(
			and(eq(playerModeStats.mode, mode), eq(playerModeStats.scope, season)),
		)) as PlayerModeStats[];

	return rows
		.filter((row) => row.gamesPlayed >= QUALIFYING_MIN_GAMES)
		.sort(compareSeasonRanking)
		.map((row, index) => ({
			placement: index + 1,
			userId: row.userId,
			seasonPoints: row.seasonPoints,
			wins: row.wins,
			gamesPlayed: row.gamesPlayed,
			averagePlacement: row.averagePlacement,
			bestMatchPoints: row.bestMatchPoints,
		}));
};

/**
 * Read an archived past season from `season_placements`. The snapshot stores
 * final placement + headline metrics, so no re-ranking is needed; rows are
 * ordered by stored placement. Qualifying was already enforced at archival time,
 * but we keep the same guard for safety.
 */
const rankArchivedSeason = async (
	db: Db,
	mode: ScoredMode,
	season: string,
): Promise<RankedRow[]> => {
	const rows = await db
		.select()
		.from(seasonPlacements)
		.where(
			and(eq(seasonPlacements.mode, mode), eq(seasonPlacements.season, season)),
		);

	return rows
		.filter((row) => row.gamesPlayed >= QUALIFYING_MIN_GAMES)
		.sort((a, b) => a.placement - b.placement)
		.map((row) => ({
			placement: row.placement,
			userId: row.userId,
			// Archival stored the ranking metric (= seasonPoints) in rankingValue.
			seasonPoints: row.rankingValue,
			wins: row.wins,
			gamesPlayed: row.gamesPlayed,
			// season_placements does not snapshot averagePlacement/bestMatchPoints;
			// the archive renders from the stored headline metrics.
			averagePlacement: null,
			bestMatchPoints: 0,
		}));
};
