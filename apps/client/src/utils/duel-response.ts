import type { duelParticipants, duels } from "@/db/schema";
import { buildKeyboardState, calculateMatchObj } from "@/utils/duel";

type Duel = typeof duels.$inferSelect;
type Participant = typeof duelParticipants.$inferSelect;

/**
 * Attach guess words to participants for a SPECIFIC viewer, applying the privacy
 * rule: a viewer always gets their own guesses, and gets another player's only
 * once the viewer's own game has ended (solved, out of guesses, forfeited, or
 * timed out — i.e. their `endTime` is set, the same condition that reveals the
 * secret word). Before that, an opponent's guesses (whose last entry may be the
 * answer) must not reach the client in any form.
 *
 * The `guesses` value on the incoming rows is ALWAYS discarded and replaced from
 * `guessesByUser`, so the deprecated `duel_participants.guesses` column can never
 * leak through this path.
 */
export const redactParticipantGuesses = (
	participants: Participant[],
	guessesByUser: Record<string, string[]>,
	viewerId: string,
): Participant[] => {
	const viewer = participants.find((p) => p.userId === viewerId);
	const viewerFinished = viewer?.endTime != null;

	return participants.map((participant) => ({
		...participant,
		guesses:
			participant.userId === viewerId || viewerFinished
				? (guessesByUser[participant.userId] ?? [])
				: [],
	}));
};

export const buildDuelResponse = (
	duel: Duel,
	word: string,
	participants: Participant[],
	currentUserId: string,
	guessesByUser: Record<string, string[]>,
) => {
	const participant = participants.find(
		(participant) => participant.userId === currentUserId,
	);

	if (!participant) {
		throw new Error("Current user is not a participant in this duel.");
	}

	const normalizedWord = word.toUpperCase();
	const ownGuesses = guessesByUser[currentUserId] ?? [];
	const matchResults = ownGuesses.map((guess) =>
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
		participant: redactParticipantGuesses(
			participants,
			guessesByUser,
			currentUserId,
		),
		matchResults,
		keyboardState: buildKeyboardState(matchResults, normalizedWord),
		isCorrect: participant.success,
		isGameOver: participant.endTime !== null,
		...(participant.endTime ? { secretWord: normalizedWord } : {}),
	};
};
