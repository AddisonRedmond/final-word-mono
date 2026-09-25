import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DuelParticipant } from "@/db/schema";
import { createClient } from "@/utils/supabase/client";

type DuelParticipantRow = {
	duel_id: string;
	user_id: string;
	start_time: string | null;
	end_time: string | null;
	total_guesses: number;
	success: boolean;
	guesses: string[];
	accepted: boolean | null;
	completed_game_acknowledged: boolean;
};

/**
 * Explicit column list for the initial participant fetch. We select named
 * columns rather than `*` as defense-in-depth: if a sensitive column is ever
 * added to duel_participants, it won't be pulled into the browser by accident.
 * The answer word already lives in the separate duel_secrets table, which the
 * client cannot read at all.
 */
const DUEL_PARTICIPANT_COLUMNS =
	"duel_id, user_id, start_time, end_time, total_guesses, success, guesses, accepted, completed_game_acknowledged" as const;

type DuelRow = {
	id: string;
	initiated_by: string;
	created_at: string;
	completed: boolean;
	winner: string | null;
	participants: string[];
};

/**
 * Realtime events surfaced to consumers of the hook. These are intentionally
 * high-level ("something the user should be told about") rather than raw row
 * changes, so the page can map them straight to notifications.
 */
export type DuelRealtimeEvent =
	| { type: "invited"; duelId: string; initiatedBy: string }
	| { type: "duelCompleted"; duelId: string; winner: string | null }
	| { type: "opponentFinished"; duelId: string; userId: string };

type UseDuelRealtimeOptions = {
	/** The current user's id, used to filter events that concern them. */
	currentUserId?: string;
	/** Fired for high-level duel events (invites, completion, opponent finish). */
	onEvent?: (event: DuelRealtimeEvent) => void;
};

/**
 * Note on realtime auth: the socket's JWT is set globally by the auth store
 * (`supabase.realtime.setAuth(session.access_token)` on load + every auth
 * change). That matters because `createBrowserClient` authenticates REST via
 * cookies, but the realtime websocket is a separate transport that otherwise
 * defaults to the anon key — and the duel RLS policies (`to authenticated using
 * auth.uid() = any(participants)`) would then filter out every row while the
 * channel still reports SUBSCRIBED. Because the store keeps the socket
 * authenticated, this hook can build + subscribe channels synchronously without
 * awaiting an auth step (awaiting before `.on(...)` breaks under Strict Mode).
 */

const toDuelParticipant = (row: DuelParticipantRow): DuelParticipant => ({
	duelId: row.duel_id,
	userId: row.user_id,
	startTime: row.start_time ? new Date(row.start_time) : null,
	endTime: row.end_time ? new Date(row.end_time) : null,
	totalGuesses: row.total_guesses,
	success: row.success,
	guesses: row.guesses,
	accepted: row.accepted,
	completed_game_acknowledged: row.completed_game_acknowledged,
});

export const useDuelRealtime = (
	duelIds: string[],
	options: UseDuelRealtimeOptions = {},
) => {
	const { currentUserId, onEvent } = options;

	const [participants, setParticipants] = useState<
		Record<string, DuelParticipant[]>
	>({});

	// A per-hook-instance suffix for channel topics. `supabase.channel(topic)`
	// reuses any existing channel with the same topic, and under React Strict
	// Mode (dev) the mount → cleanup → remount cycle races with the async
	// `removeChannel`, so a remount can be handed back an already-subscribed
	// channel — then `.on(...)` throws "cannot add postgres_changes callbacks
	// after subscribe()". A unique topic per instance sidesteps reuse entirely.
	const instanceId = useId();

	// Keep the latest callback / user id in refs so the realtime subscription
	// effect doesn't need to tear down and re-subscribe every time they change.
	const onEventRef = useRef(onEvent);
	const currentUserIdRef = useRef(currentUserId);
	useEffect(() => {
		onEventRef.current = onEvent;
		currentUserIdRef.current = currentUserId;
	}, [onEvent, currentUserId]);

	// Serialize duelIds into a stable primitive so the tracking effect only
	// re-subscribes when the actual set of tracked duels changes, not on every
	// render that produces a new array reference.
	const duelIdsKey = [...duelIds].sort().join(",");
	// Stable array derived from the key. Because it is memoized on duelIdsKey,
	// its reference only changes when the tracked set actually changes, so the
	// tracking effect can depend on it without churning on every render.
	const trackedDuelIds = useMemo(
		() => (duelIdsKey ? duelIdsKey.split(",") : []),
		[duelIdsKey],
	);

	// -----------------------------------------------------------------------
	// Invite subscription — always live while the user is logged in.
	//
	// A duel invite is, by definition, the event that happens BEFORE the
	// recipient has the duel in their list. If we only subscribed once the user
	// already had duels (the tracking effect below), a brand-new invitee with an
	// empty duel list would have no channel at all and would never be notified.
	// So invites get their own channel keyed only on the current user id.
	// -----------------------------------------------------------------------
	useEffect(() => {
		if (!currentUserId) {
			return;
		}

		const supabase = createClient();

		// Build + subscribe synchronously (`.on(...)` must precede `.subscribe()`).
		// The socket JWT is kept current by the auth store, so no auth step is
		// needed here. The instanceId in the topic guarantees a fresh channel.
		const inviteChannel = supabase
			.channel(`duel-invites-${currentUserId}-${instanceId}`)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "duels" },
				(payload: RealtimePostgresChangesPayload<DuelRow>) => {
					const newRow = payload.new as DuelRow;
					const userId = currentUserIdRef.current;

					// A brand new duel the current user is invited to.
					// postgres_changes can't filter array-contains, so we filter on
					// participants here.
					if (
						userId &&
						newRow.participants?.includes(userId) &&
						newRow.initiated_by !== userId
					) {
						onEventRef.current?.({
							type: "invited",
							duelId: newRow.id,
							initiatedBy: newRow.initiated_by,
						});
					}
				},
			)
			.subscribe();

		return () => {
			void supabase.removeChannel(inviteChannel);
		};
	}, [currentUserId, instanceId]);

	// -----------------------------------------------------------------------
	// Tracking subscription — participant updates + completion for duels the
	// user already knows about. Scoped to the current set of duel ids.
	// -----------------------------------------------------------------------
	useEffect(() => {
		if (trackedDuelIds.length === 0) {
			setParticipants({});
			return;
		}

		const supabase = createClient();
		let isMounted = true;

		const loadParticipants = async () => {
			const { data, error } = await supabase
				.from("duel_participants")
				.select(DUEL_PARTICIPANT_COLUMNS)
				.in("duel_id", trackedDuelIds);

			if (!isMounted || error || !data) {
				return;
			}

			const grouped: Record<string, DuelParticipant[]> = {};
			for (const row of data as DuelParticipantRow[]) {
				const participant = toDuelParticipant(row);
				grouped[participant.duelId] = [
					...(grouped[participant.duelId] ?? []),
					participant,
				];
			}
			setParticipants(grouped);
		};

		void loadParticipants();

		// Build + subscribe synchronously — see the invite effect above. The
		// instanceId in the topic guarantees a fresh, non-reused channel.
		const channel = supabase
			.channel(`duel-realtime-${trackedDuelIds.join("-")}-${instanceId}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "duel_participants" },
				(payload: RealtimePostgresChangesPayload<DuelParticipantRow>) => {
					const newRow = payload.new as DuelParticipantRow;
					const oldRow = payload.old as DuelParticipantRow;
					const duelId = newRow.duel_id ?? oldRow.duel_id;

					if (!duelId || !trackedDuelIds.includes(duelId)) {
						return;
					}

					// Surface "an opponent just finished" — a participant that isn't the
					// current user transitioning into a finished (end_time) state.
					// Require a known current user id: if it were undefined, the
					// `!==` check would pass for our own row and we'd notify ourselves
					// about our own finish.
					if (
						payload.eventType === "UPDATE" &&
						newRow.end_time &&
						!oldRow.end_time &&
						currentUserIdRef.current !== undefined &&
						newRow.user_id !== currentUserIdRef.current
					) {
						onEventRef.current?.({
							type: "opponentFinished",
							duelId,
							userId: newRow.user_id,
						});
					}

					setParticipants((current) => {
						const duelParticipants = current[duelId] ?? [];

						if (payload.eventType === "INSERT") {
							const participant = toDuelParticipant(newRow);
							return {
								...current,
								[duelId]: [...duelParticipants, participant],
							};
						}

						if (payload.eventType === "UPDATE") {
							const participant = toDuelParticipant(newRow);
							return {
								...current,
								[duelId]: duelParticipants.map((currentParticipant) =>
									currentParticipant.userId === participant.userId
										? participant
										: currentParticipant,
								),
							};
						}

						if (payload.eventType === "DELETE") {
							return {
								...current,
								[duelId]: duelParticipants.filter(
									(participant) => participant.userId !== oldRow.user_id,
								),
							};
						}

						return current;
					});
				},
			)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "duels" },
				(payload: RealtimePostgresChangesPayload<DuelRow>) => {
					const newRow = payload.new as DuelRow;
					const oldRow = payload.old as DuelRow;

					// Invites are handled by the dedicated invite channel above; this
					// listener only concerns duels the user already tracks.

					// A duel we're tracking transitioned into the completed state.
					if (
						payload.eventType === "UPDATE" &&
						newRow.completed &&
						!oldRow.completed &&
						trackedDuelIds.includes(newRow.id)
					) {
						onEventRef.current?.({
							type: "duelCompleted",
							duelId: newRow.id,
							winner: newRow.winner,
						});
					}
				},
			)
			.subscribe();

		return () => {
			isMounted = false;
			void supabase.removeChannel(channel);
		};
	}, [trackedDuelIds, instanceId]);

	return participants;
};
