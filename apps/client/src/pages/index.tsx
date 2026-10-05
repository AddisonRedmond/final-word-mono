"use client";
import { AnimatePresence, motion } from "motion/react";
import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import HeadToHeadCard from "@/components/duel-card";
import BattleRoyalCard from "@/components/game-cards/battle-royale-card";
import RaceCard from "@/components/game-cards/race-card";
import BattleRoyale from "@/components/games/battle-royale";
import Race from "@/components/games/race";
import GuestWelcomeCarousel from "@/components/guest/guest-welcome-carousel";
import Navbar from "@/components/navigation/navbar";
import PlayLimitNotice from "@/components/play-limit-notice";
import Tile from "@/components/tile";
import { env } from "@/env";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useIsGuest } from "@/hooks/useIsGuest";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/state/auth-store";
import { useGameSessionStore } from "@/state/game-session-store";
import { useGuestWelcomeStore } from "@/state/guest-welcome-store";
import { useServerClockStore } from "@/state/server-clock-store";
import { createClient } from "@/utils/supabase/client";

export default function Home() {
	const [isPlaying, setIsPlaying] = useState(false);
	const [isPlayingRace, setIsPlayingRace] = useState(false);
	const [raceToken, setRaceToken] = useState<string | undefined>(undefined);
	// The latest realtime `join:error` reason bubbled up from a game, used to show
	// a persistent play-limit notice on the menu (guest one-game-per-mode today;
	// extensible to the registered-user daily cap).
	const [playLimitReason, setPlayLimitReason] = useState<string | undefined>(
		undefined,
	);
	const socketRef = useRef<Socket | null>(null);
	const user = useAuthStore((state) => state.user);
	// Guest gating (R7.3): hide the duels entry point for anonymous sessions.
	const isGuest = useIsGuest();
	// Responsiveness (Feature 2a): the realtime modes (Battle Royale, Race) are
	// desktop-only. On smaller screens we hide their cards/games and surface the
	// duel entry point instead. `hydrated` gates this so the server-rendered
	// desktop markup never flashes a desktop-only game onto a phone.
	const { isDesktop, hydrated } = useIsDesktop();
	// Redirect to /sign-in once auth resolves with no user (sign-out from
	// anywhere, direct nav while logged out, or session expiry). Also yields
	// `authResolved`: until the first session read completes, `user`/`isGuest`
	// are still their initial (loading) values, so branching on them would flash
	// the wrong UI (e.g. the duels card appearing then vanishing for a guest).
	const { authResolved } = useRequireAuth();
	const setRealtimeGameActive = useGameSessionStore(
		(state) => state.setRealtimeGameActive,
	);

	// Feature: anonymous-sign-in — show the welcome carousel once, on a guest's
	// first sign-in. The seen-flag is persisted to localStorage, which only
	// hydrates on the client, so we gate on a mounted flag to avoid an SSR
	// hydration mismatch and a flash before hydration.
	const hasSeenWelcome = useGuestWelcomeStore((state) => state.hasSeenWelcome);
	const markWelcomeSeen = useGuestWelcomeStore(
		(state) => state.markWelcomeSeen,
	);
	const [mounted, setMounted] = useState(false);

	// Gate all auth-derived conditional UI on a single "ready" flag: mounted
	// (client-side, so localStorage-backed stores have hydrated), the session
	// read has resolved, AND there is a signed-in user. The user check means a
	// signed-out visitor (mid-redirect to /sign-in via useRequireAuth) never
	// flashes the menu. This also removes the first-paint flashes.
	const isReady = mounted && authResolved && user !== null;
	const showGuestWelcome = isReady && isGuest && !hasSeenWelcome;

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		return () => {
			socketRef.current?.disconnect();
		};
	}, []);

	// Expose whether a live realtime game is in progress so app-global UI (the
	// duel notification toasts) can drop their "View duels" link while playing,
	// preventing a stray click from abandoning the match. Reset on unmount so
	// navigating away always clears the flag.
	useEffect(() => {
		setRealtimeGameActive(isPlaying || isPlayingRace);
		return () => setRealtimeGameActive(false);
	}, [isPlaying, isPlayingRace, setRealtimeGameActive]);

	const handlePlay = async () => {
		// Realtime modes are desktop-only; never start one from a small screen.
		if (!isDesktop) {
			return;
		}
		// Clear any stale play-limit notice when starting a fresh attempt.
		setPlayLimitReason(undefined);
		const supabase = createClient();
		const {
			data: { session },
		} = await supabase.auth.getSession();

		const accessToken = session?.access_token;
		if (!accessToken) {
			console.error("No active session found for websocket auth");
			return;
		}

		socketRef.current?.disconnect();

		const socketBaseUrl = env.NEXT_PUBLIC_WS_URL;
		const socket = io(socketBaseUrl, {
			path: "/socket.io",
			auth: {
				token: accessToken,
			},
			transports: ["websocket"],
		});

		socketRef.current = socket;

		const handleConnect = () => {
			console.log("Socket.IO connected");
			// Measure the client/server clock offset before rendering timers so
			// countdowns and life bars reflect the server's clock, not the browser's.
			void useServerClockStore.getState().sync(socket);
			setIsPlaying(true);
		};

		const handleConnectError = (error: Error) => {
			console.error("Socket.IO connection error", error.message);
			setIsPlaying(false);
		};

		const handleDisconnect = () => {
			useServerClockStore.getState().reset();
			setIsPlaying(false);
		};

		// Capture a match-start block at the home-screen level. The Battle Royale
		// socket is torn down on `join:error` (which unmounts the game before its
		// own reporting effect can reliably fire), so we read the reason here on
		// the long-lived home screen to drive the persistent play-limit notice.
		const handleJoinError = (payload?: { reason?: string }) => {
			setPlayLimitReason(payload?.reason);
		};

		socket.on("connect", handleConnect);
		socket.on("connect_error", handleConnectError);
		socket.on("disconnect", handleDisconnect);
		socket.on("join:error", handleJoinError);

		return () => {
			socket.off("connect", handleConnect);
			socket.off("connect_error", handleConnectError);
			socket.off("disconnect", handleDisconnect);
			socket.off("join:error", handleJoinError);
		};
	};

	const handlePlayRace = async () => {
		// Realtime modes are desktop-only; never start one from a small screen.
		if (!isDesktop) {
			return;
		}
		// Clear any stale play-limit notice when starting a fresh attempt.
		setPlayLimitReason(undefined);
		const supabase = createClient();
		const {
			data: { session },
		} = await supabase.auth.getSession();

		const accessToken = session?.access_token;
		if (!accessToken) {
			console.error("No active session found for websocket auth");
			return;
		}

		// Race manages its own `/race` socket internally via `useRaceSocket`, so we
		// only hand it the access token rather than creating a socket here.
		setRaceToken(accessToken);
		setIsPlayingRace(true);
	};

	// Resets Race play state so the game un-mounts and the card menu returns,
	// mirroring how Battle Royale's socket `disconnect` flips `isPlaying`.
	const handleRaceLeave = useCallback(() => {
		setIsPlayingRace(false);
		setRaceToken(undefined);
	}, []);

	// A game reports its `join:error` reason here so the play-limit notice can
	// persist on the menu after the game un-mounts. Stable identity so the games'
	// reporting effects don't re-fire.
	const handleGameJoinError = useCallback((reason: string | undefined) => {
		setPlayLimitReason(reason);
	}, []);

	return (
		<>
			<Head>
				<title>Play — Final Word</title>
				<meta
					content="Pick a mode and play Final Word: duel a friend head-to-head, or jump into live Battle Royale and Race word games."
					name="description"
				/>
				<link href="/favicon_v2.png" rel="icon" />
			</Head>
			<main className="flex h-dvh flex-col">
				<Navbar />
				{/* Feature: anonymous-sign-in — one-time welcome carousel on a guest's
				    first sign-in; marking it seen persists so it never reopens. */}
				<AnimatePresence>
					{showGuestWelcome && (
						<GuestWelcomeCarousel
							key="guest-welcome"
							onClose={markWelcomeSeen}
						/>
					)}
				</AnimatePresence>
				<div className="flex min-h-0 grow flex-col items-center justify-center gap-y-5">
					<AnimatePresence>
						{!isPlaying && !isPlayingRace && (
							<motion.div
								animate={{ scale: 1 }}
								className="flex flex-col items-center gap-y-2"
								exit={{ scale: 0 }}
								initial={{ scale: 0 }}
							>
								{/* The FINAL/WORD tiles are sized for desktop (lg/md); scale
								    the pair down on small screens so the 5-tile FINAL row never
								    overflows a phone. The scale lives on this inner wrapper, not
								    the motion.div above, so it doesn't fight Framer Motion's
								    animated transform. */}
								<div className="flex scale-[0.68] flex-col items-center gap-y-2 sm:scale-100">
									<Tile
										revealed={true}
										size={isPlaying ? "sm" : "lg"}
										variant="correct"
										word="FINAL"
									/>
									<Tile
										revealed={true}
										size={isPlaying ? "sm" : "md"}
										variant="present"
										word="WORD"
									/>
								</div>
							</motion.div>
						)}
					</AnimatePresence>
					<AnimatePresence>
						{/* Realtime games are desktop-only, so they can only ever mount
						    when `isDesktop` is true (the cards that start them are hidden
						    below the desktop breakpoint and the play handlers no-op). */}
						{isPlaying && user?.id ? (
							<BattleRoyale
								onJoinError={handleGameJoinError}
								socketRef={socketRef}
								userId={user.id}
							/>
						) : isPlayingRace && user?.id && raceToken ? (
							<Race
								onJoinError={handleGameJoinError}
								onLeave={handleRaceLeave}
								token={raceToken}
								userId={user.id}
							/>
						) : (
							!isPlaying &&
							!isPlayingRace &&
							// Hold the menu until auth has resolved so the guest-vs-registered
							// UI (notably the duels card) never flashes the wrong state. The
							// FINAL/WORD tiles above stand in as the neutral loading state.
							isReady && (
								<div className="flex w-full max-w-5xl flex-col items-center gap-y-5 px-4">
									{/* Persistent notice after a match-start is blocked by a
									    play limit (guest one-game-per-mode today, registered
									    daily cap in future); self-hides for any other reason. */}
									<PlayLimitNotice
										onDismiss={() => setPlayLimitReason(undefined)}
										reason={playLimitReason}
									/>
									<div className="flex w-full flex-col items-center gap-5 sm:flex-row sm:flex-wrap sm:justify-center">
										{/* Guest gating (R7.3): duels entry hidden for guests; the
										    realtime game cards stay (R7.5, the single exception).
										    Responsiveness (Feature 2a): the duel card is available
										    on every screen size; the realtime cards render only on
										    desktop. */}
										{!isGuest && <HeadToHeadCard />}
										{/* Only decide desktop-vs-mobile once hydrated so the
										    server markup (desktop) doesn't flash a realtime card
										    onto a phone. */}
										{hydrated &&
											(isDesktop ? (
												<>
													<BattleRoyalCard handlePlay={handlePlay} />
													<RaceCard handlePlay={handlePlayRace} />
												</>
											) : (
												<div className="w-full max-w-xs rounded-lg border border-stone-200 bg-white/80 p-4 text-center shadow-sm backdrop-blur-sm">
													<p className="font-bold text-stone-500 text-xs uppercase tracking-widest">
														Desktop only
													</p>
													<p className="mt-1 text-sm text-stone-600">
														Battle Royale and Race need a larger screen. Open
														Final Word on a desktop to play the live modes.
													</p>
												</div>
											))}
									</div>
								</div>
							)
						)}
					</AnimatePresence>
				</div>
			</main>
		</>
	);
}
