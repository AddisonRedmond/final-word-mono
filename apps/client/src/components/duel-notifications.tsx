import { useCallback, useEffect, useMemo, useRef } from "react";

import {
	type DuelRealtimeEvent,
	useDuelRealtime,
} from "@/hooks/useDuelRealtime";
import { useAuthStore } from "@/state/auth-store";
import { toast } from "@/state/toast-store";
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

	// Only fetch when logged in; the duel + friends queries are protected.
	const { data: duels } = api.duels.allDuels.useQuery(undefined, {
		enabled: Boolean(currentUserId),
	});
	const { data: friends } = api.friends.list.useQuery(undefined, {
		enabled: Boolean(currentUserId),
	});

	const utils = api.useUtils();

	const duelIds = useMemo(() => (duels ?? []).map((duel) => duel.id), [duels]);

	// Keep the friends list in a ref so name resolution doesn't force the event
	// handler (and thus the realtime subscription) to be recreated.
	const friendsRef = useRef(friends);
	useEffect(() => {
		friendsRef.current = friends;
	}, [friends]);

	const nameForUser = useCallback(
		(userId: string) => {
			if (userId === currentUserId) {
				return "You";
			}
			return (
				friendsRef.current?.find((friend) => friend.id === userId)?.name ??
				"Your opponent"
			);
		},
		[currentUserId],
	);

	const handleRealtimeEvent = useCallback(
		(event: DuelRealtimeEvent) => {
			switch (event.type) {
				case "invited":
					toast(
						`${nameForUser(event.initiatedBy)} challenged you to a duel`,
						"info",
					);
					void utils.duels.allDuels.invalidate();
					break;
				case "opponentFinished":
					// Never notify the user about their own finish.
					if (event.userId === currentUserId) {
						break;
					}
					toast(`${nameForUser(event.userId)} finished their duel`, "info");
					void utils.duels.allDuels.invalidate();
					break;
				case "duelCompleted": {
					const message =
						event.winner === null
							? "A duel ended in a draw"
							: event.winner === currentUserId
								? "You won a duel!"
								: `${nameForUser(event.winner)} won the duel`;
					toast(message, event.winner === currentUserId ? "success" : "info");
					void utils.duels.allDuels.invalidate();
					break;
				}
			}
		},
		[currentUserId, nameForUser, utils],
	);

	useDuelRealtime(duelIds, { currentUserId, onEvent: handleRealtimeEvent });

	return null;
};

export default DuelNotifications;
