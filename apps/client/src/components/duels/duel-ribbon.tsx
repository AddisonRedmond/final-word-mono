import type { Duel, DuelParticipant } from "@/db/schema";
import type { Friend } from "@/components/friends/types";
import Button from "@/components/button";
import { variants } from "@/utils/duel";

export interface DuelRibbonProps {
  duel: Duel;
  currentUserId: string;
  friends: Friend[];
  participants: DuelParticipant[];
  startOrResumeDuel: (duelId: string) => void;
  handleDeclineDuel: (duelId: string) => void;
}
const opponentColor = (participant: DuelParticipant | undefined) => {
  if (!participant || participant.accepted === false) {
    return variants.declined;
  }
  if (participant.endTime) {
    return participant.success ? variants.done : variants.forfeit;
  }
  if (participant.startTime) {
    return variants.started;
  }
  return variants.pending;
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
  handleDeclineDuel,
}) => {
  const opponentIds = duel.participants.filter((id) => id !== currentUserId);
  const currentParticipant = participants.find(
    (participant) => participant.userId === currentUserId,
  );
  const hasJoined = currentParticipant?.accepted === true;
  const isInitiator = duel.initiatedBy === currentUserId;
  const hasCompleted = currentParticipant?.endTime;
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-stone-500/10">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-800">vs</p>
          {opponentIds.map((id) => {
            const participant = participants.find(
              (participant) => participant.userId === id,
            );
            const name =
              friends.find((friend) => friend.id === id)?.name ?? "Unknown";
            return (
              <span
                key={id}
                title={name}
                className={`grid size-6 shrink-0 select-none place-content-center rounded-md text-[10px] font-bold text-white ${opponentColor(participant)}`}
              >
                {getInitials(name)}
              </span>
            );
          })}
        </div>
        <p className="truncate text-[11px] text-gray-500">
          {new Date(duel.createdAt).toLocaleDateString()}
        </p>
      </div>
      {duel.completed ? (
        <span className="shrink-0 rounded-md bg-stone-200 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-stone-600">
          Completed
        </span>
      ) : (
        <div className="flex shrink-0 gap-1.5">
          {!hasJoined && !isInitiator && (
            <Button onClick={() => handleDeclineDuel(duel.id)} variant="red">
              Decline
            </Button>
          )}
          {hasJoined && !hasCompleted && (
            <Button onClick={() => handleDeclineDuel(duel.id)} variant="red">
              Forfeit
            </Button>
          )}
          <Button onClick={() => startOrResumeDuel(duel.id)} variant="yellow">
            Start
          </Button>
        </div>
      )}
    </div>
  );
};
export default DuelRibbon;
