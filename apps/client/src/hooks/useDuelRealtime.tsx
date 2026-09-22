import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import type { DuelParticipant } from "@/db/schema";
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
export const useDuelRealtime = (duelIds: string[]) => {
  const [participants, setParticipants] = useState<
    Record<string, DuelParticipant[]>
  >({});
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
        .select("*")
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
      .channel(`duel-participants-${duelIds.join("-")}`)
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
      .subscribe();
    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [duelIds]);
  return participants;
};
