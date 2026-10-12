"use client";

import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import Navbar from "@/components/navigation/navbar";
import { SCORED_MODES, type ScoredMode, seasonKey } from "@/db/schema";
import { useIsGuest } from "@/hooks/useIsGuest";
import { useAuthStore } from "@/state/auth-store";
import { api } from "@/utils/api";

/**
 * Human-readable labels for the scored modes shown in the mode selector. Phase
 * 1 ranks `battle_royale` and `race` only (duel is excluded from the points
 * leaderboard, R3.2 / R2A.8), so the selector mirrors `SCORED_MODES` exactly.
 */
const MODE_LABELS: Record<ScoredMode, string> = {
	battle_royale: "Battle Royale",
	race: "Race",
};

/**
 * How many past UTC months (in addition to the current one) the season selector
 * offers. The leaderboard router resolves the current season live and reads
 * archived seasons from the snapshot table, so a bounded recent-month list is a
 * reasonable, migration-free way to let players browse history (R3.3).
 */
const PAST_SEASONS_SHOWN = 11;

/** The ranking metric is Season_Points, so an empty board reads as "no games yet". */
const EMPTY_BOARD_COPY =
	"No qualifying games this season yet. Play a scored match to appear here.";

/** Shift a "YYYY-MM" season key by `monthsBack` whole UTC months. */
const shiftSeason = (key: string, monthsBack: number): string => {
	const [year, month] = key.split("-").map(Number);
	// Build a UTC date on the 1st so month arithmetic never rolls day-of-month.
	const d = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 - monthsBack, 1));
	return d.toISOString().slice(0, 7);
};

/** Render "2026-10" as "October 2026" for the season selector. */
const formatSeason = (key: string): string => {
	const [year, month] = key.split("-").map(Number);
	if (!year || !month) {
		return key;
	}
	const d = new Date(Date.UTC(year, month - 1, 1));
	return d.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		timeZone: "UTC",
	});
};

/** Average placement reads nicer as a 1-decimal number (or a dash when unset). */
const formatAverage = (value: number | null): string =>
	value === null ? "—" : value.toFixed(1);

const Leaderboard: React.FC = () => {
	const authResolved = useAuthStore((state) => state.authResolved);
	const user = useAuthStore((state) => state.user);
	const isGuest = useIsGuest();

	const [mode, setMode] = useState<ScoredMode>("battle_royale");
	const currentSeason = useMemo(() => seasonKey(), []);
	const [season, setSeason] = useState<string>(currentSeason);

	// Current season + a bounded window of recent past months to browse.
	const seasonOptions = useMemo(() => {
		const options: string[] = [];
		for (let i = 0; i <= PAST_SEASONS_SHOWN; i++) {
			options.push(shiftSeason(currentSeason, i));
		}
		return options;
	}, [currentSeason]);

	// The board procedure is guest-protected and requires a session, so only a
	// resolved, registered (non-guest) user may query it. Guests/signed-out
	// visitors still reach the page — they get a sign-in prompt instead (R3.1).
	const canQuery = authResolved && !isGuest && user !== null;

	// Premium gates the expanded columns (avg placement, best match points). The
	// core ranking stays visible to everyone (R3.7).
	const { data: billing } = api.billing.status.useQuery(undefined, {
		enabled: canQuery,
		staleTime: 60_000,
	});
	const isPremium = billing?.isPremium ?? false;

	const {
		data: board,
		isLoading,
		isError,
		error,
	} = api.leaderboard.board.useQuery(
		{ mode, season: season === currentSeason ? undefined : season },
		{ enabled: canQuery, staleTime: 30_000 },
	);

	const entries = board?.entries ?? [];
	const me = board?.me ?? null;
	// Pin the caller's own row below the page when it isn't already visible (R3.4).
	const mePinned =
		me !== null && !entries.some((e) => e.userId === me.userId) ? me : null;

	return (
		<>
			<Head>
				<title>Leaderboard — Final Word</title>
				<meta
					content="See how you rank against other Final Word players this season."
					name="description"
				/>
				<link href="/favicon_v2.png" rel="icon" />
			</Head>
			<main className="flex min-h-dvh flex-col">
				<Navbar />
				<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
					<div className="flex items-center gap-x-2">
						<h1 className="font-mono text-lg uppercase tracking-wide">
							Leaderboard
						</h1>
					</div>

					{/* Signed-out / guest: the page is public, but ranked data is
					    registered-only, so prompt for a real account instead of an
					    empty board. */}
					{authResolved && (!user || isGuest) ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
							<h2 className="font-bold text-amber-900 text-sm uppercase tracking-widest">
								Sign in to see the leaderboard
							</h2>
							<p className="mt-1 text-amber-800 text-xs leading-relaxed">
								Create a free account to climb the seasonal rankings and track
								your placement against other players.
							</p>
							<Link
								className="mt-3 inline-block rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
								href="/sign-in"
							>
								Sign in
							</Link>
						</div>
					) : (
						<>
							{/* Mode + season selectors */}
							<section className="flex flex-wrap items-end gap-4">
								<label className="flex flex-col gap-1.5">
									<span className="text-[11px] text-gray-500 uppercase tracking-widest">
										Mode
									</span>
									<select
										className="rounded-md border border-gray-200 bg-white/80 px-3 py-1.5 text-gray-800 text-sm shadow-sm transition-colors hover:bg-gray-50 focus:border-green-400 focus:outline-none"
										onChange={(e) => setMode(e.target.value as ScoredMode)}
										value={mode}
									>
										{SCORED_MODES.map((m) => (
											<option key={m} value={m}>
												{MODE_LABELS[m]}
											</option>
										))}
									</select>
								</label>

								<label className="flex flex-col gap-1.5">
									<span className="text-[11px] text-gray-500 uppercase tracking-widest">
										Season
									</span>
									<select
										className="rounded-md border border-gray-200 bg-white/80 px-3 py-1.5 text-gray-800 text-sm shadow-sm transition-colors hover:bg-gray-50 focus:border-green-400 focus:outline-none"
										onChange={(e) => setSeason(e.target.value)}
										value={season}
									>
										{seasonOptions.map((s) => (
											<option key={s} value={s}>
												{formatSeason(s)}
												{s === currentSeason ? " (current)" : ""}
											</option>
										))}
									</select>
								</label>

								{!isPremium && (
									<p className="ml-auto text-[11px] text-gray-400">
										<Link
											className="font-semibold text-green-600 underline"
											href="/profile"
										>
											Upgrade
										</Link>{" "}
										to unlock expanded stats
									</p>
								)}
							</section>

							{/* Ranked table / states */}
							<section className="overflow-hidden rounded-lg border border-gray-200/80 bg-white/80 shadow-sm backdrop-blur-sm">
								{!canQuery || isLoading ? (
									<p className="px-5 py-8 text-center text-gray-400 text-sm">
										Loading…
									</p>
								) : isError ? (
									<p className="px-5 py-8 text-center text-gray-500 text-sm">
										Couldn't load the leaderboard
										{error?.message ? `: ${error.message}` : "."}
									</p>
								) : entries.length === 0 ? (
									<p className="px-5 py-8 text-center text-gray-500 text-sm">
										{EMPTY_BOARD_COPY}
									</p>
								) : (
									<table className="w-full border-collapse text-sm">
										<thead>
											<tr className="border-gray-100 border-b text-[10px] text-gray-500 uppercase tracking-widest">
												<th className="px-4 py-2.5 text-left font-semibold">
													#
												</th>
												<th className="px-4 py-2.5 text-left font-semibold">
													Player
												</th>
												<th className="px-4 py-2.5 text-right font-semibold">
													Points
												</th>
												<th className="px-4 py-2.5 text-right font-semibold">
													Wins
												</th>
												<th className="px-4 py-2.5 text-right font-semibold">
													Games
												</th>
												{/* Premium-gated expanded columns (R3.7). */}
												{isPremium && (
													<>
														<th className="px-4 py-2.5 text-right font-semibold">
															Avg Place
														</th>
														<th className="px-4 py-2.5 text-right font-semibold">
															Best Match PTS
														</th>
													</>
												)}
											</tr>
										</thead>
										<tbody>
											{entries.map((entry) => (
												<Row
													entry={entry}
													isPremium={isPremium}
													key={entry.userId}
												/>
											))}
											{/* Caller's own row pinned when outside the visible page. */}
											{mePinned && (
												<>
													<tr>
														<td
															className="px-4 py-1 text-center text-[10px] text-gray-300"
															colSpan={isPremium ? 7 : 5}
														>
															•••
														</td>
													</tr>
													<Row
														entry={mePinned}
														isPremium={isPremium}
														key={`pinned-${mePinned.userId}`}
													/>
												</>
											)}
										</tbody>
									</table>
								)}
							</section>

							{board && board.totalQualified > 0 && (
								<p className="text-[11px] text-gray-400">
									{board.totalQualified} ranked player
									{board.totalQualified === 1 ? "" : "s"} ·{" "}
									{board.isCurrentSeason
										? "live current season"
										: "archived season"}
								</p>
							)}
						</>
					)}
				</div>
			</main>
		</>
	);
};

/** A single ranked table row. The caller's own row is tinted for quick scanning. */
const Row: React.FC<{
	entry: {
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
	isPremium: boolean;
}> = ({ entry, isPremium }) => (
	<tr
		className={`border-gray-50 border-b last:border-0 ${
			entry.isCurrentUser ? "bg-green-50" : "hover:bg-gray-50"
		}`}
	>
		<td className="px-4 py-2.5 text-left font-mono text-gray-500 tabular-nums">
			{entry.placement}
		</td>
		<td className="px-4 py-2.5 text-left text-gray-800">
			<span className="font-medium">{entry.name ?? "Player"}</span>
			{entry.isCurrentUser && (
				<span className="ml-2 rounded-sm bg-green-400 px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest">
					You
				</span>
			)}
		</td>
		<td className="px-4 py-2.5 text-right font-semibold text-gray-800 tabular-nums">
			{entry.seasonPoints}
		</td>
		<td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
			{entry.wins}
		</td>
		<td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
			{entry.gamesPlayed}
		</td>
		{isPremium && (
			<>
				<td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
					{formatAverage(entry.averagePlacement)}
				</td>
				<td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
					{entry.bestMatchPoints}
				</td>
			</>
		)}
	</tr>
);

export default Leaderboard;
