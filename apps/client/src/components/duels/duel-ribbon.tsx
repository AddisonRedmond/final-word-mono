import type { Duel } from "@/db/schema";
import type { Friend } from "@/components/friends/types";
import Button from "@/components/button";
import type { DuelParticipant } from "@/hooks/useDuelRealtime";

export interface DuelRibbonProps {
  duel: Duel;
  currentUserId: string;
  friends: Friend[];
  participants: DuelParticipant[];
  startOrResumeDuel: (duelId: string) => void;
  declineDuel?: (duelId: string) => void;
}

const opponentColor = (participant: DuelParticipant | undefined) => {
  if (!participant?.startTime) return "bg-stone-400";
  return participant.endTime ? "bg-green-500" : "bg-amber-500";
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const DuelRibbon: React.FC<DuelRibbonProps> = ({
  duel,
  currentUserId,
  friends,
  participants,
  startOrResumeDuel,
  declineDuel,
}) => {
  const opponentIds = duel.participants.filter((id) => id !== currentUserId);
  const hasJoined = participants.some((p) => p.userId === currentUserId);
  const isInitiator = duel.initiatedBy === currentUserId;
  console.log(hasJoined);
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-stone-500/10 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-800">vs</p>
          {opponentIds.map((id) => {
            const participant = participants.find((p) => p.userId === id);
            const name =
              friends.find((friend) => friend.id === id)?.name ?? "Unknown";

            return (
              <span
                key={id}
                title={name}
                className={`size-6 rounded-md grid place-content-center text-[10px] font-bold text-white shrink-0 select-none ${opponentColor(participant)}`}
              >
                {getInitials(name)}
              </span>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 truncate">
          {new Date(duel.createdAt).toLocaleDateString()}
        </p>
      </div>
      {duel.completed ? (
        <span className="text-[11px] font-bold uppercase tracking-widest px-2 py-1 rounded-md shrink-0 bg-stone-200 text-stone-600">
          Completed
        </span>
      ) : (
        <div className="flex gap-1.5 shrink-0">
          {!hasJoined && !isInitiator && <Button variant="red">Decline</Button>}
          <Button onClick={() => startOrResumeDuel(duel.id)} variant="yellow">
            Start
          </Button>
        </div>
      )}
    </div>
  );
};

export default DuelRibbon;
