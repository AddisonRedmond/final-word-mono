import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/components/button";
import { ArchivedDuelRow, DuelBoard, StatusBadge } from "@/components/duels";
import DuelRibbon from "@/components/duels/duel-ribbon";
import NewDuel from "@/components/duels/new-duel";
import type { Friend } from "@/components/friends/types";
import Modal from "@/components/modal";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import {
  type DuelRealtimeEvent,
  useDuelRealtime,
} from "@/hooks/useDuelRealtime";
import { useAuthStore } from "@/state/auth-store";
import { toast } from "@/state/toast-store";
import { api, type RouterOutputs } from "@/utils/api";
import { isValidDuelWord } from "@/utils/duel";

type ActiveDuelData = RouterOutputs["duels"]["startOrResumeDuel"];

const Duels = () => {
  const { data, isLoading } = api.friends.list.useQuery();

  const {
    data: duels,
    refetch: refetchDuels,
    isLoading: isLoadingDuels,
    isFetching: isFetchingDuels,
  } = api.duels.allDuels.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const sendDuelMutation = api.duels.sendDuel.useMutation();
  const startOrResumeDuel = api.duels.startOrResumeDuel.useMutation();
  const declineDuel = api.duels.declineDuel.useMutation();
  const forfeitDuel = api.duels.forfeitDuel.useMutation();
  const acknowledgeDuel = api.duels.acknowledgeDuel.useMutation();
  const makeGuess = api.duels.handleDuelGuess.useMutation();

  const utils = api.useUtils();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDueling, setIsDueling] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoadingResult, setIsLoadingResult] = useState(false);
  // True when the open board is a read-only review of an archived duel, so the
  // board hides its Archive button (the duel is already archived).
  const [isViewingArchived, setIsViewingArchived] = useState(false);
  const [activeDuelData, setActiveDuelData] = useState<ActiveDuelData | null>(
    null,
  );

  // Only fetch archived duels once the user opens the archive view.
  const {
    data: archivedDuels,
    isLoading: isLoadingArchived,
    isFetching: isFetchingArchived,
  } = api.duels.archivedDuels.useQuery(undefined, {
    enabled: showArchived,
  });

  const currentUserId = useAuthStore((state) => state.user?.id);

  const duelIds = useMemo(() => (duels ?? []).map((duel) => duel.id), [duels]);

  // Toast notifications (invited / opponentFinished / duelCompleted) are owned
  // app-wide by <DuelNotifications /> so they fire on any page. Here we only
  // react to completion to keep the open board's result view in sync — no
  // toasts, so there's no duplication with the app-level provider.
  const handleRealtimeEvent = useCallback((event: DuelRealtimeEvent) => {
    if (event.type !== "duelCompleted") {
      return;
    }

    // If this is the duel currently open on the board, patch its completion
    // state so the result view and the acknowledge-on-close flow reflect the
    // final outcome without waiting on a manual action.
    setActiveDuelData((current) => {
      if (!current || current.duel.id !== event.duelId) {
        return current;
      }
      return {
        ...current,
        duel: {
          ...current.duel,
          completed: true,
          winner: event.winner,
        },
      };
    });
  }, []);

  const participantsByDuel = useDuelRealtime(duelIds, {
    currentUserId,
    onEvent: handleRealtimeEvent,
  });

  const friends: Friend[] = (data ?? [])
    .filter((friend) => friend.status === "accepted")
    .map((friend) => ({
      id: friend.id,
      name: friend.name ?? friend.email ?? "Unknown",
      email: friend.email ?? "",
      status: friend.status,
    }));

  /*
   * While a board is open, keep its participant list in sync with realtime so
   * the result view reflects opponents' latest guesses and finish state. We
   * only replace the `participant` array — the current user's derived fields
   * (matchResults, keyboardState, secretWord) come from the server response
   * and must not be recomputed here.
   */
  useEffect(() => {
    if (!activeDuelData) {
      return;
    }

    const liveParticipants = participantsByDuel[activeDuelData.duel.id];

    if (!liveParticipants || liveParticipants.length === 0) {
      return;
    }

    setActiveDuelData((current) => {
      if (!current) {
        return current;
      }

      // Bail if nothing actually changed to avoid a render loop.
      const sameLength = current.participant.length === liveParticipants.length;
      const unchanged =
        sameLength &&
        current.participant.every((existing) => {
          const live = liveParticipants.find(
            (p) => p.userId === existing.userId,
          );
          return (
            live !== undefined &&
            live.guesses.length === existing.guesses.length &&
            live.endTime?.getTime() === existing.endTime?.getTime() &&
            live.success === existing.success &&
            live.accepted === existing.accepted
          );
        });

      if (unchanged) {
        return current;
      }

      return { ...current, participant: liveParticipants };
    });
  }, [participantsByDuel, activeDuelData]);

  const handleSendDuel = async (invitedFriends: Friend[]) => {
    await sendDuelMutation.mutateAsync(
      invitedFriends.map((friend) => friend.id),
    );

    await refetchDuels();
    setIsModalOpen(false);
  };

  const handleStartDuel = async (duelId: string) => {
    const result = await startOrResumeDuel.mutateAsync(duelId);

    setIsViewingArchived(false);
    setActiveDuelData(result);
    setIsDueling(true);
  };

  const handleDuelGuess = async (guess: string) => {
    if (!activeDuelData) {
      return;
    }

    // Safety net: the board already shakes and blocks invalid spellings
    // before calling this. Guard here too so a bad word is never sent to the
    // server, using the same duel word list the server validates against.
    if (!isValidDuelWord(guess)) {
      return;
    }

    const result = await makeGuess.mutateAsync({
      duelId: activeDuelData.duel.id,
      guess,
    });

    setActiveDuelData(result);

    if (result.isCorrect) {
      toast("Solved it!", { variant: "success" });
    } else if (result.isGameOver) {
      toast("Out of guesses — better luck next time", { variant: "error" });
    }
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

  const handleArchiveDuel = async (duelId: string) => {
    await acknowledgeDuel.mutateAsync(duelId);
    await refetchDuels();
  };

  // Archiving from inside the open board: archive the duel on the server, then
  // close the board and refetch so it drops out of the active list (and into
  // the archived view).
  const handleArchiveFromBoard = async () => {
    const duelId = activeDuelData?.duel.id;

    setIsDueling(false);
    setActiveDuelData(null);

    if (duelId) {
      await handleArchiveDuel(duelId);
    }
  };

  // Closing the board is a pure UI action. It never archives the duel, so a
  // finished participant can reopen the result view as many times as they like
  // until they explicitly click "Archive".
  const handleCloseBoard = () => {
    setIsDueling(false);
    setActiveDuelData(null);
  };

  // Open the read-only result view for an archived duel. Uses getDuelResult
  // (no mutation) so reviewing an old result never changes any state. The
  // board renders its result view because the user's endTime is set, and we
  // pass no onArchive handler so there's no Archive button in this mode.
  const handleViewArchivedResult = async (duelId: string) => {
    setIsLoadingResult(true);
    try {
      const result = await utils.duels.getDuelResult.fetch(duelId);
      setIsViewingArchived(true);
      setActiveDuelData(result);
      setIsDueling(true);
    } catch {
      toast("Couldn't load that result", { variant: "error" });
    } finally {
      setIsLoadingResult(false);
    }
  };

  const activeDuelOpponents = useMemo(() => {
    if (!activeDuelData) {
      return [];
    }

    // Prefer live realtime participants (active duels), falling back to the
    // participants on the fetched result. Archived duels aren't tracked by
    // realtime, so their opponents come from the getDuelResult response.
    const sourceParticipants =
      participantsByDuel[activeDuelData.duel.id] ?? activeDuelData.participant;

    return activeDuelData.duel.participants
      .filter((userId) => userId !== currentUserId)
      .map((userId) => {
        const participant = sourceParticipants.find(
          (item) => item.userId === userId,
        );

        let status:
          | "pending"
          | "declined"
          | "forfeit"
          | "completed"
          | "started";

        if (!participant) {
          status = "pending";
        } else if (participant.accepted === false) {
          status = participant.endTime ? "forfeit" : "declined";
        } else if (participant.endTime) {
          status = participant.success ? "completed" : "forfeit";
        } else {
          status = "started";
        }

        return {
          id: userId,
          name:
            friends.find((friend) => friend.id === userId)?.name ?? "Unknown",
          status,
          guesses: participant?.guesses ?? [],
        };
      });
  }, [activeDuelData, currentUserId, participantsByDuel, friends]);

  return (
    <div className="flex h-screen flex-col items-center gap-y-2 overflow-hidden">
      {/* TODO: add navbar to the app, not individual pages */}

      <Navbar />

      <Tile revealed={true} size="md" variant="correct" word="DUEL" />

      <div className="flex min-h-0 w-2xl grow flex-col items-center justify-center gap-y-2 pb-10">
        <div className="flex w-full gap-x-2">
          <StatusBadge badgeType="started" label="Started" />
          <StatusBadge badgeType="done" label="Completed" />
          <StatusBadge badgeType="declined" label="Declined" />
          <StatusBadge badgeType="forfeit" label="Forfeit" />
          <StatusBadge badgeType="pending" label="Pending" />
        </div>

        <div className="flex min-h-0 w-full grow flex-col overflow-hidden rounded-md bg-white p-2 shadow-lg outline outline-stone-200">
          <div className="flex justify-between">
            <p className="font-semibold text-lg">
              {showArchived ? "ARCHIVED DUELS" : "DUELS"}
            </p>

            <div className="space-x-2">
              <Button
                onClick={() => setShowArchived((prev) => !prev)}
                variant="yellow"
              >
                {showArchived ? "Back to duels" : "Archived"}
              </Button>

              {!showArchived && (
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
              )}

              {!showArchived && (
                <Button onClick={() => setIsModalOpen(true)} variant="solid">
                  New Duel
                </Button>
              )}
            </div>
          </div>

          <hr className="my-2 h-0.5 border-none bg-stone-300" />

          <div className="min-h-0 grow overflow-auto">
            {showArchived ? (
              isLoadingArchived || isFetchingArchived ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="font-semibold text-gray-400 text-xs uppercase tracking-widest">
                    Loading archived duels...
                  </p>
                </div>
              ) : archivedDuels && archivedDuels.length > 0 ? (
                archivedDuels.map((duel) => (
                  <ArchivedDuelRow
                    currentUserId={currentUserId!}
                    duel={duel}
                    friends={friends}
                    isLoading={isLoadingResult}
                    key={duel.id}
                    onViewResult={(id) => void handleViewArchivedResult(id)}
                  />
                ))
              ) : (
                <div className="flex h-32 items-center justify-center">
                  <p className="font-semibold text-gray-400 text-xs uppercase tracking-widest">
                    No archived duels
                  </p>
                </div>
              )
            ) : isLoadingDuels ? (
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
                  handleArchive={handleArchiveDuel}
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
        </div>
      </div>

      <AnimatePresence>
        {isDueling && activeDuelData && (
          <Modal onClose={handleCloseBoard}>
            <DuelBoard
              currentUserId={currentUserId!}
              duelData={{
                duel: activeDuelData.duel,
                participant: activeDuelData.participant,
                matchResults: activeDuelData.matchResults,
                keyboardState: activeDuelData.keyboardState,
                secretWord: activeDuelData.secretWord,
              }}
              onArchive={
                isViewingArchived
                  ? undefined
                  : () => void handleArchiveFromBoard()
              }
              onClose={handleCloseBoard}
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
