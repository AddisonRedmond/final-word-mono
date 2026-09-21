import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { and, arrayContains, eq, exists, inArray, not, or } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { duelParticipants, duels, friendships } from "@/db/schema";
import {
  getRandomWord,
  haveAllDuelParticipantsFinished,
  calculateMatchObj,
  buildKeyboardState,
  isValidDuelWord,
  MAX_GUESSES,
} from "@/utils/duel";

const MAX_ACTIVE_DUELS = 5;
const MAX_INVITEES = 4;

export const duelsRouter = createTRPCRouter({
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

    return ctx.db
      // Do not expose the target word through list data while a duel is active.
      .select({
        id: duels.id,
        initiatedBy: duels.initiatedBy,
        createdAt: duels.createdAt,
        completed: duels.completed,
        participants: duels.participants,
      })
      .from(duels)
      .where(
        and(
          arrayContains(duels.participants, [userId]),
          not(exists(declinedDuel)),
          not(
            exists(
              ctx.db
                .select({ duelId: duelParticipants.duelId })
                .from(duelParticipants)
                .where(
                  and(
                    eq(duelParticipants.duelId, duels.id),
                    eq(duelParticipants.userId, userId),
                    eq(duelParticipants.completed_game_acknowledged, true),
                    eq(duels.completed, true),
                  ),
                ),
            ),
          ),
        ),
      );
  }),

  sendDuel: protectedProcedure
    .input(z.array(z.string().uuid()).min(1).max(4))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      if (input.includes(userId) || new Set(input).size !== input.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invitees must be unique users other than yourself.",
        });
      }

      const inviteeIds = input;

      if (inviteeIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You must invite at least one other player.",
        });
      }

      if (inviteeIds.length > MAX_INVITEES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Too many invitees",
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
                inArray(friendships.addresseeId, inviteeIds),
              ),
              and(
                eq(friendships.addresseeId, userId),
                inArray(friendships.requesterId, inviteeIds),
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

      const nonFriendInvitees = inviteeIds.filter((id) => !friendIds.has(id));

      if (nonFriendInvitees.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can only duel users who are your friends.",
        });
      }

      const participantIds = [userId, ...inviteeIds];

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

      const buildResponse = (
        participant: NonNullable<typeof existingParticipant>,
      ) => {
        const matchResults = participant.guesses.map((guess) =>
          calculateMatchObj(duel.word.toUpperCase(), guess.toUpperCase()),
        );

        const keyboardState = buildKeyboardState(matchResults);

        return {
          ...participant,
          matchResults,
          keyboardState,
          ...(participant.endTime ? { secretWord: duel.word.toUpperCase() } : {}),
        };
      };

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
        return buildResponse(existingParticipant);
      }

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

      return buildResponse(newParticipant);
    }),

  declineDuel: protectedProcedure
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

      const [existingParticipant] = await ctx.db
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

      await ctx.db.insert(duelParticipants).values({
        duelId: duel.id,
        userId,
        accepted: false,
      });

      const participants = await ctx.db
        .select()
        .from(duelParticipants)
        .where(eq(duelParticipants.duelId, duel.id));

      const allFinished = haveAllDuelParticipantsFinished(
        duel.participants,
        duel.initiatedBy,
        participants,
      );

      if (allFinished) {
        await ctx.db
          .update(duels)
          .set({ completed: true })
          .where(eq(duels.id, duel.id));
      }
    }),

  forfeitDuel: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const [duel] = await ctx.db.select().from(duels).where(eq(duels.id, input));
      if (!duel) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Duel not found." });
      }
      if (duel.completed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This duel has already been completed." });
      }

      const [participant] = await ctx.db
        .select()
        .from(duelParticipants)
        .where(and(eq(duelParticipants.duelId, input), eq(duelParticipants.userId, userId)));
      if (!participant || participant.accepted !== true || participant.endTime) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active duel can be forfeited." });
      }

      await ctx.db
        .update(duelParticipants)
        .set({ accepted: false, endTime: new Date(), success: false })
        .where(and(eq(duelParticipants.duelId, input), eq(duelParticipants.userId, userId)));

      const participants = await ctx.db.select().from(duelParticipants).where(eq(duelParticipants.duelId, input));
      if (haveAllDuelParticipantsFinished(duel.participants, duel.initiatedBy, participants)) {
        await ctx.db.update(duels).set({ completed: true }).where(eq(duels.id, input));
      }
    }),

  acknowledgeDuel: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [duel] = await ctx.db.select().from(duels).where(eq(duels.id, input));
      if (!duel) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Duel not found." });
      }
      if (!duel.completed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This duel is not completed yet." });
      }

      const [updated] = await ctx.db
        .update(duelParticipants)
        .set({ completed_game_acknowledged: true })
        .where(and(eq(duelParticipants.duelId, input), eq(duelParticipants.userId, ctx.user.id)))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a participant in this duel." });
      }
    }),

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

      const [duel] = await ctx.db
        .select({
          id: duels.id,
          word: duels.word,
          completed: duels.completed,
          participants: duels.participants,
          initiatedBy: duels.initiatedBy,
        })
        .from(duels)
        .where(eq(duels.id, input.duelId));

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

      if (!isValidDuelWord(normalizedGuess)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That guess is not in the duel word list.",
        });
      }

      const [participant] = await ctx.db
        .select()
        .from(duelParticipants)
        .where(
          and(
            eq(duelParticipants.duelId, input.duelId),
            eq(duelParticipants.userId, userId),
          ),
        );

      if (!participant || participant.accepted !== true) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this duel.",
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
      const isLastGuess = participant.guesses.length + 1 >= MAX_GUESSES;
      const isGameOver = isCorrect || isLastGuess;

      const updatedGuesses = [...participant.guesses, normalizedGuess];

      const [updated] = await ctx.db
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

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save guess.",
        });
      }

      const matchResults = updated.guesses.map((guess) =>
        calculateMatchObj(normalizedWord, guess),
      );

      const keyboardState = buildKeyboardState(matchResults);

      if (isGameOver) {
        const allParticipants = await ctx.db
          .select()
          .from(duelParticipants)
          .where(eq(duelParticipants.duelId, input.duelId));

        if (
          haveAllDuelParticipantsFinished(
            duel.participants,
            duel.initiatedBy,
            allParticipants,
          )
        ) {
          await ctx.db
            .update(duels)
            .set({ completed: true })
            .where(eq(duels.id, input.duelId));
        }
      }

      return {
        ...updated,
        matchResults,
        keyboardState,
        isCorrect,
        isGameOver,
        ...(isGameOver ? { secretWord: normalizedWord } : {}),
      };
    }),
});
