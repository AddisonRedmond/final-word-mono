import { animate, AnimatePresence, useAnimate } from "motion/react";
import { useMemo, useState } from "react";
import Button from "@/components/button";
import { DuelBoard, StatusBadge } from "@/components/duels";
import DuelRibbon from "@/components/duels/duel-ribbon";
import NewDuel from "@/components/duels/new-duel";
import type { Friend } from "@/components/friends/types";
import Modal from "@/components/modal";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import type { DuelParticipant } from "@/db/schema";
import { useDuelRealtime } from "@/hooks/useDuelRealtime";
import { useAuthStore } from "@/state/auth-store";
import { api } from "@/utils/api";
import type { KeyboardState, MatchResult } from "@/utils/duel";
import { isValidGuess } from "@/utils/battle-royale";

type ActiveDuelData = DuelParticipant & {
  matchResults: MatchResult[];
  keyboardState: KeyboardState;
  secretWord?: string;
};

const Duels = () => {
  const { data, isLoading } = api.friends.list.useQuery();
  const {
    data: duels,
    refetch: refetchDuels,
    isLoading: isLoadingDuels,
    isFetching: isFetchingDuels,
  } = api.duels.allDuels.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const sendDuelMutation = api.duels.sendDuel.useMutation();
  const startOrResumeDuel = api.duels.startOrResumeDuel.useMutation();
  const declineDuel = api.duels.declineDuel.useMutation();
  const forfeitDuel = api.duels.forfeitDuel.useMutation();
  const acknowledgeDuel = api.duels.acknowledgeDuel.useMutation();
  const makeGuess = api.duels.handleDuelGuess.useMutation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDueling, setIsDueling] = useState(false);
  const [activeDuelData, setActiveDuelData] = useState<ActiveDuelData | null>(
    null,
  );
  const [scope, animate] = useAnimate();

  const currentUserId = useAuthStore((state) => state.user?.id);

  const duelIds = useMemo(() => (duels ?? []).map((duel) => duel.id), [duels]);

  const participantsByDuel = useDuelRealtime(duelIds, refetchDuels);

  const friends: Friend[] = (data ?? [])
    .filter((friend) => friend.status === "accepted")
    .map((friend) => ({
      id: friend.id,
      name: friend.name ?? friend.email ?? "Unknown",
      email: friend.email ?? "",
      status: friend.status,
    }));

  const handleSendDuel = async (invitedFriends: Friend[]) => {
    await sendDuelMutation.mutateAsync(
      invitedFriends.map((friend) => friend.id),
    );

    await refetchDuels();
    setIsModalOpen(false);
  };

  const handleStartDuel = async (duelId: string) => {
    const data = await startOrResumeDuel.mutateAsync(duelId);
    setActiveDuelData(data);
    await refetchDuels();
    setIsDueling(true);
  };

  const handleDuelGuess = async (guess: string) => {
    if (!activeDuelData) return;
    const result = await makeGuess.mutateAsync({
      duelId: activeDuelData.duelId,
      guess,
    });

    if (!isValidGuess(guess)) {
      animate(scope.current, { x: [-10, 10, -10, 10, 0] });
      return;
    }
    // Update board state directly from the guess response — no second request needed.
    setActiveDuelData((current) => {
      if (!current || current.duelId !== result.duelId) return current;

      return result.guesses.length >= current.guesses.length ? result : current;
    });
    if (result.isGameOver) await refetchDuels();
  };

  const handleForfeit = async (duelId: string) => {
    await forfeitDuel.mutateAsync(duelId);
    setIsDueling(false);
    setActiveDuelData(null);
    await refetchDuels();
  };

  const handleDeclineDuel = async (duelId: string) => {
    await declineDuel.mutateAsync(duelId);
    await refetchDuels();
  };

  const handleCloseBoard = async () => {
    const activeDuel = duels?.find(
      (duel) => duel.id === activeDuelData?.duelId,
    );
    if (activeDuel?.completed && activeDuelData?.endTime) {
      await acknowledgeDuel.mutateAsync(activeDuel.id);
      await refetchDuels();
    }
    setIsDueling(false);
    setActiveDuelData(null);
  };

  const activeDuel = duels?.find((duel) => duel.id === activeDuelData?.duelId);
  const activeDuelOpponents = (activeDuel?.participants ?? [])
    .filter((userId) => userId !== currentUserId)
    .map((userId) => {
      const participant = (participantsByDuel[activeDuel?.id ?? ""] ?? []).find(
        (item) => item.userId === userId,
      );
      const status = !participant
        ? "pending"
        : participant.accepted === false
          ? participant.endTime
            ? "forfeit"
            : "declined"
          : participant.endTime
            ? participant.success
              ? "completed"
              : "forfeit"
            : "started";
      return {
        id: userId,
        name: friends.find((friend) => friend.id === userId)?.name ?? "Unknown",
        status,
        guesses: participant?.guesses ?? [],
      };
    });
  return (
    <div className="flex h-screen flex-col items-center gap-y-2">
      {/* TODO: add navbar to the app, not individual pages */}

      <Navbar />

      <Tile revealed={true} size="md" variant="correct" word="DUEL" />

      <div className="flex grow flex-col items-center justify-center">
        <div className="flex w-full gap-x-2">
          <StatusBadge badgeType="started" label="Started" />
          <StatusBadge badgeType="done" label="Completed" />
          <StatusBadge badgeType="declined" label="Declined" />
          <StatusBadge badgeType="forfeit" label="Forfeit" />
          <StatusBadge badgeType="pending" label="Pending" />
        </div>

        <div className="h-10/12 w-2xl rounded-md bg-white p-2 shadow-lg outline outline-stone-200">
          <div className="flex justify-between">
            <p className="font-semibold text-lg">DUELS</p>
            <div className="space-x-2">
              <Button
                disabled={isFetchingDuels}
                onClick={() => refetchDuels()}
                variant="blue"
              >
                {isFetchingDuels ? (
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  "Refresh"
                )}
              </Button>
              <Button onClick={() => setIsModalOpen(true)} variant="solid">
                New Duel
              </Button>
            </div>
          </div>

          <hr className="my-2 h-0.5 border-none bg-stone-300" />
          {/* TODO clean this up later below \/ */}

          <div>
            {isLoadingDuels ? (
              <div className="flex h-32 items-center justify-center">
                <p className="font-semibold text-gray-400 text-xs uppercase tracking-widest">
                  Loading duels...
                </p>
              </div>
            ) : duels && duels.length > 0 ? (
              duels.map((duel) => (
                <DuelRibbon
                  currentUserId={currentUserId!}
                  duel={duel}
                  friends={friends}
                  handleDeclineDuel={handleDeclineDuel}
                  handleForfeit={handleForfeit}
                  key={duel.id}
                  participants={participantsByDuel[duel.id] ?? []}
                  startOrResumeDuel={handleStartDuel}
                />
              ))
            ) : (
              <div className="flex h-32 items-center justify-center">
                <p className="font-semibold text-gray-400 text-xs uppercase tracking-widest">
                  No duels
                </p>
              </div>
            )}
          </div>
          {/* TODO clean this up later ^ */}
        </div>
      </div>
      <AnimatePresence>
        {isDueling && activeDuelData && (
          <Modal onClose={() => void handleCloseBoard()}>
            <DuelBoard
              duelData={activeDuelData}
              onClose={() => void handleCloseBoard()}
              onSubmitGuess={handleDuelGuess}
              opponents={activeDuelOpponents}
            />
          </Modal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isModalOpen && (
          <Modal onClose={() => setIsModalOpen(false)}>
            <NewDuel
              friends={friends}
              isLoading={isLoading}
              onSendDuel={handleSendDuel}
            />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Duels;
