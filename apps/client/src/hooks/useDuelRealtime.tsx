import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
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

	// Keep the latest callback / user id in refs so the realtime subscription
	// effect doesn't need to tear down and re-subscribe every time they change.
	const onEventRef = useRef(onEvent);
	const currentUserIdRef = useRef(currentUserId);
	useEffect(() => {
		onEventRef.current = onEvent;
		currentUserIdRef.current = currentUserId;
	}, [onEvent, currentUserId]);

	useEffect(() => {
		if (duelIds.length === 0) {
			setParticipants({});
			return;
		}

		const supabase = createClient();
		let isMounted = true;

		const loadParticipants = async () => {
			const { data, error } = await supabase
				.from("duel_participants")
				.select(DUEL_PARTICIPANT_COLUMNS)
				.in("duel_id", duelIds);

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

		const channel = supabase
			.channel(`duel-realtime-${duelIds.join("-")}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "duel_participants" },
				(payload: RealtimePostgresChangesPayload<DuelParticipantRow>) => {
					const newRow = payload.new as DuelParticipantRow;
					const oldRow = payload.old as DuelParticipantRow;
					const duelId = newRow.duel_id ?? oldRow.duel_id;

					if (!duelId || !duelIds.includes(duelId)) {
						return;
					}

					// Surface "an opponent just finished" — a participant that isn't the
					// current user transitioning into a finished (end_time) state.
					if (
						payload.eventType === "UPDATE" &&
						newRow.end_time &&
						!oldRow.end_time &&
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
					const userId = currentUserIdRef.current;

					// A brand new duel the current user is invited to. Its id won't be in
					// the tracked duelIds yet, so this is filtered client-side on the
					// participants array (postgres_changes can't filter array-contains).
					if (
						payload.eventType === "INSERT" &&
						userId &&
						newRow.participants?.includes(userId) &&
						newRow.initiated_by !== userId
					) {
						onEventRef.current?.({
							type: "invited",
							duelId: newRow.id,
							initiatedBy: newRow.initiated_by,
						});
						return;
					}

					// A duel we're tracking transitioned into the completed state.
					if (
						payload.eventType === "UPDATE" &&
						newRow.completed &&
						!oldRow.completed &&
						duelIds.includes(newRow.id)
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
	}, [duelIds]);

	return participants;
};
