import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/components/button";
import ConfirmDialog from "@/components/confirm-dialog";
import { ArchivedDuelRow, DuelBoard, StatusBadge } from "@/components/duels";
import DuelRibbon from "@/components/duels/duel-ribbon";
import NewDuel from "@/components/duels/new-duel";
import type { Friend } from "@/components/friends/types";
import Modal from "@/components/modal";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import { tierLimits } from "@/db/schema";
import {
  type DuelRealtimeEvent,
  useDuelRealtime,
} from "@/hooks/useDuelRealtime";
import { usePremium } from "@/hooks/usePremium";
import { Repeat } from "lucide-react";
import { useAuthStore } from "@/state/auth-store";
import { useKeyboardLayoutStore } from "@/state/keyboard-layout-store";
import { toast } from "@/state/toast-store";
import { api, type RouterOutputs } from "@/utils/api";
import { isValidDuelWord } from "@/utils/duel";

type ActiveDuelData = RouterOutputs["duels"]["startOrResumeDuel"];

const Duels = () => {
  const { data, isLoading } = api.friends.list.useQuery();

  // Premium gating: free accounts invite fewer players and hold fewer active
  // duels than premium. The server is authoritative (sendDuel enforces the
  // caps); these limits drive the UI so a free user can't over-select and then
  // hit a server error.
  const { isPremium } = usePremium();
  const limits = tierLimits(isPremium);

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

  // Keyboard Enter/Delete swap preference (persisted). Toggled from the duel
  // board modal header.
  const swapActionKeys = useKeyboardLayoutStore(
    (state) => state.swapActionKeys,
  );
  const toggleSwapActionKeys = useKeyboardLayoutStore(
    (state) => state.toggleSwapActionKeys,
  );

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
    try {
      await sendDuelMutation.mutateAsync(
        invitedFriends.map((friend) => friend.id),
      );
    } catch (error) {
      // Surface server-side gate messages (e.g. a free user over their invitee
      // or active-duel cap) instead of letting the promise reject silently. The
      // modal stays open so they can adjust and retry.
      toast(
        error instanceof Error
          ? error.message
          : "Something went wrong sending the duel.",
        { variant: "error" },
      );
      return;
    }

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

  // Forfeit/decline are destructive, so the ribbon buttons open a confirmation
  // dialog instead of acting immediately. `pendingConfirm` holds which action
  // is awaiting confirmation and for which duel.
  const [pendingConfirm, setPendingConfirm] = useState<{
    type: "forfeit" | "decline";
    duelId: string;
  } | null>(null);

  const performForfeit = async (duelId: string) => {
    await forfeitDuel.mutateAsync(duelId);

    setIsDueling(false);
    setActiveDuelData(null);

    await refetchDuels();
  };

  const performDecline = async (duelId: string) => {
    await declineDuel.mutateAsync(duelId);
    await refetchDuels();
  };

  // Opened by the ribbon's Forfeit/Decline buttons; the actual mutation runs
  // only once the user confirms in the dialog.
  const requestForfeit = (duelId: string) =>
    setPendingConfirm({ type: "forfeit", duelId });
  const requestDecline = (duelId: string) =>
    setPendingConfirm({ type: "decline", duelId });

  const handleConfirm = async () => {
    if (!pendingConfirm) {
      return;
    }

    const { type, duelId } = pendingConfirm;

    try {
      if (type === "forfeit") {
        await performForfeit(duelId);
      } else {
        await performDecline(duelId);
      }
    } catch {
      toast("Something went wrong — please try again", { variant: "error" });
    } finally {
      setPendingConfirm(null);
    }
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
          | "lost"
          | "completed"
          | "started";

        if (!participant) {
          status = "pending";
        } else if (participant.forfeited) {
          // Forfeit keeps accepted=true, so check it before the branches below.
          status = "forfeit";
        } else if (participant.accepted === false) {
          // Legacy forfeits (pre-`forfeited` column) stored accepted=false +
          // endTime; keep mapping those to "forfeit".
          status = participant.endTime ? "forfeit" : "declined";
        } else if (participant.endTime) {
          // Played to the end: solved, or ran out of guesses ("lost").
          status = participant.success ? "completed" : "lost";
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
    <div className="flex h-dvh flex-col items-center gap-y-2 overflow-hidden">
      <Navbar />

      <Tile revealed={true} size="md" variant="correct" word="DUEL" />

      <div className="flex min-h-0 w-full max-w-2xl grow flex-col items-center justify-center gap-y-2 px-3 pb-10 sm:px-0">
        <div className="flex w-full flex-wrap gap-2">
          <StatusBadge badgeType="started" label="Started" />
          <StatusBadge badgeType="done" label="Done" />
          <StatusBadge badgeType="lost" label="Lost" />
          <StatusBadge badgeType="declined" label="Declined" />
          <StatusBadge badgeType="forfeit" label="Forfeit" />
          <StatusBadge badgeType="pending" label="Pending" />
        </div>

        <div className="flex min-h-0 w-full grow flex-col overflow-hidden rounded-md bg-white p-2 shadow-lg outline outline-stone-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-lg">
              {showArchived ? "ARCHIVED DUELS" : "DUELS"}
            </p>

            <div className="flex flex-wrap gap-2">
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
                  handleDeclineDuel={requestDecline}
                  handleForfeit={requestForfeit}
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
          <Modal
            headerLeft={
              <button
                type="button"
                onClick={toggleSwapActionKeys}
                aria-pressed={swapActionKeys}
                aria-label="Swap the Enter and Delete keys"
                title="Swap Enter and Delete keys"
                className="grid size-8 place-content-center rounded-md border border-stone-200 text-stone-600 transition-colors hover:bg-stone-100 active:scale-95"
              >
                <Repeat className="size-4" aria-hidden="true" />
              </button>
            }
            onClose={handleCloseBoard}
          >
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
              maxInvitees={limits.duelInvitees}
              isPremium={isPremium}
              onSendDuel={handleSendDuel}
            />
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingConfirm && (
          <ConfirmDialog
            cancelLabel="Keep playing"
            confirmLabel={
              pendingConfirm.type === "forfeit" ? "Forfeit" : "Decline"
            }
            isPending={forfeitDuel.isPending || declineDuel.isPending}
            message={
              pendingConfirm.type === "forfeit"
                ? "You'll end your game and can't win this duel. You'll still be able to see your result and the other players' progress."
                : "You won't take part in this duel. This can't be undone."
            }
            onCancel={() => {
              if (!forfeitDuel.isPending && !declineDuel.isPending) {
                setPendingConfirm(null);
              }
            }}
            onConfirm={() => void handleConfirm()}
            tileWord={pendingConfirm.type === "forfeit" ? "GIVEUP" : "NOPE"}
            title={
              pendingConfirm.type === "forfeit"
                ? "Forfeit this duel?"
                : "Decline this duel?"
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Duels;
