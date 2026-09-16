import { number, z } from "zod";

import { TRPCError } from "@trpc/server";
import { and, arrayContains, eq, inArray, or } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { duelParticipants, duels, friendships } from "@/db/schema";
import type { Duel } from "@/db/schema";
import { getRandomWord } from "@/utils/duel";

const MAX_ACTIVE_DUELS = 5;
const MAX_INVITEES = 5;
const challenge = {
  challengeID: "some uuid",
  participants: ["user1", "user2", "user3"],
  word: "FLOAT",
  completed: false,
  user1: {
    startTime: "now",
    endTime: "later",
    totalGuesses: 6,
    success: false,
    guesses: ["FOLK", "BLIND", "ALONE"],
    accepted: true,
  },
  user2: {
    startTime: "now",
    endTime: "later",
    totalGuesses: 6,
    success: false,
    guesses: ["FOLK", "BLIND", "ALONE"],
    accepted: true,
  },
};

export const duelsRouter = createTRPCRouter({
  /**
   * Returns all friendships for the current user, split into:
   *  - accepted friends
   *  - incoming pending requests (addressee = me)
   *  - outgoing pending requests (requester = me)
   */
  allDuels: protectedProcedure.query(async ({ ctx }) => {
    // duel_participants table has realtime enabled
    // I want the
    return ctx.db
      .select()
      .from(duels)
      .where(
        and(
          arrayContains(duels.participants, [ctx.user.id]),
          eq(duels.completed, false),
        ),
      );
  }),

  /**
   * Send a friend request to a user by email.
   * Looks up the addressee's profile, then inserts a pending friendship row.
   */
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

      // Make sure user doesn't have 5 or more active games currently
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

      // check and make sure all invitees are friends with ctx.user
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
        acceptedFriendships.map((f) =>
          f.requesterId === userId ? f.addresseeId : f.requesterId,
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
      // if they are, create a new duel and save it to duel,
      const newDuel: Omit<Duel, "id"> = {
        initiatedBy: userId,
        word: getRandomWord(),
        createdAt: new Date(),
        completed: false,
        participants: participantIds,
      };

      // dont create individual user game info yet, when the user starts their game then it should be created

      // try catch
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Duel not found." });
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
        })
        .returning();

      return participant;
    }),

  handleDuelGuess: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {}),
});
