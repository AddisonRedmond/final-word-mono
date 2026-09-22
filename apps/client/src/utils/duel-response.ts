import { duelParticipants, duels } from "@/db/schema";
import { buildKeyboardState, calculateMatchObj } from "@/utils/duel";

type Duel = typeof duels.$inferSelect;
type Participant = typeof duelParticipants.$inferSelect;

export const buildDuelResponse = (
  duel: Duel,
  participants: Participant[],
  currentUserId: string,
) => {
  const participant = participants.find(
    (participant) => participant.userId === currentUserId,
  );

  if (!participant) {
    throw new Error("Current user is not a participant in this duel.");
  }

  const normalizedWord = duel.word.toUpperCase();

  const matchResults = participant.guesses.map((guess) =>
    calculateMatchObj(normalizedWord, guess.toUpperCase()),
  );

  return {
    duel: {
      id: duel.id,
      initiatedBy: duel.initiatedBy,
      createdAt: duel.createdAt,
      completed: duel.completed,
      winner: duel.winner,
      participants: duel.participants,
    },
    participant: participants,
    matchResults,
    keyboardState: buildKeyboardState(matchResults),
    isCorrect: participant.success,
    isGameOver: participant.endTime !== null,
    ...(participant.endTime ? { secretWord: normalizedWord } : {}),
  };
};
