import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

export type DuelParticipant = {
  duelId: string;
  userId: string;
  startTime: string | null;
  endTime: string | null;
  totalGuesses: number;
  success: boolean;
  guesses: string[];
  accepted: boolean | null;
};

// raw row shape as returned by supabase (snake_case column names)
type DuelParticipantRow = {
  duel_id: string;
  user_id: string;
  start_time: string | null;
  end_time: string | null;
  total_guesses: number;
  success: boolean;
  guesses: string[];
  accepted: boolean | null;
};

const toDuelParticipant = (row: DuelParticipantRow): DuelParticipant => ({
  duelId: row.duel_id,
  userId: row.user_id,
  startTime: row.start_time,
  endTime: row.end_time,
  totalGuesses: row.total_guesses,
  success: row.success,
  guesses: row.guesses,
  accepted: row.accepted,
});

export const useDuelRealtime = (duelIds: string[]) => {
  const [participants, setParticipants] = useState<
    Record<string, DuelParticipant[]>
  >({});

  useEffect(() => {
    if (duelIds.length === 0) return;

    const supabase = createClient();
    let isMounted = true;

    void supabase
      .from("duel_participants")
      .select("*")
      .in("duel_id", duelIds)
      .then(({ data }) => {
        if (!isMounted || !data) return;

        const grouped: Record<string, DuelParticipant[]> = {};
        for (const row of data as DuelParticipantRow[]) {
          const participant = toDuelParticipant(row);
          grouped[participant.duelId] = [
            ...(grouped[participant.duelId] ?? []),
            participant,
          ];
        }

        setParticipants(grouped);
      });

    const channel = supabase
      .channel("duel-participants")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "duel_participants",
        },
        (payload: RealtimePostgresChangesPayload<DuelParticipantRow>) => {
          const newRow = payload.new as DuelParticipantRow;
          const oldRow = payload.old as DuelParticipantRow;

          const duelId = newRow.duel_id ?? oldRow.duel_id;

          if (!duelId || !duelIds.includes(duelId)) {
            return;
          }

          const newParticipant = toDuelParticipant(newRow);
          const oldParticipant = toDuelParticipant(oldRow);

          setParticipants((current) => {
            const duelParticipants = current[duelId] ?? [];

            if (payload.eventType === "INSERT") {
              return {
                ...current,
                [duelId]: [...duelParticipants, newParticipant],
              };
            }

            if (payload.eventType === "UPDATE") {
              return {
                ...current,
                [duelId]: duelParticipants.map((participant) =>
                  participant.userId === newParticipant.userId
                    ? newParticipant
                    : participant,
                ),
              };
            }

            if (payload.eventType === "DELETE") {
              return {
                ...current,
                [duelId]: duelParticipants.filter(
                  (participant) => participant.userId !== oldParticipant.userId,
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
