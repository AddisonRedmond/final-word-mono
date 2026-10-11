// Feature: retention-foundation, Task 4.5 — rematch eligibility rejection paths.
//
// `duels.rematchDuel` re-runs a completed duel the caller took part in, held to
// the SAME creation rules as `sendDuel` (R5.3): the source must exist, be
// completed, and include the caller; it must have other participants; and the
// invitee cap, active-duel cap, and friends-only rule all apply with tier-aware
// messages (R5.4, R5.7). This suite drives the real resolver through
// `createCaller` and asserts every rejection branch rejects BEFORE any duel is
// created.
//
// A programmable db stub returns a queued result set keyed by the table each
// `select(...).from(table)` reads, matching the resolver's sequential reads:
//   - `.from(duels)`            -> the source duel lookup
//   - `.from(profiles)`         -> the caller's premium entitlement
//   - `.from(duelParticipants)` -> the caller's active (incomplete) duels
//   - `.from(friendships)`      -> the caller's accepted friendships
// `ctx.db.transaction` throws if ever reached, so any test that expects a
// rejection also proves no duel/secret/participant rows were written.
//
// `@/env` is stubbed so the server barrel imports without secrets; `@/db/stats`
// is stubbed so the duels module imports cleanly.
//
// Validates: Requirements 5.4

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "test",
		DATABASE_URL: "postgres://user:pass@localhost:5432/test",
		SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
		NEXT_PUBLIC_WS_URL: "ws://localhost:3001",
	},
}));

vi.mock("@/db/stats", () => ({
	upsertModeStats: vi.fn(async () => undefined),
}));

import {
	duelParticipants,
	duels,
	friendships,
	profiles,
	TIER_LIMITS,
} from "@/db/schema";
import { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;
type Context = Extract<Parameters<typeof createCaller>[0], { db: unknown }>;

const uuid = (n: number): string => {
	const hex = n.toString(16).padStart(12, "0").slice(-12);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const CALLER = uuid(1);

/** A source-duel row with just the fields the resolver reads. */
const sourceDuel = (fields: {
	id?: string;
	participants: string[];
	completed: boolean;
}) => ({
	id: fields.id ?? uuid(100),
	initiatedBy: fields.participants[0] ?? CALLER,
	createdAt: new Date(),
	completed: fields.completed,
	winner: null,
	participants: fields.participants,
	rematchOfDuelId: null,
});

/** An accepted-friendship row from the caller to `other`. */
const friendship = (other: string) => ({
	requesterId: CALLER,
	addresseeId: other,
	status: "accepted",
});

/**
 * A programmable, drizzle-ish `ctx.db`. `select(...).from(table)` resolves to a
 * queued result set keyed by `table`. `transaction` throws if reached, so a
 * rejection test also proves nothing was written.
 */
const makeDb = (results: {
	duels?: unknown[];
	profiles?: unknown[];
	duelParticipants?: unknown[];
	friendships?: unknown[];
}): { db: Context["db"]; txReached: () => boolean } => {
	const state = { tx: false };

	const tableFor = (table: unknown): unknown[] => {
		if (table === duels) return results.duels ?? [];
		if (table === profiles) return results.profiles ?? [];
		if (table === duelParticipants) return results.duelParticipants ?? [];
		if (table === friendships) return results.friendships ?? [];
		return [];
	};

	const chainFor = (rows: unknown[]): unknown => {
		const chain: Record<string | symbol, unknown> = {};
		const proxy: unknown = new Proxy(chain, {
			get(_t, prop) {
				if (prop === "then") {
					return (resolve: (v: unknown[]) => unknown) => resolve(rows);
				}
				return () => proxy;
			},
		});
		return proxy;
	};

	const db = {
		select: (_projection?: unknown) => ({
			from: (table: unknown) => chainFor(tableFor(table)),
		}),
		transaction: async () => {
			state.tx = true;
			throw new Error(
				"transaction reached — a rejected rematch must not create a duel",
			);
		},
	};
	return { db: db as unknown as Context["db"], txReached: () => state.tx };
};

const buildContext = (db: Context["db"], userId = CALLER): Context =>
	({
		db,
		supabase: null,
		user: { id: userId, is_anonymous: false },
	}) as unknown as Context;

/** A free-tier profile row (no premium), the default for these tests. */
const freeProfile = [{ premiumStatus: null, premiumUntil: null }];

describe("duels.rematchDuel — eligibility rejection paths (R5.4, R5.7)", () => {
	let db: ReturnType<typeof makeDb>;

	const callRematch = (sourceDuelId = uuid(100)) =>
		createCaller(buildContext(db.db)).duels.rematchDuel({ sourceDuelId });

	beforeEach(() => {
		db = makeDb({});
	});

	it("rejects NOT_FOUND when the source duel does not exist", async () => {
		db = makeDb({ duels: [] });
		await expect(callRematch()).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(callRematch()).rejects.toBeInstanceOf(TRPCError);
		expect(db.txReached()).toBe(false);
	});

	it("rejects FORBIDDEN when the caller was not a participant of the source", async () => {
		db = makeDb({
			duels: [
				sourceDuel({
					participants: [uuid(2), uuid(3)], // caller not included
					completed: true,
				}),
			],
		});
		await expect(callRematch()).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(db.txReached()).toBe(false);
	});

	it("rejects BAD_REQUEST when the source duel is not completed", async () => {
		db = makeDb({
			duels: [
				sourceDuel({ participants: [CALLER, uuid(2)], completed: false }),
			],
		});
		await expect(callRematch()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("completed"),
		});
		expect(db.txReached()).toBe(false);
	});

	it("rejects BAD_REQUEST when the source has no other participants", async () => {
		// A degenerate completed duel whose only participant is the caller: there
		// is nobody to re-challenge.
		db = makeDb({
			duels: [sourceDuel({ participants: [CALLER], completed: true })],
		});
		await expect(callRematch()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("no other participants"),
		});
		expect(db.txReached()).toBe(false);
	});

	it("rejects when the invitee count exceeds the caller's (free) tier cap", async () => {
		// Free cap is 2 invitees; a completed duel with 3 opponents exceeds it.
		const opponents = [uuid(2), uuid(3), uuid(4)];
		expect(opponents.length).toBeGreaterThan(TIER_LIMITS.free.duelInvitees);

		db = makeDb({
			duels: [
				sourceDuel({ participants: [CALLER, ...opponents], completed: true }),
			],
			profiles: freeProfile,
		});

		await expect(callRematch()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			// Tier-aware message points a free user at the premium ceiling.
			message: expect.stringContaining("Free accounts can invite"),
		});
		expect(db.txReached()).toBe(false);
	});

	it("rejects when the caller is already at their active-duel cap", async () => {
		const opponent = uuid(2);
		// Free active-duel cap is 2; report exactly that many in-progress duels.
		const activeRows = Array.from(
			{ length: TIER_LIMITS.free.activeDuels },
			(_v, i) => ({ duelId: uuid(500 + i) }),
		);

		db = makeDb({
			duels: [
				sourceDuel({ participants: [CALLER, opponent], completed: true }),
			],
			profiles: freeProfile,
			duelParticipants: activeRows,
		});

		await expect(callRematch()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("active duels"),
		});
		expect(db.txReached()).toBe(false);
	});

	it("rejects when an invitee is no longer a friend (never silently drops them)", async () => {
		const stillFriend = uuid(2);
		const notFriend = uuid(3);

		db = makeDb({
			duels: [
				sourceDuel({
					participants: [CALLER, stillFriend, notFriend],
					completed: true,
				}),
			],
			profiles: freeProfile,
			duelParticipants: [], // under the active cap
			// Only one of the two opponents is still an accepted friend.
			friendships: [friendship(stillFriend)],
		});

		await expect(callRematch()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("still your friends"),
		});
		expect(db.txReached()).toBe(false);
	});

	it("passes every eligibility gate and proceeds to create the rematch", async () => {
		// A completed 1v1 the caller played, under both caps, opponent still a
		// friend: all gates pass, so the resolver advances to the creation
		// transaction. Our stub's transaction throws a SENTINEL — reaching it
		// proves the rejection gates were all cleared (we don't model the full
		// insert here; creation is covered by the completion/pipeline tests).
		const opponent = uuid(2);
		db = makeDb({
			duels: [
				sourceDuel({ participants: [CALLER, opponent], completed: true }),
			],
			profiles: freeProfile,
			duelParticipants: [],
			friendships: [friendship(opponent)],
		});

		await expect(callRematch()).rejects.toThrow(/transaction reached/);
		// The sentinel fired: control passed ALL eligibility checks.
		expect(db.txReached()).toBe(true);
	});
});
