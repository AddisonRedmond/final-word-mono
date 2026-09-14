import { number, z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

const challenge = {
  challengeID: "some uuid",
  participants: ["user1", "user2", "user3"],
  word: "FLOAT",
  user1: {
    startTime: "now",
    endTime: "later",
    totalGuesses: 6,
    success: false,
    guesses: ["FOLK", "BLIND", "ALONE"],
  },
  user2: {
    startTime: "now",
    endTime: "later",
    totalGuesses: 6,
    success: false,
    guesses: ["FOLK", "BLIND", "ALONE"],
  },
};

export const friendsRouter = createTRPCRouter({
  /**
   * Returns all friendships for the current user, split into:
   *  - accepted friends
   *  - incoming pending requests (addressee = me)
   *  - outgoing pending requests (requester = me)
   */
  allDuels: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user.id;
  }),

  /**
   * Send a friend request to a user by email.
   * Looks up the addressee's profile, then inserts a pending friendship row.
   */
  sendDuel: protectedProcedure
    .input(z.array(z.string()))
    .mutation(async ({ ctx, input }) => {
      return true;
    }),

  /**
   * Accept an incoming friend request.
   * Only the addressee can accept.
   */
});
