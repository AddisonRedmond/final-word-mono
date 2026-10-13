// Profile router — user-editable profile fields.
//
// Today this is the display name: the name shown on the leaderboard and across
// the UI. A user can set a leaderboard-friendly name (or just one that isn't
// their real name) but only ONCE per year (DISPLAY_NAME.cooldownMs), enforced
// server-side against `profiles.nameChangedAt`. Names are "normal characters
// only" (DISPLAY_NAME.pattern) and run through a profanity filter, since they
// are displayed to other players.

import { TRPCError } from "@trpc/server";
import { Filter } from "bad-words";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	canChangeDisplayName,
	DISPLAY_NAME,
	nextDisplayNameChangeAt,
	profiles,
} from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import logger, { serializeError } from "@/server/logger";

// A single shared profanity filter instance (its word list is static, so one
// instance is reused across requests).
const profanityFilter = new Filter();

/**
 * Zod schema for a submitted display name: trimmed, length-bounded, and
 * "normal characters only" per the shared DISPLAY_NAME rules. The messages are
 * user-facing (surfaced by the profile form), so they read as guidance.
 */
const displayNameInput = z
	.string()
	.trim()
	.min(DISPLAY_NAME.minLength, {
		message: `Name must be at least ${DISPLAY_NAME.minLength} characters.`,
	})
	.max(DISPLAY_NAME.maxLength, {
		message: `Name must be ${DISPLAY_NAME.maxLength} characters or fewer.`,
	})
	.regex(DISPLAY_NAME.pattern, {
		message:
			"Use letters, numbers, spaces, and . _ ' - only (no emoji or symbols).",
	});

export type DisplayNameInfo = {
	/** The user's current display name, or null if unset. */
	name: string | null;
	/** When they last changed it, or null if never. */
	nameChangedAt: Date | null;
	/** Whether a change is allowed right now (cooldown elapsed / never changed). */
	canChange: boolean;
	/** When they'll next be eligible, or null if they can change now. */
	nextChangeAt: Date | null;
	/** The once-per-year cooldown in milliseconds (so the UI can explain it). */
	cooldownMs: number;
};

export const profileRouter = createTRPCRouter({
	/**
	 * The signed-in (non-guest) user's display-name state: current name, when it
	 * was last changed, and whether/when they can change it again. Drives the
	 * profile form's enabled/disabled state and the "next change" notice.
	 */
	displayNameInfo: protectedProcedure.query(
		async ({ ctx }): Promise<DisplayNameInfo> => {
			const [profile] = await ctx.db
				.select({
					name: profiles.name,
					nameChangedAt: profiles.nameChangedAt,
				})
				.from(profiles)
				.where(eq(profiles.id, ctx.user.id))
				.limit(1);

			const nameChangedAt = profile?.nameChangedAt ?? null;

			return {
				name: profile?.name ?? null,
				nameChangedAt,
				canChange: canChangeDisplayName(nameChangedAt),
				nextChangeAt: nextDisplayNameChangeAt(nameChangedAt),
				cooldownMs: DISPLAY_NAME.cooldownMs,
			};
		},
	),

	/**
	 * Change the user's display name. Enforces, in order:
	 *   1. Shape (zod): trimmed, length, normal-characters-only.
	 *   2. Profanity: rejected if the filter flags it (shown to other players).
	 *   3. Cooldown: re-read `nameChangedAt` from the DB and reject if a change
	 *      isn't allowed yet — never trusting a client-side check.
	 *
	 * On success it writes BOTH `profiles.name` (the leaderboard's source) and
	 * the Supabase `user_metadata.name` (what the client auth store reads for the
	 * navbar greeting), and stamps `nameChangedAt` to start the next cooldown.
	 * Returns the fresh DisplayNameInfo so the client can update immediately.
	 */
	updateDisplayName: protectedProcedure
		.input(z.object({ name: displayNameInput }))
		.mutation(async ({ ctx, input }): Promise<DisplayNameInfo> => {
			const userId = ctx.user.id;
			const name = input.name;

			// Profanity gate — these names are shown to other players.
			if (profanityFilter.isProfane(name)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "That name isn't allowed. Please choose another.",
				});
			}

			// Authoritative cooldown check: re-read the stored timestamp rather than
			// trusting the client. One change per DISPLAY_NAME.cooldownMs.
			const [profile] = await ctx.db
				.select({ nameChangedAt: profiles.nameChangedAt })
				.from(profiles)
				.where(eq(profiles.id, userId))
				.limit(1);

			const nameChangedAt = profile?.nameChangedAt ?? null;
			const now = new Date();

			if (!canChangeDisplayName(nameChangedAt, now)) {
				const nextAt = nextDisplayNameChangeAt(nameChangedAt, now);
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: `You can only change your name once a year. You can change it again on ${nextAt?.toLocaleDateString() ?? "later"}.`,
				});
			}

			// Persist to the leaderboard's source of truth and stamp the cooldown.
			await ctx.db
				.update(profiles)
				.set({ name, nameChangedAt: now })
				.where(eq(profiles.id, userId));

			// Mirror into Supabase auth user_metadata so the client auth store (and
			// anything else reading the session user) reflects the new name without
			// a re-login. A failure here is non-fatal: the authoritative DB write
			// already succeeded, so we log and continue rather than roll back.
			try {
				await ctx.supabase.auth.updateUser({ data: { name } });
			} catch (error) {
				logger.warn({
					event: "profile.display_name.metadata_sync_failed",
					msg: "Display name saved to profiles but user_metadata sync failed",
					userId,
					...serializeError(error),
				});
			}

			logger.info({
				event: "profile.display_name.changed",
				msg: "User changed their display name",
				userId,
			});

			return {
				name,
				nameChangedAt: now,
				canChange: canChangeDisplayName(now, now),
				nextChangeAt: nextDisplayNameChangeAt(now, now),
				cooldownMs: DISPLAY_NAME.cooldownMs,
			};
		}),
});
