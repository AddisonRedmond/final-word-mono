import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { and, arrayContains, eq, exists, inArray, not, or } from "drizzle-orm";

import { duelParticipants, duels, friendships } from "@/db/schema";
import {
  getRandomWord,
  haveAllDuelParticipantsFinished,
  determineDuelWinner,
  MAX_GUESSES,
} from "@/utils/duel";
import { buildDuelResponse } from "@/utils/duel-response";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const MAX_ACTIVE_DUELS = 5;
const MAX_INVITEES = 4;

export const duelsRouter = createTRPCRouter({
  /*
   * Get active duels for the current user.
   */
  allDuels: protectedProcedure.query(async ({ ctx }) => {
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
  sendDuel: protectedProcedure
    .input(z.array(z.string().uuid()).min(1).max(MAX_INVITEES))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      if (input.includes(userId) || new Set(input).size !== input.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invitees must be unique users other than yourself.",
        });
      }

      const activeDuels = await ctx.db
        .select({ duelId: duelParticipants.duelId })
        .from(duelParticipants)
        .innerJoin(duels, eq(duels.id, duelParticipants.duelId))
        .where(
          and(eq(duelParticipants.userId, userId), eq(duels.completed, false)),
        );

      if (activeDuels.length >= MAX_ACTIVE_DUELS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can only have ${MAX_ACTIVE_DUELS} active duels at a time.`,
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
            word: getRandomWord(),
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

        await tx.insert(duelParticipants).values({
          duelId: duel.id,
          userId,
          accepted: true,
          startTime: new Date(),
        });

        return duel;
      });
    }),

  startOrResumeDuel: protectedProcedure
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

      return buildDuelResponse(duel, participants, userId);
    }),

  /*
   * Decline a duel invitation.
   */
  declineDuel: protectedProcedure
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

          await tx
            .update(duels)
            .set({
              completed: true,
              winner,
            })
            .where(eq(duels.id, duel.id));
        }
      });
    }),

  /*
   * Forfeit an active duel.
   */
  forfeitDuel: protectedProcedure
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

        await tx
          .update(duelParticipants)
          .set({
            accepted: false,
            endTime: new Date(),
            success: false,
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

          await tx
            .update(duels)
            .set({
              completed: true,
              winner,
            })
            .where(eq(duels.id, input));
        }
      });
    }),

  /*
   * Acknowledge that the user has seen the completed duel.
   */
  acknowledgeDuel: protectedProcedure
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

      const [updated] = await ctx.db
        .update(duelParticipants)
        .set({
          completed_game_acknowledged: true,
        })
        .where(
          and(
            eq(duelParticipants.duelId, input),
            eq(duelParticipants.userId, ctx.user.id),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this duel.",
        });
      }
    }),

  /*
   * Submit a guess.
   */
  handleDuelGuess: protectedProcedure
    .input(
      z.object({
        duelId: z.string().uuid(),
        guess: z.string().length(5),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const normalizedGuess = input.guess.trim().toUpperCase();

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

        const normalizedWord = duel.word.toUpperCase();
        const isCorrect = normalizedGuess === normalizedWord;

        const updatedGuesses = [...participant.guesses, normalizedGuess];

        const isGameOver = isCorrect || updatedGuesses.length >= MAX_GUESSES;

        const [updatedParticipant] = await tx
          .update(duelParticipants)
          .set({
            guesses: updatedGuesses,
            totalGuesses: updatedGuesses.length,
            success: isCorrect,
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
          }
        }

        return {
          ...buildDuelResponse(updatedDuel, participants, userId),
          isCorrect,
          isGameOver,
        };
      });
    }),
});
