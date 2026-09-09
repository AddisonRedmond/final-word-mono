import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { friendships, profiles } from "db/schema";

export const friendsRouter = createTRPCRouter({
  /**
   * Returns all friendships for the current user, split into:
   *  - accepted friends
   *  - incoming pending requests (addressee = me)
   *  - outgoing pending requests (requester = me)
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rows = await ctx.db
      .select({
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
        requesterEmail: profiles.email,
        requesterName: profiles.name,
      })
      .from(friendships)
      .leftJoin(profiles, eq(profiles.id, friendships.requesterId))
      .where(
        or(
          eq(friendships.requesterId, userId),
          eq(friendships.addresseeId, userId),
        ),
      );

    // For each row, resolve the "other" user's profile
    const otherIds = rows.map((r) =>
      r.requesterId === userId ? r.addresseeId : r.requesterId,
    );

    const otherProfiles =
      otherIds.length > 0
        ? await ctx.db
            .select()
            .from(profiles)
            .where(or(...otherIds.map((id) => eq(profiles.id, id))))
        : [];

    const profileMap = new Map(otherProfiles.map((p) => [p.id, p]));

    return rows.map((r) => {
      const isRequester = r.requesterId === userId;
      const otherId = isRequester ? r.addresseeId : r.requesterId;
      const other = profileMap.get(otherId);

      return {
        id: otherId,
        name: other?.name ?? null,
        email: other?.email ?? null,
        status:
          r.status === "accepted"
            ? ("accepted" as const)
            : isRequester
              ? ("pending_outgoing" as const)
              : ("pending_incoming" as const),
      };
    });
  }),

  /**
   * Send a friend request to a user by email.
   * Looks up the addressee's profile, then inserts a pending friendship row.
   */
  sendRequest: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const requesterId = ctx.user.id;

      const [addressee] = await ctx.db
        .select()
        .from(profiles)
        .where(eq(profiles.email, input.email))
        .limit(1);

      if (!addressee) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No user found with that email.",
        });
      }

      if (addressee.id === requesterId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot add yourself as a friend.",
        });
      }

      // Check if a relationship already exists in either direction
      const [existing] = await ctx.db
        .select()
        .from(friendships)
        .where(
          or(
            and(
              eq(friendships.requesterId, requesterId),
              eq(friendships.addresseeId, addressee.id),
            ),
            and(
              eq(friendships.requesterId, addressee.id),
              eq(friendships.addresseeId, requesterId),
            ),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            existing.status === "accepted"
              ? "You are already friends."
              : "A friend request already exists.",
        });
      }

      await ctx.db.insert(friendships).values({
        requesterId,
        addresseeId: addressee.id,
        status: "pending",
      });

      return { addresseeId: addressee.id };
    }),

  /**
   * Accept an incoming friend request.
   * Only the addressee can accept.
   */
  acceptRequest: protectedProcedure
    .input(z.object({ requesterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [row] = await ctx.db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.requesterId, input.requesterId),
            eq(friendships.addresseeId, userId),
            eq(friendships.status, "pending"),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Friend request not found.",
        });
      }

      await ctx.db
        .update(friendships)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(
          and(
            eq(friendships.requesterId, input.requesterId),
            eq(friendships.addresseeId, userId),
          ),
        );

      return { success: true };
    }),

  /**
   * Decline or cancel a pending request, or remove an accepted friend.
   * Deletes the single row regardless of direction — this guarantees
   * no one-sided friendship can remain.
   */
  remove: protectedProcedure
    .input(z.object({ otherId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      await ctx.db
        .delete(friendships)
        .where(
          or(
            and(
              eq(friendships.requesterId, userId),
              eq(friendships.addresseeId, input.otherId),
            ),
            and(
              eq(friendships.requesterId, input.otherId),
              eq(friendships.addresseeId, userId),
            ),
          ),
        );

      return { success: true };
    }),
});
