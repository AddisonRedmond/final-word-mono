import { TRPCError } from "@trpc/server";
import {
	and,
	arrayContains,
	desc,
	eq,
	exists,
	inArray,
	not,
	or,
} from "drizzle-orm";
import { z } from "zod";

import {
	type DuelParticipant,
	type DuelResult,
	duelParticipants,
	duelResults,
	duelSecrets,
	duels,
	friendships,
	isPremiumEntitlement,
	LIFETIME_SCOPE,
	profiles,
	seasonKey,
	TIER_LIMITS,
	tierLimits,
} from "@/db/schema";
import { type DbOrTransaction, upsertModeStats } from "@/db/stats";
import { createTRPCRouter, guestProtectedProcedure } from "@/server/api/trpc";
import {
	determineDuelWinner,
	getRandomWord,
	haveAllDuelParticipantsFinished,
	isValidDuelWord,
	MAX_GUESSES,
} from "@/utils/duel";
import { buildDuelResponse } from "@/utils/duel-response";

/**
 * Records the stats side-effects of a duel that just transitioned to
 * `completed = true`. Called inside the SAME transaction that sets `completed`
 * in each completion branch (`handleDuelGuess` / `declineDuel` / `forfeitDuel`)
 * so the duel's completion and its recorded facts move together or not at all.
 *
 * For every participant who actually finished a timed attempt (has an
 * `endTime`):
 *   1. Insert one immutable `duel_results` row (`won`, `isDraw`, `solved`,
 *      `guesses`, `solveMs`, `completedAt`, `season`). Idempotent via the
 *      `(duelId, userId)` PK + `onConflictDoNothing`, so a replay of a
 *      completion never double-writes.
 *   2. Fold the finisher into `player_mode_stats` with `mode = "duel"` for BOTH
 *      the lifetime scope and the current-season scope (R1.4). Duel is NOT a
 *      scored mode, so no match points accrue (R2A.8); `upsertModeStats` leaves
 *      the points columns at 0 for `duel`.
 *
 * A participant who never played (declined, or an invitee who let the duel
 * resolve) has no `endTime` and therefore no result row — they are not part of
 * anyone's head-to-head (R6.1, R6.5). Bots are filtered by `isRealPlayer`
 * inside `upsertModeStats`; `duel_results` is only written for real UUID users.
 *
 * Mirrors the existing stats pattern: a persistence failure never breaks duel
 * completion. `upsertModeStats` logs and swallows its own errors.
 */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const persistDuelCompletion = async (
	tx: DbOrTransaction,
	{
		duelId,
		winner,
		participants,
		completedAt,
	}: {
		duelId: string;
		winner: string | null;
		participants: DuelParticipant[];
		completedAt: Date;
	},
): Promise<void> => {
	const season = seasonKey(completedAt);
	// A completed duel with no winner is a draw for everyone who played.
	const isDraw = winner === null;

	// Only participants who finished a timed attempt produce a result (R6.1).
	const finishers = participants.filter(
		(participant) => participant.endTime !== null,
	);

	for (const participant of finishers) {
		const { userId } = participant;
		// duel_results only holds real players; bots never produce rows.
		const isRealPlayer = UUID_RE.test(userId);

		const solveMs =
			participant.startTime && participant.endTime
				? participant.endTime.getTime() - participant.startTime.getTime()
				: null;

		if (isRealPlayer) {
			// Idempotent on (duelId, userId): a replayed completion is a no-op.
			await tx
				.insert(duelResults)
				.values({
					duelId,
					userId,
					won: userId === winner,
					isDraw,
					solved: participant.success,
					guesses: participant.totalGuesses,
					solveMs,
					completedAt,
					season,
				})
				.onConflictDoNothing({
					target: [duelResults.duelId, duelResults.userId],
				});
		}

		// Fold the finisher into player_mode_stats for lifetime + season. Duel is
		// not scored, so no points are passed. `upsertModeStats` guards
		// eligibility (bots excluded, guests included) and swallows failures.
		const outcome = {
			won: userId === winner,
			isDraw,
			totalGuesses: participant.totalGuesses,
			...(solveMs !== null ? { solveMs } : {}),
		};

		await upsertModeStats(
			tx,
			{ userId, mode: "duel", scope: LIFETIME_SCOPE, outcome },
			completedAt,
		);
		await upsertModeStats(
			tx,
			{ userId, mode: "duel", scope: season, outcome },
			completedAt,
		);
	}
};

/**
 * One recorded outcome of a shared duel from the caller's point of view, used
 * to build a head-to-head record. `completedAt` is kept so results can be
 * ordered newest-first and the rivalry streak read off the most recent game.
 */
export type HeadToHeadGame = {
	duelId: string;
	completedAt: Date;
	// Who won this duel between the two players: the caller, the opponent, or a
	// draw (nobody won, or neither of these two won it).
	outcome: "self" | "opponent" | "draw";
};

/**
 * The directed head-to-head record between the caller and one opponent (R6.2,
 * R6.3): totals, each side's wins, draws, the current rivalry streak, and the
 * most-recent results.
 */
export type HeadToHead = {
	opponentId: string;
	totalGames: number;
	selfWins: number;
	opponentWins: number;
	draws: number;
	// The run of identical outcomes ending at the most recent completed duel
	// (R6.3). `count` is 0 only when the two have never shared a completed duel.
	streak: { outcome: "self" | "opponent" | "draw"; count: number };
	// Shared completed duels, newest first.
	recent: HeadToHeadGame[];
};

/**
 * Collapse a caller row and an opponent row from the SAME completed duel into a
 * single head-to-head outcome. A duel is a draw for this pairing unless exactly
 * one of the two won it — in a multi-player duel won by a third party, neither
 * side gets the win here, so it counts as a draw between these two.
 */
const h2hOutcome = (
	selfWon: boolean,
	opponentWon: boolean,
): "self" | "opponent" | "draw" => {
	if (selfWon && !opponentWon) return "self";
	if (opponentWon && !selfWon) return "opponent";
	return "draw";
};

/**
 * The rivalry streak (R6.3): the number of consecutive games with the SAME
 * outcome, counted back from the most recent shared duel. `games` must be
 * ordered newest-first. Returns a 0-count draw streak for an empty history.
 */
export const rivalryStreak = (
	games: HeadToHeadGame[],
): { outcome: "self" | "opponent" | "draw"; count: number } => {
	const [latest] = games;
	if (!latest) return { outcome: "draw", count: 0 };

	let count = 0;
	for (const game of games) {
		if (game.outcome !== latest.outcome) break;
		count += 1;
	}
	return { outcome: latest.outcome, count };
};

/**
 * Pure head-to-head aggregation (R6.2, R6.3). Given the caller's and the
 * opponent's `duel_results` rows, it keeps only the duels BOTH played (the
 * intersection by `duelId`), derives one outcome per shared duel, orders them
 * newest-first, and rolls up totals + rivalry streak. No DB access, so the
 * aggregation is unit-testable in isolation (incl. draws and multi-player
 * duels where a third party won).
 */
export const computeHeadToHead = (
	opponentId: string,
	selfRows: Pick<DuelResult, "duelId" | "won" | "completedAt">[],
	opponentRows: Pick<DuelResult, "duelId" | "won">[],
): HeadToHead => {
	const opponentWonByDuel = new Map(
		opponentRows.map((row) => [row.duelId, row.won]),
	);

	const games: HeadToHeadGame[] = [];
	for (const row of selfRows) {
		// A shared duel is one where the opponent ALSO has a result row.
		if (!opponentWonByDuel.has(row.duelId)) continue;
		games.push({
			duelId: row.duelId,
			completedAt: row.completedAt,
			outcome: h2hOutcome(row.won, opponentWonByDuel.get(row.duelId) ?? false),
		});
	}

	// Newest first for both the recent list and the streak read-off.
	games.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

	let selfWins = 0;
	let opponentWins = 0;
	let draws = 0;
	for (const game of games) {
		if (game.outcome === "self") selfWins += 1;
		else if (game.outcome === "opponent") opponentWins += 1;
		else draws += 1;
	}

	return {
		opponentId,
		totalGames: games.length,
		selfWins,
		opponentWins,
		draws,
		streak: rivalryStreak(games),
		recent: games,
	};
};

// The Zod input ceiling for invitees is the PREMIUM cap; the per-request limit
// a user is actually held to (free vs premium) is enforced at runtime in
// `sendDuel` against their entitlement. Free users who send more than their cap
// get a clear error rather than a silent truncation.
const MAX_INVITEES_CEILING = TIER_LIMITS.premium.duelInvitees;

export const duelsRouter = createTRPCRouter({
	/*
	 * Get active duels for the current user.
	 */
	allDuels: guestProtectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;

		const declinedDuel = ctx.db
			.select({ duelId: duelParticipants.duelId })
			.from(duelParticipants)
			.where(
				and(
					eq(duelParticipants.duelId, duels.id),
					eq(duelParticipants.userId, userId),
					eq(duelParticipants.accepted, false),
				),
			);

		const acknowledgedCompletedDuel = ctx.db
			.select({ duelId: duelParticipants.duelId })
			.from(duelParticipants)
			.where(
				and(
					eq(duelParticipants.duelId, duels.id),
					eq(duelParticipants.userId, userId),
					eq(duelParticipants.completed_game_acknowledged, true),
					eq(duels.completed, true),
				),
			);

		return ctx.db
			.select({
				id: duels.id,
				initiatedBy: duels.initiatedBy,
				createdAt: duels.createdAt,
				completed: duels.completed,
				winner: duels.winner,
				participants: duels.participants,
				rematchOfDuelId: duels.rematchOfDuelId,
			})
			.from(duels)
			.where(
				and(
					arrayContains(duels.participants, [userId]),
					not(exists(declinedDuel)),
					not(exists(acknowledgedCompletedDuel)),
				),
			);
	}),

	/*
	 * Create a new duel.
	 */
	sendDuel: guestProtectedProcedure
		.input(z.array(z.string().uuid()).min(1).max(MAX_INVITEES_CEILING))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			if (input.includes(userId) || new Set(input).size !== input.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invitees must be unique users other than yourself.",
				});
			}

			// Premium gating: free accounts can invite fewer players and hold fewer
			// concurrent duels than premium. Read the caller's entitlement from
			// their profile (same rule as `billing.status`) and pick their tier's
			// limits. A read is cheap and keeps the gate authoritative server-side.
			const [profile] = await ctx.db
				.select({
					premiumStatus: profiles.premiumStatus,
					premiumUntil: profiles.premiumUntil,
				})
				.from(profiles)
				.where(eq(profiles.id, userId))
				.limit(1);

			const isPremium = isPremiumEntitlement(
				profile?.premiumStatus,
				profile?.premiumUntil,
			);
			const limits = tierLimits(isPremium);

			// Invitee cap (free 2 / premium 4). The Zod schema already caps at the
			// premium ceiling; this holds a free user to their lower cap and tells
			// them premium raises it.
			if (input.length > limits.duelInvitees) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: isPremium
						? `You can invite up to ${limits.duelInvitees} players to a duel.`
						: `Free accounts can invite up to ${limits.duelInvitees} players. Upgrade to premium to invite up to ${TIER_LIMITS.premium.duelInvitees}.`,
				});
			}

			const activeDuels = await ctx.db
				.select({ duelId: duelParticipants.duelId })
				.from(duelParticipants)
				.innerJoin(duels, eq(duels.id, duelParticipants.duelId))
				.where(
					and(eq(duelParticipants.userId, userId), eq(duels.completed, false)),
				);

			// Active (ongoing) duel cap (free 2 / premium 5).
			if (activeDuels.length >= limits.activeDuels) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: isPremium
						? `You can only have ${limits.activeDuels} active duels at a time.`
						: `Free accounts can have ${limits.activeDuels} active duels at a time. Upgrade to premium for up to ${TIER_LIMITS.premium.activeDuels}.`,
				});
			}

			const acceptedFriendships = await ctx.db
				.select()
				.from(friendships)
				.where(
					and(
						eq(friendships.status, "accepted"),
						or(
							and(
								eq(friendships.requesterId, userId),
								inArray(friendships.addresseeId, input),
							),
							and(
								eq(friendships.addresseeId, userId),
								inArray(friendships.requesterId, input),
							),
						),
					),
				);

			const friendIds = new Set(
				acceptedFriendships.map((friendship) =>
					friendship.requesterId === userId
						? friendship.addresseeId
						: friendship.requesterId,
				),
			);

			const nonFriendInvitees = input.filter((id) => !friendIds.has(id));

			if (nonFriendInvitees.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You can only duel users who are your friends.",
				});
			}

			const participantIds = [userId, ...input];

			return ctx.db.transaction(async (tx) => {
				const [duel] = await tx
					.insert(duels)
					.values({
						initiatedBy: userId,
						createdAt: new Date(),
						completed: false,
						participants: participantIds,
					})
					.returning();

				if (!duel) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create duel.",
					});
				}

				// The answer word lives in a separate, client-inaccessible table so it
				// never reaches the browser via realtime. Written in the same
				// transaction as the duel so a duel can never exist without its word.
				await tx.insert(duelSecrets).values({
					duelId: duel.id,
					word: getRandomWord(),
				});

				// The initiator is an accepted participant immediately, but their
				// play timer should not start until they submit their first guess.
				// startTime is stamped in handleDuelGuess, matching how invitees are
				// handled when they resume.
				await tx.insert(duelParticipants).values({
					duelId: duel.id,
					userId,
					accepted: true,
				});

				return duel;
			});
		}),

	/*
	 * Rematch a completed duel (R5): create a NEW duel reusing the SAME
	 * participant set as a source duel the caller finished, with a fresh secret
	 * word and `rematchOfDuelId` pointing back to the source so a rivalry chain
	 * is traceable (R5.5).
	 *
	 * The caller becomes the new initiator; the invitees are the source duel's
	 * other participants. Before creating anything, the rematch is held to the
	 * SAME creation rules as a normal `sendDuel` (R5.3): the invitees must still
	 * all be friends (R5.7), the invitee cap and active-duel cap for the caller's
	 * tier must not be exceeded (R5.4), all with the same tier-aware messages.
	 */
	rematchDuel: guestProtectedProcedure
		.input(z.object({ sourceDuelId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			// The rematch may only re-run a duel the caller actually took part in
			// and that has finished (R5.1).
			const [sourceDuel] = await ctx.db
				.select()
				.from(duels)
				.where(eq(duels.id, input.sourceDuelId));

			if (!sourceDuel) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Duel not found.",
				});
			}

			if (!sourceDuel.participants.includes(userId)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a participant in this duel.",
				});
			}

			if (!sourceDuel.completed) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You can only rematch a completed duel.",
				});
			}

			// The invitees are the source duel's participants minus the caller, who
			// becomes the new initiator. De-duplicated defensively; a well-formed
			// source duel already has a unique participant set.
			const invitees = [
				...new Set(
					sourceDuel.participants.filter(
						(participantId) => participantId !== userId,
					),
				),
			];

			if (invitees.length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This duel has no other participants to rematch.",
				});
			}

			// From here the rematch is held to the exact same creation rules as a
			// normal duel (R5.3), with the same tier-aware messaging as `sendDuel`.

			// Premium gating: read the caller's entitlement to pick their tier's
			// limits (same rule as `sendDuel` / `billing.status`).
			const [profile] = await ctx.db
				.select({
					premiumStatus: profiles.premiumStatus,
					premiumUntil: profiles.premiumUntil,
				})
				.from(profiles)
				.where(eq(profiles.id, userId))
				.limit(1);

			const isPremium = isPremiumEntitlement(
				profile?.premiumStatus,
				profile?.premiumUntil,
			);
			const limits = tierLimits(isPremium);

			// Invitee cap (free 2 / premium 4).
			if (invitees.length > limits.duelInvitees) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: isPremium
						? `You can invite up to ${limits.duelInvitees} players to a duel.`
						: `Free accounts can invite up to ${limits.duelInvitees} players. Upgrade to premium to invite up to ${TIER_LIMITS.premium.duelInvitees}.`,
				});
			}

			const activeDuels = await ctx.db
				.select({ duelId: duelParticipants.duelId })
				.from(duelParticipants)
				.innerJoin(duels, eq(duels.id, duelParticipants.duelId))
				.where(
					and(eq(duelParticipants.userId, userId), eq(duels.completed, false)),
				);

			// Active (ongoing) duel cap (free 2 / premium 5) (R5.4).
			if (activeDuels.length >= limits.activeDuels) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: isPremium
						? `You can only have ${limits.activeDuels} active duels at a time.`
						: `Free accounts can have ${limits.activeDuels} active duels at a time. Upgrade to premium for up to ${TIER_LIMITS.premium.activeDuels}.`,
				});
			}

			// Every invitee must still be an accepted friend of the caller (R5.7):
			// a rematch never silently drops a former participant who is no longer
			// a valid opponent — it rejects with a clear message.
			const acceptedFriendships = await ctx.db
				.select()
				.from(friendships)
				.where(
					and(
						eq(friendships.status, "accepted"),
						or(
							and(
								eq(friendships.requesterId, userId),
								inArray(friendships.addresseeId, invitees),
							),
							and(
								eq(friendships.addresseeId, userId),
								inArray(friendships.requesterId, invitees),
							),
						),
					),
				);

			const friendIds = new Set(
				acceptedFriendships.map((friendship) =>
					friendship.requesterId === userId
						? friendship.addresseeId
						: friendship.requesterId,
				),
			);

			const nonFriendInvitees = invitees.filter((id) => !friendIds.has(id));

			if (nonFriendInvitees.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"You can only rematch players who are still your friends.",
				});
			}

			const participantIds = [userId, ...invitees];

			// Mirror `sendDuel`'s atomic creation: the new duel, its secret word,
			// and the initiator's participant row move together or not at all. The
			// only addition is `rematchOfDuelId` linking back to the source (R5.5).
			return ctx.db.transaction(async (tx) => {
				const [duel] = await tx
					.insert(duels)
					.values({
						initiatedBy: userId,
						createdAt: new Date(),
						completed: false,
						participants: participantIds,
						rematchOfDuelId: sourceDuel.id,
					})
					.returning();

				if (!duel) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create duel.",
					});
				}

				await tx.insert(duelSecrets).values({
					duelId: duel.id,
					word: getRandomWord(),
				});

				await tx.insert(duelParticipants).values({
					duelId: duel.id,
					userId,
					accepted: true,
				});

				return duel;
			});
		}),

	startOrResumeDuel: guestProtectedProcedure
		.input(z.string().uuid())
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			const [duel] = await ctx.db
				.select()
				.from(duels)
				.where(eq(duels.id, input));

			if (!duel) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Duel not found.",
				});
			}

			if (!duel.participants.includes(userId)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a participant in this duel.",
				});
			}

			const [existingParticipant] = await ctx.db
				.select()
				.from(duelParticipants)
				.where(
					and(
						eq(duelParticipants.duelId, input),
						eq(duelParticipants.userId, userId),
					),
				);

			if (existingParticipant) {
				if (existingParticipant.accepted !== true) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You have declined or forfeited this duel.",
					});
				}

				if (duel.completed && !existingParticipant.endTime) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This duel has already been completed.",
					});
				}

				// Stamp the play timer when a participant (typically the initiator,
				// whose row is created up front) first opens the board without having
				// started or finished yet.
				if (
					!duel.completed &&
					existingParticipant.startTime === null &&
					existingParticipant.endTime === null
				) {
					await ctx.db
						.update(duelParticipants)
						.set({ startTime: new Date() })
						.where(
							and(
								eq(duelParticipants.duelId, input),
								eq(duelParticipants.userId, userId),
							),
						);
				}
			} else {
				if (duel.completed) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This duel has already been completed.",
					});
				}

				const [newParticipant] = await ctx.db
					.insert(duelParticipants)
					.values({
						duelId: input,
						userId,
						startTime: new Date(),
						accepted: true,
					})
					.returning();

				if (!newParticipant) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create participant.",
					});
				}
			}

			const participants = await ctx.db
				.select()
				.from(duelParticipants)
				.where(eq(duelParticipants.duelId, input));

			// Fetch the answer word server-side (RLS-bypassing connection).
			// buildDuelResponse only reveals it back to the client once the
			// participant has finished.
			const [secret] = await ctx.db
				.select({ word: duelSecrets.word })
				.from(duelSecrets)
				.where(eq(duelSecrets.duelId, input));

			if (!secret) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Duel is missing its answer word.",
				});
			}

			return buildDuelResponse(duel, secret.word, participants, userId);
		}),

	/*
	 * Decline a duel invitation.
	 */
	declineDuel: guestProtectedProcedure
		.input(z.string().uuid())
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			await ctx.db.transaction(async (tx) => {
				const [duel] = await tx.select().from(duels).where(eq(duels.id, input));

				if (!duel) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Duel not found.",
					});
				}

				if (!duel.participants.includes(userId)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You are not a participant in this duel.",
					});
				}

				if (duel.completed) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This duel has already been completed.",
					});
				}

				if (duel.initiatedBy === userId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "The initiator cannot decline their own duel.",
					});
				}

				const [existingParticipant] = await tx
					.select()
					.from(duelParticipants)
					.where(
						and(
							eq(duelParticipants.duelId, duel.id),
							eq(duelParticipants.userId, userId),
						),
					);

				if (existingParticipant) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You have already responded to this duel.",
					});
				}

				await tx.insert(duelParticipants).values({
					duelId: duel.id,
					userId,
					accepted: false,
				});

				const participants = await tx
					.select()
					.from(duelParticipants)
					.where(eq(duelParticipants.duelId, duel.id));

				const allFinished = haveAllDuelParticipantsFinished(
					duel.participants,
					duel.initiatedBy,
					participants,
				);

				if (allFinished) {
					const winner = determineDuelWinner(participants);
					const completedAt = new Date();

					await tx
						.update(duels)
						.set({
							completed: true,
							winner,
						})
						.where(eq(duels.id, duel.id));

					await persistDuelCompletion(tx, {
						duelId: duel.id,
						winner,
						participants,
						completedAt,
					});
				}
			});
		}),

	/*
	 * Forfeit an active duel.
	 */
	forfeitDuel: guestProtectedProcedure
		.input(z.string().uuid())
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			await ctx.db.transaction(async (tx) => {
				const [duel] = await tx.select().from(duels).where(eq(duels.id, input));

				if (!duel) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Duel not found.",
					});
				}

				if (duel.completed) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This duel has already been completed.",
					});
				}

				const [participant] = await tx
					.select()
					.from(duelParticipants)
					.where(
						and(
							eq(duelParticipants.duelId, input),
							eq(duelParticipants.userId, userId),
						),
					);

				if (
					!participant ||
					participant.accepted !== true ||
					participant.endTime
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Only an active duel can be forfeited.",
					});
				}

				// A forfeit ends the forfeiter's own game (endTime set, success
				// false — so they can never win), but it is NOT a decline. We keep
				// `accepted: true` so the forfeiter stays a full participant: the
				// duel remains in their active list, and they can reopen the board
				// to review their own result and watch the other players' progress.
				// (Flipping `accepted` to false, as a decline does, is what used to
				// hide the duel from them entirely.) A forfeit is still distinguished
				// from a normal finish by `endTime` + `success === false`, which the
				// UI renders with the red "forfeit" status.
				await tx
					.update(duelParticipants)
					.set({
						endTime: new Date(),
						success: false,
						forfeited: true,
					})
					.where(
						and(
							eq(duelParticipants.duelId, input),
							eq(duelParticipants.userId, userId),
						),
					);

				const participants = await tx
					.select()
					.from(duelParticipants)
					.where(eq(duelParticipants.duelId, input));

				const allFinished = haveAllDuelParticipantsFinished(
					duel.participants,
					duel.initiatedBy,
					participants,
				);

				if (allFinished) {
					const winner = determineDuelWinner(participants);
					const completedAt = new Date();

					await tx
						.update(duels)
						.set({
							completed: true,
							winner,
						})
						.where(eq(duels.id, input));

					await persistDuelCompletion(tx, {
						duelId: input,
						winner,
						participants,
						completedAt,
					});
				}
			});
		}),

	/*
	 * Acknowledge that the user has seen the completed duel.
	 */
	acknowledgeDuel: guestProtectedProcedure
		.input(z.string().uuid())
		.mutation(async ({ ctx, input }) => {
			const [duel] = await ctx.db
				.select()
				.from(duels)
				.where(eq(duels.id, input));

			if (!duel) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Duel not found.",
				});
			}

			if (!duel.completed) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This duel is not completed yet.",
				});
			}

			if (!duel.participants.includes(ctx.user.id)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a participant in this duel.",
				});
			}

			/*
			 * A user may be a listed participant of a completed duel without ever
			 * having a duel_participants row (e.g. an invitee who never responded
			 * before the duel resolved). Upsert so that acknowledging always
			 * succeeds and the duel drops out of their active list.
			 */
			await ctx.db
				.insert(duelParticipants)
				.values({
					duelId: input,
					userId: ctx.user.id,
					completed_game_acknowledged: true,
				})
				.onConflictDoUpdate({
					target: [duelParticipants.duelId, duelParticipants.userId],
					set: { completed_game_acknowledged: true },
				});
		}),

	/*
	 * List the current user's archived duels: completed duels they have
	 * explicitly archived (`completed_game_acknowledged = true`). This is the
	 * inverse of the archive-exclusion filter in `allDuels`, so an archived duel
	 * leaves the active list and shows up here instead.
	 */
	archivedDuels: guestProtectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;

		const archivedForUser = ctx.db
			.select({ duelId: duelParticipants.duelId })
			.from(duelParticipants)
			.where(
				and(
					eq(duelParticipants.duelId, duels.id),
					eq(duelParticipants.userId, userId),
					eq(duelParticipants.completed_game_acknowledged, true),
				),
			);

		return ctx.db
			.select({
				id: duels.id,
				initiatedBy: duels.initiatedBy,
				createdAt: duels.createdAt,
				completed: duels.completed,
				winner: duels.winner,
				participants: duels.participants,
				rematchOfDuelId: duels.rematchOfDuelId,
			})
			.from(duels)
			.where(
				and(
					arrayContains(duels.participants, [userId]),
					eq(duels.completed, true),
					exists(archivedForUser),
				),
			);
	}),

	/*
	 * Read-only result for a completed duel the current user participated in.
	 * Unlike `startOrResumeDuel`, this never mutates (no timer stamping, no
	 * participant insert) — it's used to review an archived duel's result as
	 * many times as the user likes without changing any state.
	 */
	getDuelResult: guestProtectedProcedure
		.input(z.string().uuid())
		.query(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			const [duel] = await ctx.db
				.select()
				.from(duels)
				.where(eq(duels.id, input));

			if (!duel) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Duel not found.",
				});
			}

			if (!duel.participants.includes(userId)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a participant in this duel.",
				});
			}

			if (!duel.completed) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This duel is not completed yet.",
				});
			}

			const participants = await ctx.db
				.select()
				.from(duelParticipants)
				.where(eq(duelParticipants.duelId, input));

			const participant = participants.find((p) => p.userId === userId);

			// A listed participant who never played (e.g. an invitee who let the
			// duel resolve) has no result to show.
			if (!participant) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You have no result for this duel.",
				});
			}

			const [secret] = await ctx.db
				.select({ word: duelSecrets.word })
				.from(duelSecrets)
				.where(eq(duelSecrets.duelId, input));

			if (!secret) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Duel is missing its answer word.",
				});
			}

			return buildDuelResponse(duel, secret.word, participants, userId);
		}),

	/*
	 * Head-to-head record between the caller and one opponent (R6.2, R6.3).
	 *
	 * Reads only `duel_results`, which exist solely for completed duels the
	 * caller actually finished — so this never exposes an unrelated duel (R6.5).
	 * The shared games are the duels where BOTH players have a result row (the
	 * self-join on `duelId`): we fetch the caller's rows and the opponent's rows
	 * scoped to the caller's duel IDs, then aggregate in `computeHeadToHead`.
	 * Draws and multi-player duels (won by a third party) fall out naturally.
	 */
	headToHead: guestProtectedProcedure
		.input(z.object({ opponentId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.user.id;

			if (input.opponentId === userId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You cannot have a head-to-head record with yourself.",
				});
			}

			// The caller's completed-duel results (only duels they participated in).
			const selfRows = await ctx.db
				.select({
					duelId: duelResults.duelId,
					won: duelResults.won,
					completedAt: duelResults.completedAt,
				})
				.from(duelResults)
				.where(eq(duelResults.userId, userId));

			// Nothing to compare against if the caller has no recorded duels.
			if (selfRows.length === 0) {
				return computeHeadToHead(input.opponentId, [], []);
			}

			// The opponent's rows, restricted to the caller's duels so we only ever
			// read results for duels the caller participated in (R6.5).
			const opponentRows = await ctx.db
				.select({
					duelId: duelResults.duelId,
					won: duelResults.won,
				})
				.from(duelResults)
				.where(
					and(
						eq(duelResults.userId, input.opponentId),
						inArray(
							duelResults.duelId,
							selfRows.map((row) => row.duelId),
						),
					),
				);

			return computeHeadToHead(input.opponentId, selfRows, opponentRows);
		}),

	/*
	 * The caller's completed-duel history, newest first (R6.4).
	 *
	 * Each entry is one of the caller's `duel_results` rows — so by construction
	 * only duels the caller participated in appear (R6.5) — paired with the other
	 * participants' profiles (opponents) for that duel. Opponent identities come
	 * from `duels.participants`; their display info is joined from `profiles`.
	 */
	history: guestProtectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.user.id;

		// Caller's own results, newest first.
		const results = await ctx.db
			.select({
				duelId: duelResults.duelId,
				won: duelResults.won,
				isDraw: duelResults.isDraw,
				solved: duelResults.solved,
				guesses: duelResults.guesses,
				solveMs: duelResults.solveMs,
				completedAt: duelResults.completedAt,
				season: duelResults.season,
				participants: duels.participants,
			})
			.from(duelResults)
			.innerJoin(duels, eq(duels.id, duelResults.duelId))
			.where(eq(duelResults.userId, userId))
			.orderBy(desc(duelResults.completedAt));

		if (results.length === 0) {
			return [];
		}

		// Resolve opponent display info in one pass: every other participant
		// across the caller's duels.
		const opponentIds = new Set<string>();
		for (const result of results) {
			for (const participantId of result.participants) {
				if (participantId !== userId) opponentIds.add(participantId);
			}
		}

		const opponentProfiles =
			opponentIds.size > 0
				? await ctx.db
						.select({
							id: profiles.id,
							name: profiles.name,
							email: profiles.email,
						})
						.from(profiles)
						.where(inArray(profiles.id, [...opponentIds]))
				: [];

		const profileById = new Map(opponentProfiles.map((p) => [p.id, p]));

		return results.map((result) => ({
			duelId: result.duelId,
			won: result.won,
			isDraw: result.isDraw,
			solved: result.solved,
			guesses: result.guesses,
			solveMs: result.solveMs,
			completedAt: result.completedAt,
			season: result.season,
			opponents: result.participants
				.filter((participantId) => participantId !== userId)
				.map((participantId) => ({
					id: participantId,
					name: profileById.get(participantId)?.name ?? null,
					email: profileById.get(participantId)?.email ?? null,
				})),
		}));
	}),

	/*
	 * Submit a guess.
	 */
	handleDuelGuess: guestProtectedProcedure
		.input(
			z.object({
				duelId: z.string().uuid(),
				guess: z.string().length(5),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.user.id;
			const normalizedGuess = input.guess.trim().toUpperCase();

			if (!isValidDuelWord(normalizedGuess)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Guess is not a valid word.",
				});
			}

			return ctx.db.transaction(async (tx) => {
				/*
				 * Lock the duel row so two players finishing at the
				 * same time cannot both finalize the duel independently.
				 */
				const [duel] = await tx
					.select()
					.from(duels)
					.where(eq(duels.id, input.duelId))
					.for("update");

				if (!duel) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Duel not found.",
					});
				}

				if (duel.completed) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This duel has already been completed.",
					});
				}

				const [participant] = await tx
					.select()
					.from(duelParticipants)
					.where(
						and(
							eq(duelParticipants.duelId, input.duelId),
							eq(duelParticipants.userId, userId),
						),
					);

				if (!participant) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You are not a participant in this duel.",
					});
				}

				if (participant.accepted !== true) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You are not an active participant in this duel.",
					});
				}

				if (participant.endTime !== null) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You have already finished this duel.",
					});
				}

				if (participant.guesses.length >= MAX_GUESSES) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No guesses remaining.",
					});
				}

				// The answer word lives in the client-inaccessible duel_secrets table.
				// Read it server-side (this connection bypasses RLS) to grade the guess.
				const [secret] = await tx
					.select({ word: duelSecrets.word })
					.from(duelSecrets)
					.where(eq(duelSecrets.duelId, input.duelId));

				if (!secret) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Duel is missing its answer word.",
					});
				}

				const normalizedWord = secret.word.toUpperCase();
				const isCorrect = normalizedGuess === normalizedWord;

				const updatedGuesses = [...participant.guesses, normalizedGuess];

				const isGameOver = isCorrect || updatedGuesses.length >= MAX_GUESSES;

				/*
				 * The initiator's participant row is created with a startTime at
				 * duel-creation time, but the timer should reflect when they actually
				 * began playing. If this is their first guess and no startTime has
				 * been recorded for the play session, stamp it now.
				 */
				const shouldStampStartTime =
					participant.startTime === null && participant.guesses.length === 0;

				const [updatedParticipant] = await tx
					.update(duelParticipants)
					.set({
						guesses: updatedGuesses,
						totalGuesses: updatedGuesses.length,
						// success must be monotonic — never flip a solved player back to
						// false on a subsequent write.
						success: participant.success || isCorrect,
						...(shouldStampStartTime ? { startTime: new Date() } : {}),
						...(isGameOver ? { endTime: new Date() } : {}),
					})
					.where(
						and(
							eq(duelParticipants.duelId, input.duelId),
							eq(duelParticipants.userId, userId),
						),
					)
					.returning();

				if (!updatedParticipant) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to save guess.",
					});
				}

				/*
				 * Always fetch all participants after updating the current
				 * participant so the response contains the latest state
				 * for everyone in the duel.
				 */
				let participants = await tx
					.select()
					.from(duelParticipants)
					.where(eq(duelParticipants.duelId, input.duelId));

				let updatedDuel = duel;

				if (isGameOver) {
					const allFinished = haveAllDuelParticipantsFinished(
						duel.participants,
						duel.initiatedBy,
						participants,
					);

					if (allFinished) {
						const winner = determineDuelWinner(participants);
						const completedAt = new Date();

						const [completedDuel] = await tx
							.update(duels)
							.set({
								completed: true,
								winner,
							})
							.where(eq(duels.id, input.duelId))
							.returning();

						if (completedDuel) {
							updatedDuel = completedDuel;
						}

						/*
						 * Refresh the participant list after the duel is finalized
						 * so the response represents the final database state.
						 */
						participants = await tx
							.select()
							.from(duelParticipants)
							.where(eq(duelParticipants.duelId, input.duelId));

						await persistDuelCompletion(tx, {
							duelId: input.duelId,
							winner,
							participants,
							completedAt,
						});
					}
				}

				return {
					...buildDuelResponse(updatedDuel, secret.word, participants, userId),
					isCorrect,
					isGameOver,
				};
			});
		}),
});
