import { AnimatePresence, useAnimate } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Button from "@/components/button";
import { DuelBoard, StatusBadge } from "@/components/duels";
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
import { isValidGuess } from "@/utils/battle-royale";

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

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isDueling, setIsDueling] = useState(false);
	const [activeDuelData, setActiveDuelData] = useState<ActiveDuelData | null>(
		null,
	);

	const [scope, animate] = useAnimate();

	const currentUserId = useAuthStore((state) => state.user?.id);

	// Tracks the latest friends list so realtime event handlers can resolve
	// names without being torn down and recreated whenever friends change.
	const friendsRef = useRef<Friend[]>([]);

	const duelIds = useMemo(() => (duels ?? []).map((duel) => duel.id), [duels]);

	const nameForUser = useCallback(
		(userId: string) => {
			if (userId === currentUserId) {
				return "You";
			}
			return (
				friendsRef.current.find((friend) => friend.id === userId)?.name ??
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
					void refetchDuels();
					break;
				case "opponentFinished":
					toast(`${nameForUser(event.userId)} finished their duel`, "info");
					void refetchDuels();
					break;
				case "duelCompleted": {
					const message =
						event.winner === null
							? "A duel ended in a draw"
							: event.winner === currentUserId
								? "You won a duel!"
								: `${nameForUser(event.winner)} won the duel`;
					toast(message, event.winner === currentUserId ? "success" : "info");

					// If this is the duel currently open on the board, patch its
					// completion state so the result view and the acknowledge-on-close
					// flow reflect the final outcome without waiting on a manual action.
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

					void refetchDuels();
					break;
				}
			}
		},
		[currentUserId, nameForUser, refetchDuels],
	);

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

	useEffect(() => {
		friendsRef.current = friends;
	}, [friends]);

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

		setActiveDuelData(result);
		setIsDueling(true);
	};

	const handleDuelGuess = async (guess: string) => {
		if (!activeDuelData) {
			return;
		}

		if (!isValidGuess(guess)) {
			animate(scope.current, {
				x: [-10, 10, -10, 10, 0],
			});
			return;
		}

		const result = await makeGuess.mutateAsync({
			duelId: activeDuelData.duel.id,
			guess,
		});

		setActiveDuelData(result);

		if (result.isCorrect) {
			toast("Solved it!", "success");
		} else if (result.isGameOver) {
			toast("Out of guesses — better luck next time", "error");
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

	const handleAcknowledgeDuel = async (duelId: string) => {
		await acknowledgeDuel.mutateAsync(duelId);
		await refetchDuels();
	};

	const handleCloseBoard = async () => {
		const duelId = activeDuelData?.duel.id;
		const shouldAcknowledge = Boolean(activeDuelData?.duel.completed);

		// Close the board immediately so the UI feels responsive; the
		// acknowledgement is a background side effect.
		setIsDueling(false);
		setActiveDuelData(null);

		if (shouldAcknowledge && duelId) {
			try {
				await acknowledgeDuel.mutateAsync(duelId);
			} catch {
				// A failed acknowledgement is non-fatal — the duel simply stays in
				// the list and can be acknowledged again on the next close.
			}

			// Refetch so an acknowledged, completed duel drops out of the list
			// right away instead of lingering until the next window focus.
			await refetchDuels();
		}
	};

	const activeDuelOpponents = useMemo(() => {
		if (!activeDuelData) {
			return [];
		}

		return activeDuelData.duel.participants
			.filter((userId) => userId !== currentUserId)
			.map((userId) => {
				const participant = (
					participantsByDuel[activeDuelData.duel.id] ?? []
				).find((item) => item.userId === userId);

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
									handleAcknowledge={handleAcknowledgeDuel}
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
					<Modal onClose={() => void handleCloseBoard()}>
						<DuelBoard
							currentUserId={currentUserId!}
							duelData={{
								duel: activeDuelData.duel,
								participant: activeDuelData.participant,
								matchResults: activeDuelData.matchResults,
								keyboardState: activeDuelData.keyboardState,
								secretWord: activeDuelData.secretWord,
							}}
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
