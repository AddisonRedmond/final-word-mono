import words from "./words";
import type { DuelParticipant } from "@/db/schema";

export const getRandomWord = (): string => {
  return words[Math.floor(Math.random() * words.length)]!;
};

export const variants = {
  forfeit: "bg-red-500",
  started: "bg-yellow-500",
  done: "bg-green-500",
  declined: "bg-stone-500",
  pending: "bg-gray-400",
} as const;

export const haveAllDuelParticipantsFinished = (
  participantIds: string[],
  initiatorId: string,
  participants: DuelParticipant[],
) => {
  const otherParticipantIds = participantIds.filter(
    (userId) => userId !== initiatorId,
  );

  // Everyone invited declined.
  if (
    otherParticipantIds.length > 0 &&
    otherParticipantIds.every((userId) => {
      const participant = participants.find(
        (participant) => participant.userId === userId,
      );

      return participant?.accepted === false;
    })
  ) {
    return true;
  }

  // Otherwise, everyone needs a participant row and must
  // either have declined or finished their game.
  return participantIds.every((userId) => {
    const participant = participants.find(
      (participant) => participant.userId === userId,
    );

    if (!participant) {
      return false;
    }

    return participant.accepted === false || participant.endTime !== null;
  });
};

const handleColorGuesses = (word: string, guesses: string[]) => {
  const fullMatches = {};
  const partialMatches = {};
  const noMatch = {};

  // TODO 

  // TODO, dont forget to handle partial matches
};
