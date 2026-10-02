// Feature: anonymous-sign-in, Property 4: Anonymous count is correct regardless of pagination
//
// For any set of auth users partitioned into pages of arbitrary sizes,
// `countAnonymousUsers` returns a count equal to the number of users with
// `is_anonymous === true`, independent of where the page boundaries fall.
//
// Validates: Requirements 2.1
import type { SupabaseClient } from "@supabase/supabase-js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { countAnonymousUsers } from "./guest-cap";

// A minimal auth user shape: the counter only reads `is_anonymous`.
type TestUser = { is_anonymous: boolean | null | undefined };

/**
 * Build a mock service-role admin client that partitions `users` into the
 * given `pageSizes` and serves them through the `auth.admin.listUsers`
 * pagination contract that `countAnonymousUsers` relies on:
 *   - the caller starts at `page: 1` and follows `nextPage`
 *   - each call returns `{ data: { users, nextPage }, error: null }`
 *   - `nextPage` is the next 1-based page number, or `null` on the last page
 *
 * The mock deliberately ignores the caller's requested `perPage` so that the
 * page boundaries are driven entirely by the arbitrary `pageSizes` — this is
 * what makes the test exercise "arbitrary page sizes".
 */
const makePaginatedAdmin = (
	users: TestUser[],
	pageSizes: number[],
): SupabaseClient => {
	// Slice the full user set into chunks according to pageSizes. Any trailing
	// users beyond the summed page sizes form a final chunk so no user is lost.
	const chunks: TestUser[][] = [];
	let offset = 0;
	for (const size of pageSizes) {
		if (offset >= users.length) break;
		chunks.push(users.slice(offset, offset + size));
		offset += size;
	}
	if (offset < users.length) {
		chunks.push(users.slice(offset));
	}
	// Even an empty user set yields exactly one (empty) page.
	if (chunks.length === 0) {
		chunks.push([]);
	}

	const listUsers = async ({ page }: { page: number; perPage: number }) => {
		// `page` is 1-based per the Supabase admin contract.
		const index = page - 1;
		const pageUsers = chunks[index] ?? [];
		const hasNext = index + 1 < chunks.length;
		return {
			data: {
				users: pageUsers,
				nextPage: hasNext ? page + 1 : null,
			},
			error: null,
		};
	};

	return {
		auth: { admin: { listUsers } },
	} as unknown as SupabaseClient;
};

describe("countAnonymousUsers (Property 4)", () => {
	it("counts is_anonymous === true users regardless of page boundaries", async () => {
		// Users carry an `is_anonymous` that is true/false/null/undefined so the
		// strict `=== true` count is exercised against look-alike falsy values.
		const userArb = fc.record({
			is_anonymous: fc.oneof(
				fc.constant(true),
				fc.constant(false),
				fc.constant(null),
				fc.constant(undefined),
			),
		});

		await fc.assert(
			fc.asyncProperty(
				fc.array(userArb, { minLength: 0, maxLength: 50 }),
				// Arbitrary page sizes (>=1 so pagination always progresses); the
				// number and sum of sizes are independent of the user count so the
				// boundaries fall in arbitrary places.
				fc.array(fc.integer({ min: 1, max: 10 }), {
					minLength: 1,
					maxLength: 12,
				}),
				async (users, pageSizes) => {
					const admin = makePaginatedAdmin(users, pageSizes);

					const result = await countAnonymousUsers(admin);

					const expected = users.filter(
						(u) => u.is_anonymous === true,
					).length;
					expect(result).toBe(expected);
				},
			),
			{ numRuns: 100 },
		);
	});
});
