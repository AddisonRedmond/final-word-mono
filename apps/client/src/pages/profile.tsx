"use client";

import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import { TIER_LIMITS } from "@/db/schema";
import { useIsGuest } from "@/hooks/useIsGuest";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/state/auth-store";
import { api } from "@/utils/api";

// Public-facing customer-support address. This is a forwarding alias that
// reroutes to the owner's real inbox, so it's safe to surface in the UI without
// exposing a personal email.
const SUPPORT_EMAIL = "sixths_dangler.3n@icloud.com";

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
				<meta content="Manage your Final Word account and subscription." name="description" />
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
											automatically. Try again, or contact support and we'll sort
											it out.
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
										{syncMutation.isPending ? "Refreshing…" : "Refresh from Polar"}
									</button>
								</div>
							</section>

							{/* Support */}
							<section className="rounded-lg border border-gray-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
								<h2 className="mb-1 font-mono text-sm uppercase tracking-widest">
									Support
								</h2>
								<p className="text-gray-500 text-xs leading-relaxed">
									Questions about your account, a subscription, or a bug? Email us
									and we'll get back to you.
								</p>
								<a
									className="mt-3 inline-block rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-[11px] text-gray-600 uppercase tracking-widest transition-all hover:bg-gray-100 active:scale-95"
									href={`mailto:${SUPPORT_EMAIL}`}
								>
									Contact support
								</a>
								<p className="mt-2 text-[11px] text-gray-400">{SUPPORT_EMAIL}</p>
							</section>
						</>
					)}
				</div>
			</main>
		</>
	);
};

export default Profile;
