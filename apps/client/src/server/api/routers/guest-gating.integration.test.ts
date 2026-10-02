// Feature: anonymous-sign-in
//
// Integration test for the `guestProtectedProcedure` gate on the duels and
// friends routers (Task 12.3).
//
// Requirement 7.1/7.2 demand that when a GUEST (`is_anonymous === true`) invokes
// a duels or friends procedure, the request is rejected with an authorization
// error AND no persisted duel/friends state is read or written. The gate lives
// in `guestProtectedProcedure`, which runs BEFORE any resolver — so for a guest
// the resolver body (the only place `ctx.db` is touched) must never execute.
//
// We prove "zero DB access" structurally: the guest context is given a `ctx.db`
// that is a Proxy which THROWS on any property access and records that it was
// touched. If the guard let the resolver run, the resolver's first `ctx.db.*`
// call would throw a DB-touch error instead of the FORBIDDEN TRPCError — so the
// assertions below (FORBIDDEN thrown, db never touched) can only both hold when
// the gate short-circuits ahead of the DB.
//
// Requirement 7.6: a REGISTERED user (`is_anonymous === false`) passes the gate
// and the resolver runs — reaching the DB and returning an observable success.
// We give that user a chainable mock `ctx.db` whose read resolves to an empty
// result set, and assert the call resolves (guard passed, db consulted).
//
// Validates: Requirements 7.1, 7.2, 7.6

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock `@/env` so importing the server barrel (db + env validation) does not
// require real runtime secrets or a live database connection.
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

// Imported after the mock is registered so the routers bind to the stub env.
import { createCaller } from "@/server/api/root";

type Caller = ReturnType<typeof createCaller>;
// `createCaller` accepts the context object or a factory returning it; narrow to
// the object member so `Context["db"]` resolves to the drizzle db field.
type Context = Extract<Parameters<typeof createCaller>[0], { db: unknown }>;

const GUEST_ID = "11111111-1111-4111-8111-111111111111";
const REGISTERED_ID = "22222222-2222-4222-8222-222222222222";

/**
 * A `ctx.db` that must never be touched. Any property access flips `touched`
 * and throws — so if a resolver body runs for a guest, the failure surfaces as
 * this DB-touch error rather than the FORBIDDEN authorization error, failing the
 * test. This is the structural proof of "no persisted state read or written".
 */
function createForbiddenDb(): { db: Context["db"]; wasTouched: () => boolean } {
	const state = { touched: false };
	const trap = (): never => {
		state.touched = true;
		throw new Error(
			"DB was touched for a guest — the gate must reject before any DB access",
		);
	};
	const proxy = new Proxy(
		{},
		{
			get: trap,
			apply: trap,
			has: trap,
		},
		// biome-ignore lint/suspicious/noExplicitAny: structural spy stands in for the drizzle db
	) as any;
	return { db: proxy as Context["db"], wasTouched: () => state.touched };
}

/**
 * A chainable drizzle-ish `ctx.db` for the registered-user path. Every builder
 * method (`select`, `from`, `where`, `leftJoin`, ...) returns the same chain,
 * and the chain is awaitable, resolving to an empty result set — enough for the
 * read-only resolvers (`friends.list`, `duels.allDuels`) to complete. `touched`
 * records that the resolver actually consulted the db (guard passed).
 */
function createReadDb(): { db: Context["db"]; wasTouched: () => boolean } {
	const state = { touched: false };
	const chain: Record<string | symbol, unknown> = {};
	const proxy: unknown = new Proxy(chain, {
		get(_target, prop) {
			state.touched = true;
			// Make the chain awaitable: `await db.select()...` resolves to [].
			if (prop === "then") {
				return (resolve: (value: unknown[]) => unknown) => resolve([]);
			}
			// Any builder method (select/from/where/leftJoin/...) returns the same
			// awaitable chain proxy, so arbitrarily long builder chains resolve.
			return () => proxy;
		},
	});
	// biome-ignore lint/suspicious/noExplicitAny: structural stub stands in for the drizzle db
	return { db: proxy as any, wasTouched: () => state.touched };
}

const buildContext = (
	db: Context["db"],
	user: { id: string; is_anonymous: boolean } | null,
): Context =>
	({
		db,
		// The gate/resolvers never read `ctx.supabase`; a null stub is sufficient
		// and the whole literal is cast to the context shape for typing only.
		supabase: null,
		user,
	}) as unknown as Context;

describe("guestProtectedProcedure gating on duels + friends (Task 12.3)", () => {
	let forbidden: ReturnType<typeof createForbiddenDb>;
	let read: ReturnType<typeof createReadDb>;

	beforeEach(() => {
		forbidden = createForbiddenDb();
		read = createReadDb();
	});

	describe("guest (is_anonymous === true) — rejected before any DB access", () => {
		it("rejects duels.allDuels with FORBIDDEN and never touches the db (R7.1)", async () => {
			const caller: Caller = createCaller(
				buildContext(forbidden.db, { id: GUEST_ID, is_anonymous: true }),
			);

			await expect(caller.duels.allDuels()).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(caller.duels.allDuels()).rejects.toBeInstanceOf(TRPCError);

			expect(forbidden.wasTouched()).toBe(false);
		});

		it("rejects friends.list with FORBIDDEN and never touches the db (R7.2)", async () => {
			const caller: Caller = createCaller(
				buildContext(forbidden.db, { id: GUEST_ID, is_anonymous: true }),
			);

			await expect(caller.friends.list()).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(caller.friends.list()).rejects.toBeInstanceOf(TRPCError);

			expect(forbidden.wasTouched()).toBe(false);
		});

		it("rejects a duels MUTATION (sendDuel) before any DB write (R7.1)", async () => {
			const caller: Caller = createCaller(
				buildContext(forbidden.db, { id: GUEST_ID, is_anonymous: true }),
			);

			await expect(
				caller.duels.sendDuel(["33333333-3333-4333-8333-333333333333"]),
			).rejects.toMatchObject({ code: "FORBIDDEN" });

			expect(forbidden.wasTouched()).toBe(false);
		});

		it("rejects a friends MUTATION (sendRequest) before any DB write (R7.2)", async () => {
			const caller: Caller = createCaller(
				buildContext(forbidden.db, { id: GUEST_ID, is_anonymous: true }),
			);

			await expect(
				caller.friends.sendRequest({ email: "someone@example.com" }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });

			expect(forbidden.wasTouched()).toBe(false);
		});
	});

	describe("registered user (is_anonymous === false) — guard passes, resolver runs (R7.6)", () => {
		it("duels.allDuels executes, reaches the db, and returns an observable success", async () => {
			const caller: Caller = createCaller(
				buildContext(read.db, { id: REGISTERED_ID, is_anonymous: false }),
			);

			const result = await caller.duels.allDuels();

			// Guard passed (no throw), resolver consulted the db, and we got a
			// concrete result back.
			expect(read.wasTouched()).toBe(true);
			expect(result).toEqual([]);
		});

		it("friends.list executes, reaches the db, and returns an observable success", async () => {
			const caller: Caller = createCaller(
				buildContext(read.db, { id: REGISTERED_ID, is_anonymous: false }),
			);

			const result = await caller.friends.list();

			expect(read.wasTouched()).toBe(true);
			expect(result).toEqual([]);
		});
	});
});
