"use client";

import { Check, X } from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/navigation/navbar";
import { SUPPORT_EMAIL } from "@/constants";
import { DISPLAY_NAME, TIER_LIMITS } from "@/db/schema";
import { useIsGuest } from "@/hooks/useIsGuest";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/state/auth-store";
import { api } from "@/utils/api";
import { createClient } from "@/utils/supabase/client";

// Human-readable copy for the raw Polar subscription status string.
const STATUS_LABELS: Record<string, string> = {
	active: "Active",
	trialing: "Trial",
	canceled: "Canceled",
	past_due: "Past due",
	unpaid: "Unpaid",
	incomplete: "Incomplete",
};

const formatDate = (date: Date | string | null | undefined): string => {
	if (!date) {
		return "—";
	}
	const d = typeof date === "string" ? new Date(date) : date;
	return d.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

/** A labelled row inside a card. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
	label,
	children,
}) => (
	<div className="flex items-center justify-between gap-4 py-2.5">
		<span className="text-[11px] text-gray-500 uppercase tracking-widest">
			{label}
		</span>
		<span className="text-right text-gray-800 text-sm">{children}</span>
	</div>
);

/**
 * One row of the Free vs Premium comparison. A cell is either a boolean
 * (rendered as a check / x) or a short string (rendered as text, e.g. a numeric
 * limit like "3 / day"). Numbers are pulled from TIER_LIMITS so the table never
 * drifts from the enforced limits.
 */
type FeatureCell = boolean | string;
type FeatureRow = { label: string; free: FeatureCell; premium: FeatureCell };

/** Render a comparison cell: check/x for booleans, plain text otherwise. */
const Cell: React.FC<{ value: FeatureCell }> = ({ value }) => {
	if (typeof value === "boolean") {
		return value ? (
			<Check
				aria-label="Included"
				className="mx-auto text-green-500"
				size={16}
			/>
		) : (
			<X
				aria-label="Not included"
				className="mx-auto text-gray-300"
				size={16}
			/>
		);
	}
	return <span className="text-gray-700 text-xs">{value}</span>;
};

/**
 * Free vs Premium feature matrix. Numeric capabilities read from TIER_LIMITS
 * (the single source of truth), so changing a limit there updates this table.
 * Boolean rows cover the non-numeric premium perks.
 */
const FEATURE_ROWS: FeatureRow[] = [
	{
		label: "Realtime games / day",
		free: `${TIER_LIMITS.free.realtimeGamesPerDay}`,
		premium:
			TIER_LIMITS.premium.realtimeGamesPerDay === null
				? "Unlimited"
				: `${TIER_LIMITS.premium.realtimeGamesPerDay}`,
	},
	{
		label: "Active duels at once",
		free: `${TIER_LIMITS.free.activeDuels}`,
		premium: `${TIER_LIMITS.premium.activeDuels}`,
	},
	{
		label: "Opponents per duel",
		// duelInvitees is additional players, NOT counting self (see schema), so
		// show the total party size for a clearer player-facing number.
		free: `${TIER_LIMITS.free.duelInvitees + 1}`,
		premium: `${TIER_LIMITS.premium.duelInvitees + 1}`,
	},
	{ label: "Battle Royale", free: true, premium: true },
	{ label: "Elimination Race", free: true, premium: true },
	{ label: "Leaderboard access", free: true, premium: true },
	// Stats split: core counters are free; the advanced cluster (accuracy, best
	// streak, placement, solve times, personal records) is premium — matching
	// the gate on the /stats page.
	{ label: "Core stats (W/L, win rate, streak)", free: true, premium: true },
	{
		label: "Advanced stats (accuracy, placement, solve times)",
		free: false,
		premium: true,
	},
	{ label: "Full season history", free: false, premium: true },
	{ label: "Champion cosmetics", free: false, premium: true },
];

/**
 * The Free vs Premium comparison table. `currentIsPremium` subtly highlights the
 * column that matches the viewer's active plan so they can see where they stand.
 */
const PlanComparison: React.FC<{ currentIsPremium: boolean }> = ({
	currentIsPremium,
}) => (
	<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
		<h2 className="mb-3 font-mono text-sm uppercase tracking-widest">
			Free vs Premium
		</h2>
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-left">
				<thead>
					<tr className="border-gray-100 border-b">
						<th className="py-2 pr-2 font-semibold text-[11px] text-gray-500 uppercase tracking-widest">
							Feature
						</th>
						<th
							className={`px-2 py-2 text-center font-semibold text-[11px] uppercase tracking-widest ${
								currentIsPremium ? "text-gray-500" : "text-green-700"
							}`}
						>
							Free{!currentIsPremium && " ★"}
						</th>
						<th
							className={`px-2 py-2 text-center font-semibold text-[11px] uppercase tracking-widest ${
								currentIsPremium ? "text-green-700" : "text-gray-500"
							}`}
						>
							Premium{currentIsPremium && " ★"}
						</th>
					</tr>
				</thead>
				<tbody>
					{FEATURE_ROWS.map((row) => (
						<tr
							className="border-gray-100 border-b last:border-0"
							key={row.label}
						>
							<td className="py-2.5 pr-2 text-gray-700 text-xs">{row.label}</td>
							<td
								className={`px-2 py-2.5 text-center ${
									currentIsPremium ? "" : "bg-green-50/60"
								}`}
							>
								<Cell value={row.free} />
							</td>
							<td
								className={`px-2 py-2.5 text-center ${
									currentIsPremium ? "bg-green-50/60" : ""
								}`}
							>
								<Cell value={row.premium} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
		<p className="mt-3 text-[11px] text-gray-400">★ marks your current plan.</p>
	</section>
);

/**
 * Display-name editor. Lets a user set the name shown on the leaderboard (handy
 * if they don't want their real name public), limited to ONE change per year.
 *
 * Validation mirrors the server's shared DISPLAY_NAME rules for instant
 * feedback, but the server re-validates everything (shape, profanity, cooldown)
 * — the client checks are only UX. On success we refresh the Supabase session so
 * the auth store (navbar greeting) picks up the new name without a re-login.
 *
 * Gated on the server query `canChange`; while gated, the input/button are
 * disabled and the next-eligible date is shown.
 */
const DisplayNameSection: React.FC<{ canQuery: boolean }> = ({ canQuery }) => {
	const utils = api.useUtils();
	const { data: info, isLoading } = api.profile.displayNameInfo.useQuery(
		undefined,
		{ enabled: canQuery, staleTime: 60_000 },
	);

	const [value, setValue] = useState("");
	const [touched, setTouched] = useState(false);
	// Seed the input with the current name once it loads (only before the user
	// has started typing, so we never clobber their edit on a refetch).
	useEffect(() => {
		if (info?.name && !touched) {
			setValue(info.name);
		}
	}, [info?.name, touched]);

	const mutation = api.profile.updateDisplayName.useMutation({
		onSuccess: async () => {
			// Refresh the server-side display-name info and the client session so
			// the navbar greeting reflects the new name immediately.
			await utils.profile.displayNameInfo.invalidate();
			try {
				await createClient().auth.refreshSession();
			} catch {
				// Non-fatal: the name is saved; the greeting will catch up on next
				// session read / navigation.
			}
		},
	});

	const trimmed = value.trim();
	const unchanged = trimmed === (info?.name ?? "");

	// Client-side mirror of the shared rules for inline guidance.
	const clientError =
		trimmed.length === 0
			? null
			: trimmed.length < DISPLAY_NAME.minLength
				? `At least ${DISPLAY_NAME.minLength} characters.`
				: trimmed.length > DISPLAY_NAME.maxLength
					? `${DISPLAY_NAME.maxLength} characters or fewer.`
					: !DISPLAY_NAME.pattern.test(trimmed)
						? "Letters, numbers, spaces, and . _ ' - only."
						: null;

	const canChange = info?.canChange ?? false;
	const canSubmit =
		canChange &&
		!mutation.isPending &&
		trimmed.length > 0 &&
		!clientError &&
		!unchanged;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) {
			return;
		}
		mutation.mutate({ name: trimmed });
	};

	return (
		<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
			<h2 className="mb-1 font-mono text-sm uppercase tracking-widest">
				Display name
			</h2>
			<p className="mb-3 text-[11px] text-gray-500 leading-relaxed">
				This is the name shown on the leaderboard. You can change it once a
				year, so pick one you're happy with.
			</p>

			{isLoading ? (
				<p className="py-2 text-gray-400 text-sm">Loading…</p>
			) : (
				<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
					<input
						aria-label="Display name"
						className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-800 text-sm outline-none transition-colors focus:border-green-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
						disabled={!canChange || mutation.isPending}
						maxLength={DISPLAY_NAME.maxLength}
						onChange={(e) => {
							setTouched(true);
							setValue(e.target.value);
						}}
						placeholder="Your display name"
						type="text"
						value={value}
					/>

					{/* Inline validation / server error. */}
					{clientError ? (
						<p className="text-[11px] text-amber-600">{clientError}</p>
					) : mutation.isError ? (
						<p className="text-[11px] text-red-500">{mutation.error.message}</p>
					) : mutation.isSuccess ? (
						<p className="text-[11px] text-green-600">Name updated.</p>
					) : null}

					{/* Once-per-year notice. When gated, show the next-eligible date;
					    otherwise set expectations before they change it. */}
					{canChange ? (
						<p className="text-[11px] text-gray-400">
							Heads up: you can only change your name once per year.
						</p>
					) : (
						<p className="text-[11px] text-amber-600">
							You've already changed your name this year. You can change it
							again on {formatDate(info?.nextChangeAt)}.
						</p>
					)}

					<div>
						<button
							className="rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!canSubmit}
							type="submit"
						>
							{mutation.isPending ? "Saving…" : "Save name"}
						</button>
					</div>
				</form>
			)}
		</section>
	);
};

const Profile: React.FC = () => {
	const router = useRouter();
	const { authResolved } = useRequireAuth();
	const isGuest = useIsGuest();
	const user = useAuthStore((state) => state.user);
	const profileName = useAuthStore((state) => state.profileName);
	const profileEmail = useAuthStore((state) => state.profileEmail);

	const utils = api.useUtils();

	// Did the user just come back from a successful checkout? (Polar redirects
	// here with ?checkout=success.) Premium is normally flipped by the webhook,
	// which may lag — or, if it failed, never arrive. We reconcile directly from
	// Polar (billing.syncFromPolar) as a safety net.
	const justCheckedOut = router.query.checkout === "success";

	// Billing status + today's realtime usage. Both are guest-protected on the
	// server, so only fire them for a registered user.
	const canQuery = authResolved && !isGuest && user !== null;
	const { data: billing, isLoading: billingLoading } =
		api.billing.status.useQuery(undefined, {
			enabled: canQuery,
			staleTime: 60_000,
		});
	const { data: usage } = api.billing.realtimeUsage.useQuery(undefined, {
		enabled: canQuery,
		staleTime: 30_000,
	});

	// Reconciliation: read the truth from Polar and refresh the status query.
	const syncMutation = api.billing.syncFromPolar.useMutation({
		onSuccess: () => {
			void utils.billing.status.invalidate();
			void utils.billing.realtimeUsage.invalidate();
		},
	});

	const isPremium = billing?.isPremium ?? false;

	// After a successful checkout, if the status query has loaded but the user
	// still isn't premium (webhook lag or failure), auto-reconcile ONCE. The ref
	// guards against re-firing on every render / query refetch.
	const autoSyncedRef = useRef(false);
	useEffect(() => {
		if (
			justCheckedOut &&
			canQuery &&
			!billingLoading &&
			billing &&
			!billing.isPremium &&
			!autoSyncedRef.current &&
			!syncMutation.isPending
		) {
			autoSyncedRef.current = true;
			syncMutation.mutate();
		}
	}, [justCheckedOut, canQuery, billingLoading, billing, syncMutation]);

	return (
		<>
			<Head>
				<title>Profile — Final Word</title>
				<meta
					content="Manage your Final Word account and subscription."
					name="description"
				/>
				<link href="/favicon_v2.png" rel="icon" />
			</Head>
			<main className="flex min-h-dvh flex-col">
				<Navbar />
				<div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-8">
					<div className="flex items-center gap-x-2">
						<h1 className="font-mono text-lg uppercase tracking-wide">
							Profile
						</h1>
					</div>

					{/* Guests can't own a subscription (billing is registered-only). Point
					    them to a real account instead of showing an empty billing panel. */}
					{authResolved && isGuest ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
							<h2 className="font-bold text-amber-900 text-sm uppercase tracking-widest">
								You're playing as a guest
							</h2>
							<p className="mt-1 text-amber-800 text-xs leading-relaxed">
								Create a free account to manage a profile, unlock duels and
								friends, and upgrade to premium for unlimited realtime play.
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
							{/* Post-checkout reconciliation banner. Premium is normally
							    granted by the Polar webhook; if that lagged or failed, we
							    reconcile directly from Polar (billing.syncFromPolar). The
							    banner reflects: already-premium (done), activating (sync in
							    flight), or failed (manual retry + support fallback). */}
							{justCheckedOut &&
								(isPremium ? (
									<div
										className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-xs"
										role="status"
									>
										Thanks for subscribing! Your premium benefits are active.
									</div>
								) : syncMutation.isError ? (
									<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-xs">
										<p>
											We received your payment but couldn't activate premium
											automatically. Try again, or contact support and we'll
											sort it out.
										</p>
										<div className="mt-2 flex flex-wrap items-center gap-2">
											<button
												className="rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95 disabled:opacity-60"
												disabled={syncMutation.isPending}
												onClick={() => syncMutation.mutate()}
												type="button"
											>
												{syncMutation.isPending ? "Syncing…" : "Sync now"}
											</button>
											<a
												className="font-semibold text-[11px] text-amber-700 underline"
												href={`mailto:${SUPPORT_EMAIL}`}
											>
												Contact support
											</a>
										</div>
									</div>
								) : (
									<div
										className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-xs"
										role="status"
									>
										Thanks for subscribing! Activating your premium benefits…
									</div>
								))}

							{/* Account */}
							<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
								<h2 className="mb-1 font-mono text-sm uppercase tracking-widest">
									Account
								</h2>
								<div className="divide-y divide-gray-100">
									<Row label="Name">{profileName ?? "Player"}</Row>
									<Row label="Email">{profileEmail ?? "—"}</Row>
								</div>
							</section>

							{/* Display name editor (once-per-year, profanity-filtered). */}
							<DisplayNameSection canQuery={canQuery} />

							{/* Subscription */}
							<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
								<div className="mb-1 flex items-center justify-between">
									<h2 className="font-mono text-sm uppercase tracking-widest">
										Subscription
									</h2>
									<span
										className={`rounded-sm px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest ${
											isPremium ? "bg-green-400" : "bg-gray-400"
										}`}
									>
										{isPremium ? "Premium" : "Free"}
									</span>
								</div>

								{billingLoading ? (
									<p className="py-3 text-gray-400 text-sm">Loading…</p>
								) : (
									<div className="divide-y divide-gray-100">
										<Row label="Plan">{isPremium ? "Premium" : "Free"}</Row>
										{billing?.status && (
											<Row label="Status">
												{STATUS_LABELS[billing.status] ?? billing.status}
											</Row>
										)}
										{isPremium && billing?.premiumUntil && (
											<Row label="Renews / ends">
												{formatDate(billing.premiumUntil)}
											</Row>
										)}
										<Row label="Realtime games">
											{isPremium
												? "Unlimited"
												: `${usage?.remaining ?? TIER_LIMITS.free.realtimeGamesPerDay} / ${
														usage?.limit ?? TIER_LIMITS.free.realtimeGamesPerDay
													} left today`}
										</Row>
									</div>
								)}

								{/* Benefits summary */}
								<ul className="mt-3 space-y-1 text-[11px] text-gray-500">
									<li>
										Duels: invite up to{" "}
										{isPremium
											? TIER_LIMITS.premium.duelInvitees
											: TIER_LIMITS.free.duelInvitees}{" "}
										players,{" "}
										{isPremium
											? TIER_LIMITS.premium.activeDuels
											: TIER_LIMITS.free.activeDuels}{" "}
										active at a time
									</li>
									<li>
										Realtime games:{" "}
										{isPremium
											? "unlimited"
											: `${TIER_LIMITS.free.realtimeGamesPerDay} per day`}
									</li>
								</ul>

								{/* Action: upgrade (free) or manage (premium). These are server
								    redirects to the Polar hosted flows, so plain links. The
								    "Refresh from Polar" button reconciles premium directly from
								    Polar — a manual escape hatch if the webhook never applied a
								    purchase (independent of the post-checkout auto-sync above). */}
								<div className="mt-4 flex flex-wrap items-center gap-2">
									{isPremium ? (
										<a
											className="inline-block rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-[11px] text-gray-600 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
											href="/api/polar/portal"
										>
											Manage subscription
										</a>
									) : (
										<a
											className="inline-block rounded-md bg-green-400 px-3 py-1.5 font-semibold text-[11px] text-white uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
											href="/api/polar/checkout"
										>
											Upgrade to premium
										</a>
									)}
									<button
										className="inline-block rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-[11px] text-gray-500 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95 disabled:opacity-60"
										disabled={syncMutation.isPending}
										onClick={() => syncMutation.mutate()}
										type="button"
									>
										{syncMutation.isPending
											? "Refreshing…"
											: "Refresh from Polar"}
									</button>
								</div>
							</section>

							{/* Free vs Premium comparison. Numeric rows come from
							    TIER_LIMITS; the viewer's active plan column is highlighted. */}
							<PlanComparison currentIsPremium={isPremium} />

							{/* Support */}
							<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
								<h2 className="mb-1 font-mono text-sm uppercase tracking-widest">
									Support
								</h2>
								<p className="text-gray-500 text-xs leading-relaxed">
									Questions about your account, a subscription, or a bug? Email
									us and we'll get back to you.
								</p>
								<a
									className="mt-3 inline-block rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-[11px] text-gray-600 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
									href={`mailto:${SUPPORT_EMAIL}`}
								>
									Contact support
								</a>
								<p className="mt-2 text-[11px] text-gray-400">
									{SUPPORT_EMAIL}
								</p>
							</section>
						</>
					)}
				</div>
			</main>
		</>
	);
};

export default Profile;
