import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { and, arrayContains, eq, inArray, notInArray, or } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { duelParticipants, duels, friendships } from "@/db/schema";
import type { Duel } from "@/db/schema";
import { getRandomWord } from "@/utils/duel";
import { haveAllDuelParticipantsFinished } from "@/utils/duel";

const MAX_ACTIVE_DUELS = 5;
const MAX_INVITEES = 5;

export const duelsRouter = createTRPCRouter({
  allDuels: protectedProcedure.query(async ({ ctx }) => {
    const declinedDuels = ctx.db
      .select({ duelId: duelParticipants.duelId })
      .from(duelParticipants)
      .where(
        and(
          eq(duelParticipants.userId, ctx.user.id),
          eq(duelParticipants.accepted, false),
        ),
      );

    const acknowledgedCompletedDuels = ctx.db
      .select({ duelId: duelParticipants.duelId })
      .from(duelParticipants)
      .innerJoin(duels, eq(duels.id, duelParticipants.duelId))
      .where(
        and(
          eq(duelParticipants.userId, ctx.user.id),
          eq(duelParticipants.completed_game_acknowledged, true),
          eq(duels.completed, true),
        ),
      );

    return ctx.db
      .select()
      .from(duels)
      .where(
        and(
          arrayContains(duels.participants, [ctx.user.id]),
          notInArray(duels.id, declinedDuels),
          notInArray(duels.id, acknowledgedCompletedDuels),
        ),
      );
  }),
  sendDuel: protectedProcedure
    .input(z.array(z.string().uuid()).min(1).max(4))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const inviteeIds = [...new Set(input)].filter((id) => id !== userId);

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

      const newDuel: Omit<Duel, "id"> = {
        initiatedBy: userId,
        word: getRandomWord(),
        createdAt: new Date(),
        completed: false,
        participants: participantIds,
      };

      const duel = await ctx.db.insert(duels).values(newDuel).returning();

      return duel;
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

      if (duel.completed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This duel has already been completed.",
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
        return existingParticipant;
      }

      const [participant] = await ctx.db
        .insert(duelParticipants)
        .values({
          duelId: input,
          userId,
          startTime: new Date(),
          accepted: true,
        })
        .returning();

      return participant;
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

      await ctx.db.insert(duelParticipants).values({
        duelId: duel.id,
        userId,
        accepted: false,
      });

      // Get the current participant state after recording
      // this user's decline.
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

  handleDuelGuess: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      // PATHS
      // correct guess

      // incorrect guess + no more guesses left
      
      // incorrect guess + more guesses left
    }),
});
