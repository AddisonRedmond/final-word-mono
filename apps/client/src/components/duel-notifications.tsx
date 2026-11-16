import { useCallback, useMemo } from "react";

import {
	type DuelRealtimeEvent,
	useDuelRealtime,
} from "@/hooks/useDuelRealtime";
import { useAuthStore } from "@/state/auth-store";
import { useGameSessionStore } from "@/state/game-session-store";
import { type ToastOptions, toast } from "@/state/toast-store";
import { api } from "@/utils/api";

/**
 * App-level duel notifications.
 *
 * `useDuelRealtime` only fires while it is mounted, so keeping it on the duels
 * page alone meant invites and opponent/completion notifications were missed
 * whenever the user was anywhere else. Mounting this component once at the app
 * root (next to <Toaster />) keeps a realtime subscription alive for the whole
 * session, so notifications surface regardless of the current page.
 *
 * This component renders nothing — it exists purely for its realtime side
 * effects (raising toasts). Board/participant rendering still lives on the
 * duels page.
 */
const DuelNotifications: React.FC = () => {
	const currentUserId = useAuthStore((state) => state.user?.id);
	// Only fetch when logged in; the duel query is protected. This is the only
	// query run up front: friend / opponent names are only needed once a toast
	// fires, so they're fetched lazily (see `fetchName`).
	const { data: duels } = api.duels.allDuels.useQuery(undefined, {
		enabled: Boolean(currentUserId),
	});
	const utils = api.useUtils();
	const duelIds = useMemo(() => (duels ?? []).map((duel) => duel.id), [duels]);

	// A name we already have cached, or undefined. Synchronous, so a toast whose
	// name is known appears instantly with no loading state.
	const cachedName = useCallback(
		(userId: string) =>
			utils.friends.list.getData()?.find((friend) => friend.id === userId)
				?.name ??
			utils.duels.duelOpponentNames
				.getData()
				?.find((person) => person.id === userId)?.name,
		[utils],
	);

	// Fetch names from the server. `staleTime: 0` forces a fresh read: a brand
	// new challenger won't be in any cached list, and a cached list would just
	// answer "Your opponent".
	const fetchName = useCallback(
		async (userId: string) => {
			const [friends, names] = await Promise.all([
				utils.friends.list.fetch(undefined, { staleTime: 0 }),
				utils.duels.duelOpponentNames.fetch(undefined, { staleTime: 0 }),
			]);
			return (
				friends.find((friend) => friend.id === userId)?.name ??
				names.find((person) => person.id === userId)?.name ??
				"Your opponent"
			);
		},
		[utils],
	);

	// Raise a toast that names `userId`. Known name -> shown immediately.
	// Unknown -> a loading toast that turns into the real message once the name
	// arrives (and falls back to "Your opponent" if the lookup fails).
	const announce = useCallback(
		(
			userId: string,
			loading: string,
			build: (name: string) => string,
			options: ToastOptions,
		) => {
			const known = cachedName(userId);
			if (known) {
				toast(build(known), options);
				return;
			}
			void toast.promise(
				fetchName(userId).catch(() => "Your opponent"),
				{ loading, success: build, error: build("Your opponent") },
				options,
			);
		},
		[cachedName, fetchName],
	);

	const handleRealtimeEvent = useCallback(
		(event: DuelRealtimeEvent) => {
			// Build the toast options for a duel notification. Every duel toast
			// links to the /duels page — EXCEPT while the user is in a live
			// realtime game (Battle Royale / Race), where offering that link could
			// pull them out of their match on a stray click. Read the flag
			// imperatively so this handler (and the realtime subscription) doesn't
			// need to re-create when the game state changes.
			const duelToastOptions = (variant: ToastOptions["variant"]) => {
				const { isRealtimeGameActive } = useGameSessionStore.getState();
				return {
					variant,
					action: isRealtimeGameActive
						? undefined
						: { label: "View", href: "/duels" },
				} satisfies ToastOptions;
			};

			switch (event.type) {
				case "invited":
					announce(
						event.initiatedBy,
						"New duel challenge…",
						(name) => `${name} challenged you to a duel`,
						duelToastOptions("info"),
					);
					void utils.duels.allDuels.invalidate();
					break;
				case "opponentFinished":
					// Never notify the user about their own finish.
					if (event.userId === currentUserId) {
						break;
					}
					announce(
						event.userId,
						"Duel update…",
						(name) => `${name} finished their duel`,
						duelToastOptions("info"),
					);
					void utils.duels.allDuels.invalidate();
					break;
				case "duelCompleted": {
					const options = duelToastOptions(
						event.winner === currentUserId ? "success" : "info",
					);
					if (event.winner === null) {
						toast("A duel ended in a draw", options);
					} else if (event.winner === currentUserId) {
						toast("You won a duel!", options);
					} else {
						announce(
							event.winner,
							"Duel finished…",
							(name) => `${name} won the duel`,
							options,
						);
					}
					void utils.duels.allDuels.invalidate();
					break;
				}
			}
		},
		[announce, currentUserId, utils],
	);

	// This component only needs the events, never the participant rows, so skip
	// the participants fetch.
	useDuelRealtime(duelIds, {
		currentUserId,
		onEvent: handleRealtimeEvent,
		loadParticipants: false,
	});
	return null;
};

export default DuelNotifications;
