import { describe, expect, it } from "vitest";
import {
	deepEqual,
	diffSnapshot,
	isEmptyDiff,
	type Snapshot,
} from "./broadcast-diff.ts";

// Pure trimmed-snapshot diff tests (realtime-broadcast-scaling, task 5.1).
//
// These exercise `diffSnapshot` structurally with a small room/player shape
// that mirrors the trimmed DTOs (primitive fields plus object/array fields like
// Race's `lastFeedback`/`hintRevealed` and BR's `revealed_letters`/
// `display_queue`/`attackQueueView`). The diff is mode-agnostic, so a
// representative structural fixture covers both modes.

type TestRoom = {
	phase: string;
	round: number;
	winnerId?: string;
	// object/array-valued room field to prove deep-equal avoids false changes
	meta?: Record<string, number>;
};

type TestPlayer = {
	name: string;
	completed: number;
	// object/array-valued player fields (stand in for revealed_letters,
	// display_queue, lastFeedback, attackQueueView, …)
	revealed?: Record<number, string>;
	queue?: number[];
};

const snapshot = (
	room: TestRoom,
	players: Record<string, TestPlayer>,
): Snapshot<TestRoom, TestPlayer> => ({ room, players });

const baseRoom: TestRoom = { phase: "round", round: 1, winnerId: undefined };

describe("diffSnapshot", () => {
	it("returns an empty, no-change diff when nothing changed", () => {
		const prev = snapshot(
			{ ...baseRoom },
			{ a: { name: "Al", completed: 2 } },
		);
		const next = snapshot(
			{ ...baseRoom },
			{ a: { name: "Al", completed: 2 } },
		);

		const diff = diffSnapshot(prev, next);

		expect(diff.room).toBeUndefined();
		expect(diff.players).toBeUndefined();
		expect(diff.removedPlayers).toBeUndefined();
		expect(isEmptyDiff(diff)).toBe(true);
	});

	it("includes only the changed room-level fields", () => {
		const prev = snapshot({ phase: "round", round: 1 }, {});
		const next = snapshot({ phase: "finished", round: 1 }, {});

		const diff = diffSnapshot(prev, next);

		expect(diff.room).toEqual({ phase: "finished" });
		// unchanged `round` is NOT carried
		expect(diff.room).not.toHaveProperty("round");
		expect(diff.players).toBeUndefined();
		expect(isEmptyDiff(diff)).toBe(false);
	});

	it("carries a room field that newly appears or disappears", () => {
		const prev = snapshot({ phase: "round", round: 2 }, {});
		const next = snapshot({ phase: "round", round: 2, winnerId: "a" }, {});

		const appeared = diffSnapshot(prev, next);
		expect(appeared.room).toEqual({ winnerId: "a" });

		const disappeared = diffSnapshot(next, prev);
		// going from present -> absent is carried as the new (undefined) value
		expect(disappeared.room).toHaveProperty("winnerId", undefined);
	});

	it("includes a player only when one of its fields changed", () => {
		const prev = snapshot(baseRoom, {
			a: { name: "Al", completed: 1 },
			b: { name: "Bo", completed: 3 },
		});
		const next = snapshot(baseRoom, {
			a: { name: "Al", completed: 2 }, // changed
			b: { name: "Bo", completed: 3 }, // unchanged -> omitted
		});

		const diff = diffSnapshot(prev, next);

		expect(diff.players).toBeDefined();
		expect(Object.keys(diff.players ?? {})).toEqual(["a"]);
		// the included player carries its FULL current projection
		expect(diff.players?.a).toEqual({ name: "Al", completed: 2 });
		expect(diff.removedPlayers).toBeUndefined();
	});

	it("includes a newly added player with its full projection", () => {
		const prev = snapshot(baseRoom, { a: { name: "Al", completed: 1 } });
		const next = snapshot(baseRoom, {
			a: { name: "Al", completed: 1 }, // unchanged
			b: { name: "Bo", completed: 0 }, // new
		});

		const diff = diffSnapshot(prev, next);

		expect(Object.keys(diff.players ?? {})).toEqual(["b"]);
		expect(diff.players?.b).toEqual({ name: "Bo", completed: 0 });
		expect(diff.removedPlayers).toBeUndefined();
	});

	it("lists removed players and omits them from `players`", () => {
		const prev = snapshot(baseRoom, {
			a: { name: "Al", completed: 1 },
			b: { name: "Bo", completed: 2 },
		});
		const next = snapshot(baseRoom, { a: { name: "Al", completed: 1 } });

		const diff = diffSnapshot(prev, next);

		expect(diff.removedPlayers).toEqual(["b"]);
		// `a` unchanged -> not in players
		expect(diff.players).toBeUndefined();
	});

	it("does not flag a player whose object/array fields are structurally equal", () => {
		const prev = snapshot(baseRoom, {
			a: {
				name: "Al",
				completed: 1,
				revealed: { 0: "A", 1: "L" },
				queue: [1, 2, 3],
			},
		});
		// new object/array instances with identical contents -> NO change
		const next = snapshot(baseRoom, {
			a: {
				name: "Al",
				completed: 1,
				revealed: { 0: "A", 1: "L" },
				queue: [1, 2, 3],
			},
		});

		const diff = diffSnapshot(prev, next);

		expect(diff.players).toBeUndefined();
		expect(isEmptyDiff(diff)).toBe(true);
	});

	it("flags a player when an object/array field actually changes", () => {
		const prev = snapshot(baseRoom, {
			a: { name: "Al", completed: 1, queue: [1, 2, 3] },
		});
		const next = snapshot(baseRoom, {
			a: { name: "Al", completed: 1, queue: [1, 2, 4] },
		});

		const diff = diffSnapshot(prev, next);

		expect(Object.keys(diff.players ?? {})).toEqual(["a"]);
		expect(diff.players?.a?.queue).toEqual([1, 2, 4]);
	});

	it("does not flag a room with structurally-equal object fields", () => {
		const prev = snapshot({ phase: "round", round: 1, meta: { x: 1 } }, {});
		const next = snapshot({ phase: "round", round: 1, meta: { x: 1 } }, {});

		const diff = diffSnapshot(prev, next);

		expect(isEmptyDiff(diff)).toBe(true);
	});

	it("captures multiple simultaneous changes (room + add + change + remove)", () => {
		const prev = snapshot(
			{ phase: "round", round: 1 },
			{
				a: { name: "Al", completed: 1 },
				b: { name: "Bo", completed: 2 },
				c: { name: "Cy", completed: 0 },
			},
		);
		const next = snapshot(
			{ phase: "finished", round: 1 }, // room change
			{
				a: { name: "Al", completed: 3 }, // changed
				b: { name: "Bo", completed: 2 }, // unchanged
				// c removed
				d: { name: "Di", completed: 0 }, // added
			},
		);

		const diff = diffSnapshot(prev, next);

		expect(diff.room).toEqual({ phase: "finished" });
		expect(Object.keys(diff.players ?? {}).sort()).toEqual(["a", "d"]);
		expect(diff.players?.a).toEqual({ name: "Al", completed: 3 });
		expect(diff.players?.d).toEqual({ name: "Di", completed: 0 });
		expect(diff.removedPlayers).toEqual(["c"]);
		expect(isEmptyDiff(diff)).toBe(false);
	});

	it("does not mutate its inputs", () => {
		const prev = snapshot(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 1 } },
		);
		const next = snapshot(
			{ phase: "finished", round: 1 },
			{ b: { name: "Bo", completed: 0 } },
		);
		const prevCopy = structuredClone(prev);
		const nextCopy = structuredClone(next);

		diffSnapshot(prev, next);

		expect(prev).toEqual(prevCopy);
		expect(next).toEqual(nextCopy);
	});
});

describe("deepEqual", () => {
	it("treats structurally-equal objects and arrays as equal", () => {
		expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true);
		expect(deepEqual([{ x: 1 }], [{ x: 1 }])).toBe(true);
	});

	it("distinguishes differing values, lengths, and key sets", () => {
		expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(deepEqual([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(false);
	});

	it("treats NaN as equal to itself so numeric fields don't look churny", () => {
		expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
	});

	it("distinguishes null, undefined, and primitives", () => {
		expect(deepEqual(null, undefined)).toBe(false);
		expect(deepEqual(null, {})).toBe(false);
		expect(deepEqual(0, false)).toBe(false);
	});
});

describe("isEmptyDiff", () => {
	it("is true only when every delta field is absent", () => {
		expect(isEmptyDiff({})).toBe(true);
		expect(isEmptyDiff({ room: { phase: "x" } })).toBe(false);
		expect(isEmptyDiff({ players: { a: { name: "A" } } })).toBe(false);
		expect(isEmptyDiff({ removedPlayers: ["a"] })).toBe(false);
	});
});
