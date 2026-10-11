"use client";

import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import Navbar from "@/components/navigation/navbar";
import type { GameMode } from "@/db/schema";
import { useIsGuest } from "@/hooks/useIsGuest";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/state/auth-store";
import type { ModeStatsView } from "@/server/api/routers/stats";
import { api } from "@/utils/api";

/** Which aggregate the page is showing: all-time, or the current UTC-month. */
type Scope = "lifetime" | "season";

/** Human-readable labels for the stat modes. Keeps the UI from leaking the raw
 *  snake_case mode keys. A future mode (e.g. `classic`) renders a title-cased
 *  fallback until it gets a label here. */
const MODE_LABELS: Record<string, string> = {
	battle_royale: "Battle Royale",
	race: "Race",
	duel: "Duel",
	classic: "Classic",
};

const modeLabel = (mode: GameMode): string =>
	MODE_LABELS[mode] ??
	mode
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

/** Format a 0..1 rate as a whole-number percentage, or em-dash when null. */
const formatRate = (rate: number | null): string =>
	rate === null ? "—" : `${Math.round(rate * 100)}%`;

/** Round an average to one decimal place, or em-dash when null. */
const formatAvg = (value: number | null): string =>
	value === null ? "—" : value.toFixed(1);

/** Format a millisecond duration as seconds (e.g. "4.2s"), or em-dash. */
const formatMs = (ms: number | null): string =>
	ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;

/** A labelled stat cell inside a card's grid. */
const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
	label,
	value,
}) => (
	<div className="flex flex-col gap-0.5">
		<span className="text-[10px] text-gray-500 uppercase tracking-widest">
			{label}
		</span>
		<span className="font-mono text-gray-800 text-sm">{value}</span>
	</div>
);

/** A single mode's stats card. Renders the core counters every mode has, plus
 *  the mode-specific rows that are present (placement for BR/Race, solve timing
 *  for timed modes, season points for scored seasonal rows). Advanced rows are
 *  gated behind premium: when `premiumLocked`, they render a lock prompt rather
 *  than a value, so the free layout is never broken (R2.7). */
const ModeCard: React.FC<{
	stats: ModeStatsView;
	scope: Scope;
	placement?: number;
}> = ({ stats, scope, placement }) => {
	const hasPlacement = stats.averagePlacement !== null;
	const hasSolveTiming = stats.averageSolveMs !== null;
	const showSeasonPoints = scope === "season" && stats.seasonPoints > 0;

	return (
		<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="font-mono text-sm uppercase tracking-widest">
					{modeLabel(stats.mode)}
				</h2>
				{scope === "season" && placement !== undefined && (
					<span className="rounded-sm bg-green-400 px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest">
						Season #{placement}
					</span>
				)}
			</div>

			{/* Core counters — present for every mode. */}
			<div className="grid grid-cols-3 gap-x-4 gap-y-3">
				<Stat label="Games" value={stats.gamesPlayed} />
				<Stat label="Wins" value={stats.wins} />
				<Stat label="Losses" value={stats.losses} />
				<Stat label="Draws" value={stats.draws} />
				<Stat label="Win rate" value={formatRate(stats.winRate)} />
				<Stat label="Avg guesses" value={formatAvg(stats.averageGuesses)} />
				<Stat label="Current streak" value={stats.currentWinStreak} />
				<Stat label="Best streak" value={stats.bestWinStreak} />
				{hasPlacement && (
					<Stat
						label="Avg placement"
						value={formatAvg(stats.averagePlacement)}
					/>
				)}
			</div>

			{/* Solve timing — only for modes that time an individual solve. */}
			{hasSolveTiming && (
				<div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 border-gray-100 border-t pt-3">
					<Stat label="Avg solve" value={formatMs(stats.averageSolveMs)} />
					<Stat label="Fastest solve" value={formatMs(stats.fastestSolveMs)} />
				</div>
			)}

			{/* Season points — scored seasonal rows only (BR/Race). */}
			{showSeasonPoints && (
				<div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 border-gray-100 border-t pt-3">
					<Stat label="Season points" value={stats.seasonPoints} />
					<Stat label="Best match" value={stats.bestMatchPoints} />
				</div>
			)}

			{/* Advanced / premium-gated rows (R2.7). */}
			<div className="mt-3 border-gray-100 border-t pt-3">
				{stats.premiumLocked ? (
					<div className="flex items-center justify-between gap-3">
						<div className="flex flex-col gap-0.5">
							<span className="text-[10px] text-gray-400 uppercase tracking-widest">
								Advanced stats
							</span>
							<span className="text-[11px] text-gray-400">
								Unlock average correct guesses and more with premium.
							</span>
						</div>
						<a
							className="shrink-0 rounded-md bg-green-400 px-2.5 py-1 font-semibold text-[10px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
							href="/api/polar/checkout"
						>
							Upgrade
						</a>
					</div>
				) : (
					<div className="grid grid-cols-3 gap-x-4 gap-y-3">
						<Stat
							label="Avg correct"
							value={formatAvg(stats.averageCorrectGuesses)}
						/>
					</div>
				)}
			</div>
		</section>
	);
};

const Stats: React.FC = () => {
	const { authResolved } = useRequireAuth();
	const isGuest = useIsGuest();
	const user = useAuthStore((state) => state.user);

	const [scope, setScope] = useState<Scope>("lifetime");

	// Both reads are guest-protected on the server, so only fire them for a
	// resolved, registered user (mirrors profile.tsx's query gating).
	const canQuery = authResolved && !isGuest && user !== null;

	const { data: stats, isLoading: statsLoading } = api.stats.me.useQuery(
		{ scope },
		{ enabled: canQuery, staleTime: 30_000 },
	);
	const { data: placements } = api.stats.myPlacements.useQuery(undefined, {
		enabled: canQuery,
		staleTime: 60_000,
	});

	// Current-season placement per mode, from the archived placement history
	// (R2.5). We look up by this read's season key so the badge matches the
	// season the cards are showing.
	const placementByMode = new Map<string, number>();
	if (stats?.season && placements) {
		for (const row of placements) {
			if (row.season === stats.season) {
				placementByMode.set(row.mode, row.placement);
			}
		}
	}

	const modes = stats?.modes ?? [];

	return (
		<>
			<Head>
				<title>Stats — Final Word</title>
				<meta
					content="See how you're doing across every Final Word mode."
					name="description"
				/>
				<link href="/favicon_v2.png" rel="icon" />
			</Head>
			<main className="flex min-h-dvh flex-col">
				<Navbar />
				<div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-8">
					<div className="flex items-center gap-x-2">
						<h1 className="font-mono text-lg uppercase tracking-wide">Stats</h1>
					</div>

					{/* Guests can't own stats surfaces (registered-only, R8.2). Point
					    them to a real account instead of an empty page. */}
					{authResolved && isGuest ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
							<h2 className="font-bold text-amber-900 text-sm uppercase tracking-widest">
								You're playing as a guest
							</h2>
							<p className="mt-1 text-amber-800 text-xs leading-relaxed">
								Create a free account to track your stats across every mode, see
								your win streaks, and climb the seasonal leaderboard.
							</p>
							<Link
								className="mt-3 inline-block rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
								href="/sign-in"
							>
								Create an account
							</Link>
						</div>
					) : (
						<>
							{/* Lifetime vs current-season toggle (R2.4). */}
							<div className="flex items-center gap-1 self-start rounded-md border border-gray-200 bg-white/80 p-1">
								<button
									className={`rounded-sm px-3 py-1 font-semibold text-[11px] uppercase tracking-widest transition-all ${
										scope === "lifetime"
											? "bg-green-400 text-white"
											: "text-gray-500 hover:bg-gray-100"
									}`}
									onClick={() => setScope("lifetime")}
									type="button"
								>
									Lifetime
								</button>
								<button
									className={`rounded-sm px-3 py-1 font-semibold text-[11px] uppercase tracking-widest transition-all ${
										scope === "season"
											? "bg-green-400 text-white"
											: "text-gray-500 hover:bg-gray-100"
									}`}
									onClick={() => setScope("season")}
									type="button"
								>
									This season
								</button>
							</div>

							{scope === "season" && stats?.season && (
								<p className="-mt-3 text-[11px] text-gray-400">
									Current season: {stats.season}
								</p>
							)}

							{/* Loading state (R2.6). */}
							{statsLoading ? (
								<div className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm">
									<p className="py-3 text-gray-400 text-sm">Loading your stats…</p>
								</div>
							) : modes.length === 0 ? (
								/* Empty state — no games in this scope. Avoid showing zeros
								   that imply a bug (R2.6). */
								<div className="rounded-lg border border-gray-200/80 bg-white/80 p-8 text-center shadow-sm">
									<h2 className="font-mono text-sm uppercase tracking-widest">
										No games yet
									</h2>
									<p className="mt-2 text-gray-500 text-xs leading-relaxed">
										{scope === "season"
											? "You haven't played any games this season. Jump into a match and your season stats will show up here."
											: "You haven't played any games yet. Play a round and your stats will start building here."}
									</p>
									<Link
										className="mt-4 inline-block rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
										href="/"
									>
										Play a game
									</Link>
								</div>
							) : (
								modes.map((mode) => (
									<ModeCard
										key={mode.mode}
										placement={placementByMode.get(mode.mode)}
										scope={scope}
										stats={mode}
									/>
								))
							)}
						</>
					)}
				</div>
			</main>
		</>
	);
};

export default Stats;
