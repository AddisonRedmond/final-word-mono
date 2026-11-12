import { eq } from "drizzle-orm";
import { type DuelParticipant, duelGuesses } from "@/db/schema";
import type { DbOrTransaction } from "@/db/stats";

/**
 * Server-only access to `duel_guesses`, the client-unreadable store for the
 * words each duel participant has guessed (see the table's doc in the schema
 * for why guesses are kept out of `duel_participants`).
 */

/**
 * Pick the authoritative guess list for one participant. `duel_guesses` is the
 * source of truth; the deprecated `duel_participants.guesses` column is only
 * consulted so a duel that was in flight during the rollout (written by older
 * code that still used the column) doesn't lose guesses. The longer list wins:
 * guesses are append-only, so the longer one is always the more recent.
 */
export const resolveGuesses = (
	stored: readonly string[],
	legacy: readonly string[],
): string[] => [...(legacy.length > stored.length ? legacy : stored)];

/**
 * Every participant's guesses for a duel, keyed by user id. Callers must pass
 * the result through `buildDuelResponse` (which redacts other players' guesses)
 * before anything leaves the server.
 */
export const loadDuelGuesses = async (
	db: DbOrTransaction,
	duelId: string,
	participants: readonly DuelParticipant[],
): Promise<Record<string, string[]>> => {
	const rows = await db
		.select({ userId: duelGuesses.userId, guesses: duelGuesses.guesses })
		.from(duelGuesses)
		.where(eq(duelGuesses.duelId, duelId));

	const stored = new Map(rows.map((row) => [row.userId, row.guesses]));

	return Object.fromEntries(
		participants.map((participant) => [
			participant.userId,
			resolveGuesses(stored.get(participant.userId) ?? [], participant.guesses),
		]),
	);
};

/** Persist a participant's full guess list (insert or replace). */
export const saveGuesses = async (
	tx: DbOrTransaction,
	duelId: string,
	userId: string,
	guesses: string[],
): Promise<void> => {
	await tx
		.insert(duelGuesses)
		.values({ duelId, userId, guesses })
		.onConflictDoUpdate({
			target: [duelGuesses.duelId, duelGuesses.userId],
			set: { guesses },
		});
};
