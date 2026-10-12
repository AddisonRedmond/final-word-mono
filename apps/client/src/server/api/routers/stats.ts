import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
	type GameMode,
	isPremiumEntitlement,
	LIFETIME_SCOPE,
	type PlayerModeStats,
	playerModeStats,
	profiles,
	seasonKey,
	seasonPlacements,
} from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

/**
 * Which stats scope a `me` read is for. `lifetime` is the all-time aggregate;
 * `season` resolves to the current UTC-month season key (R2.4). The season key
 * is derived server-side from one shared helper (`seasonKey`) so client reads
 * and server writes agree on the boundary (R1.6).
 */
const scopeInput = z.enum([LIFETIME_SCOPE, "season"]);

/**
 * The shape a single mode's stats are returned in. Stored running sums/counts
 * are collapsed into the derived rates the UI actually shows (R2.2, R2.3) —
 * matching the "derive on read" philosophy of the existing per-mode tables.
 *
 * `losses` is derived (gamesPlayed - wins - draws), never stored. Averages are
 * null when there is nothing to average yet (no games / no timed solves), so
 * the page can show an empty state rather than a misleading zero (R2.6).
 *
 * Advanced/premium fields (R2.7) are only populated for premium callers; for
 * free callers they are null and the field is flagged `premiumLocked` so the
 * page can render the gate without breaking the free layout.
 */
export interface ModeStatsView {
	mode: GameMode;
	// --- Free core stats (shown to everyone) ---
	gamesPlayed: number;
	wins: number;
	losses: number;
	draws: number;
	/** 0..1, or null when no games played. */
	winRate: number | null;
	currentWinStreak: number;
	/** Average guesses per game, or null when no games played. */
	averageGuesses: number | null;
	// --- Seasonal + scored-mode only; stays 0 elsewhere (R2A.6). Free. ---
	seasonPoints: number;
	// --- Premium-gated advanced stats (R2.7) ---
	/**
	 * True when the caller is NOT premium. When true, every advanced field below
	 * is null regardless of the stored values, so the free layout renders a gate
	 * rather than a value.
	 */
	premiumLocked: boolean;
	/** Longest win streak — advanced/premium. */
	bestWinStreak: number | null;
	/** Average finishing placement (multiplayer modes) — advanced/premium. */
	averagePlacement: number | null;
	/** Best (lowest) finishing placement (multiplayer modes) — advanced/premium. */
	bestPlacement: number | null;
	/** Average solve time (ms), timed modes — advanced/premium. */
	averageSolveMs: number | null;
	/** Fastest solve time (ms), timed modes — advanced/premium. */
	fastestSolveMs: number | null;
	/** Guess accuracy as a 0..1 rate (correct ÷ total) — advanced/premium. */
	accuracyRate: number | null;
	/** Average correct guesses per game — advanced/premium. */
	averageCorrectGuesses: number | null;
	/** Best single-match points (personal record) — advanced/premium. */
	bestMatchPoints: number | null;
}

/**
 * Shape one stored `player_mode_stats` row into the derived view the `/stats`
 * page consumes. `isPremium` gates the advanced rows (R2.7): when the caller is
 * free, advanced fields are nulled and `premiumLocked` is set so the UI renders
 * the gate without hiding the free layout.
 */
const toModeStatsView = (
	row: PlayerModeStats,
	isPremium: boolean,
): ModeStatsView => {
	const { gamesPlayed, wins, draws } = row;
	const losses = Math.max(0, gamesPlayed - wins - draws);

	const averageGuesses =
		gamesPlayed > 0 ? row.totalGuesses / gamesPlayed : null;
	const averageSolveMs =
		row.solveCount > 0 ? row.totalSolveMs / row.solveCount : null;
	const averageCorrectGuesses =
		gamesPlayed > 0 ? row.totalCorrectGuesses / gamesPlayed : null;
	// Accuracy as a rate: correct ÷ total guesses. Null when the player has made
	// no guesses yet so the UI shows an empty state rather than a 0/0 NaN.
	const accuracyRate =
		row.totalGuesses > 0 ? row.totalCorrectGuesses / row.totalGuesses : null;

	const premiumLocked = !isPremium;

	return {
		mode: row.mode as GameMode,
		// Free core stats — always populated.
		gamesPlayed,
		wins,
		losses,
		draws,
		winRate: gamesPlayed > 0 ? wins / gamesPlayed : null,
		currentWinStreak: row.currentWinStreak,
		averageGuesses,
		seasonPoints: row.seasonPoints,
		// Premium-gated advanced stats: nulled for free callers so the UI renders
		// the upgrade gate instead of a value (R2.7).
		premiumLocked,
		bestWinStreak: isPremium ? row.bestWinStreak : null,
		averagePlacement: isPremium ? row.averagePlacement : null,
		bestPlacement: isPremium ? row.bestPlacement : null,
		averageSolveMs: isPremium ? averageSolveMs : null,
		fastestSolveMs: isPremium ? row.fastestSolveMs : null,
		accuracyRate: isPremium ? accuracyRate : null,
		averageCorrectGuesses: isPremium ? averageCorrectGuesses : null,
		bestMatchPoints: isPremium ? row.bestMatchPoints : null,
	};
};

/**
 * Read-only stats surface for the current (registered, non-guest) user.
 *
 * `me({ scope })` returns the caller's own per-mode aggregates for either their
 * lifetime totals or the current season, shaped with derived rates. It never
 * exposes another player's private data (R2.8, R8.1) — every query is scoped to
 * `ctx.user.id`. `myPlacements()` returns the caller's archived season
 * placements, newest first (R2.5, R4.4).
 *
 * Uses `protectedProcedure` so guests are rejected before any resolver
 * runs, consistent with the duels / friends routers; `/stats` is a
 * registered-only surface (R8.2).
 */
export const statsRouter = createTRPCRouter({
	/**
	 * The caller's per-mode stats for a scope (lifetime or current season),
	 * shaped with derived rates. One entry per mode the user has a row for; a
	 * mode with no games simply has no entry so the page can show an empty state
	 * rather than zeros (R2.6).
	 */
	me: protectedProcedure
		.input(z.object({ scope: scopeInput }).default({ scope: LIFETIME_SCOPE }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			// Resolve the concrete scope value stored in the row: "lifetime" or the
			// current UTC-month season key. Derived from the single shared helper so
			// reads and writes can't drift (R1.6).
			const scopeValue =
				input.scope === LIFETIME_SCOPE ? LIFETIME_SCOPE : seasonKey();

			// Premium entitlement gates advanced stat fields (R2.7). Read from the
			// caller's profile — the same authoritative source billing uses.
			const [profile] = await ctx.db
				.select({
					premiumStatus: profiles.premiumStatus,
					premiumUntil: profiles.premiumUntil,
				})
				.from(profiles)
				.where(eq(profiles.id, userId))
				.limit(1);

			const isPremium = isPremiumEntitlement(
				profile?.premiumStatus,
				profile?.premiumUntil,
			);

			const rows = await ctx.db
				.select()
				.from(playerModeStats)
				.where(
					and(
						eq(playerModeStats.userId, userId),
						eq(playerModeStats.scope, scopeValue),
					),
				);

			return {
				scope: input.scope,
				season: input.scope === LIFETIME_SCOPE ? null : scopeValue,
				isPremium,
				modes: rows.map((row) => toModeStatsView(row, isPremium)),
			};
		}),

	/**
	 * Champion cosmetic flag for the home-screen hero tiles.
	 *
	 * `isChampion` is the caller's CROSS-MODE `profiles.wonLastRealtimeGame`:
	 * true when they won their most recent realtime game across Battle Royale AND
	 * Race combined. The realtime stats pipeline overwrites that single flag on
	 * every realtime game finish (whichever mode finished last), so it drops the
	 * moment the player loses EITHER mode — unlike the old per-mode OR, which
	 * stayed true after a win in one mode and a loss in the other.
	 *
	 * A tiny single-row read scoped to `ctx.user.id` so it never exposes another
	 * player's state (R8.1), kept separate from `me` so the home screen can light
	 * up the FINAL/WORD tiles without pulling the whole per-mode stats payload.
	 */
	champion: protectedProcedure.query(async ({ ctx }) => {
		const [row] = await ctx.db
			.select({ wonLastRealtimeGame: profiles.wonLastRealtimeGame })
			.from(profiles)
			.where(eq(profiles.id, ctx.user.id))
			.limit(1);

		return { isChampion: row?.wonLastRealtimeGame ?? false };
	}),

	/**
	 * The caller's archived season placements (placement history), newest first
	 * (R2.5, R4.4). Only the caller's own rows are returned (R8.1).
	 *
	 * Full history is premium: a free caller only sees the CURRENT season's
	 * placement (enough for the per-mode "Season #N" badge the page shows), while
	 * a premium caller gets every archived season. `isPremium` and `premiumLocked`
	 * are returned so the page can render a "full history is premium" gate without
	 * guessing at entitlement.
	 */
	myPlacements: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;

		// Premium entitlement — read from the caller's profile, the same
		// authoritative source billing and `me` use.
		const [profile] = await ctx.db
			.select({
				premiumStatus: profiles.premiumStatus,
				premiumUntil: profiles.premiumUntil,
			})
			.from(profiles)
			.where(eq(profiles.id, userId))
			.limit(1);

		const isPremium = isPremiumEntitlement(
			profile?.premiumStatus,
			profile?.premiumUntil,
		);

		const rows = await ctx.db
			.select({
				mode: seasonPlacements.mode,
				season: seasonPlacements.season,
				placement: seasonPlacements.placement,
				gamesPlayed: seasonPlacements.gamesPlayed,
				wins: seasonPlacements.wins,
				rankingValue: seasonPlacements.rankingValue,
				archivedAt: seasonPlacements.archivedAt,
			})
			.from(seasonPlacements)
			.where(eq(seasonPlacements.userId, userId))
			// Newest season first; the season key sorts lexicographically ("YYYY-MM").
			.orderBy(desc(seasonPlacements.season));

		const shaped = rows.map((row) => ({
			...row,
			mode: row.mode as GameMode,
		}));

		// Free callers only get the current season's placements (the badge data);
		// premium callers get the entire archived history.
		const currentSeason = seasonKey();
		const placements = isPremium
			? shaped
			: shaped.filter((row) => row.season === currentSeason);

		return {
			isPremium,
			premiumLocked: !isPremium,
			currentSeason,
			placements,
		};
	}),
});
