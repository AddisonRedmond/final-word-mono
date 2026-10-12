import { describe, expect, it } from "vitest";
import {
	applyDelta,
	diffSnapshot,
	type DiffResult,
	type Snapshot,
} from "./broadcast-diff.ts";

// Pure client-apply tests (realtime-broadcast-scaling, task 5.2).
//
// `applyDelta` is the client-side counterpart to `diffSnapshot`. These tests
// use the same small structural room/player fixture as the diff tests so the
// pair can be reasoned about together (primitive fields plus object/array
// fields standing in for Race's `lastFeedback` / BR's `revealed_letters` etc.).
// The apply is mode-agnostic, so one structural fixture covers both modes.

type TestRoom = {
	phase: string;
	round: number;
	winnerId?: string;
	meta?: Record<string, number>;
};

type TestPlayer = {
	name: string;
	completed: number;
	revealed?: Record<number, string>;
	queue?: number[];
};

const snapshot = (
	room: TestRoom,
	players: Record<string, TestPlayer>,
): Snapshot<TestRoom, TestPlayer> => ({ room, players });

describe("applyDelta", () => {
	it("merges only the changed room fields, leaving the rest intact", () => {
		const state = snapshot(
			{ phase: "round", round: 2, winnerId: "a" },
			{ a: { name: "Al", completed: 1 } },
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			room: { phase: "finished" },
		};

		const next = applyDelta(state, delta);

		expect(next.room).toEqual({
			phase: "finished",
			round: 2,
			winnerId: "a",
		});
		// players untouched
		expect(next.players).toEqual({ a: { name: "Al", completed: 1 } });
	});

	it("writes a room field the delta carries as undefined (present -> absent)", () => {
		const state = snapshot({ phase: "round", round: 2, winnerId: "a" }, {});
		const delta: DiffResult<TestRoom, TestPlayer> = {
			room: { winnerId: undefined },
		};

		const next = applyDelta(state, delta);

		expect(next.room).toHaveProperty("winnerId", undefined);
		expect(next.room.phase).toBe("round");
	});

	it("adds a newly-joined player from the delta", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 1 } },
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			players: { b: { name: "Bo", completed: 0 } },
		};

		const next = applyDelta(state, delta);

		expect(Object.keys(next.players).sort()).toEqual(["a", "b"]);
		expect(next.players.b).toEqual({ name: "Bo", completed: 0 });
		// existing player unchanged
		expect(next.players.a).toEqual({ name: "Al", completed: 1 });
	});

	it("replaces a changed player with the delta's full projection", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 1, queue: [1, 2] } },
		);
		// diff carries the player's full current projection
		const delta: DiffResult<TestRoom, TestPlayer> = {
			players: { a: { name: "Al", completed: 4, queue: [1, 2, 3] } },
		};

		const next = applyDelta(state, delta);

		expect(next.players.a).toEqual({
			name: "Al",
			completed: 4,
			queue: [1, 2, 3],
		});
	});

	it("deletes every id in removedPlayers from the players map", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{
				a: { name: "Al", completed: 1 },
				b: { name: "Bo", completed: 2 },
				c: { name: "Cy", completed: 3 },
			},
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			removedPlayers: ["b", "c"],
		};

		const next = applyDelta(state, delta);

		expect(Object.keys(next.players)).toEqual(["a"]);
		expect(next.players.a).toEqual({ name: "Al", completed: 1 });
	});

	it("applies a combined delta: room change + add + change + remove", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{
				a: { name: "Al", completed: 1 },
				b: { name: "Bo", completed: 2 },
				c: { name: "Cy", completed: 0 },
			},
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			room: { phase: "finished" },
			players: {
				a: { name: "Al", completed: 3 }, // changed
				d: { name: "Di", completed: 0 }, // added
			},
			removedPlayers: ["c"],
		};

		const next = applyDelta(state, delta);

		expect(next.room).toEqual({ phase: "finished", round: 1 });
		expect(Object.keys(next.players).sort()).toEqual(["a", "b", "d"]);
		expect(next.players.a).toEqual({ name: "Al", completed: 3 });
		expect(next.players.b).toEqual({ name: "Bo", completed: 2 }); // untouched
		expect(next.players.d).toEqual({ name: "Di", completed: 0 });
		expect(next.players).not.toHaveProperty("c");
	});

	it("removes an id that appears in both players and removedPlayers", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 1 } },
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			players: { a: { name: "Al", completed: 2 } },
			removedPlayers: ["a"],
		};

		const next = applyDelta(state, delta);

		// removal applied after merge -> the id ends up gone
		expect(next.players).not.toHaveProperty("a");
	});

	it("applying an empty delta is a no-op (deep-equals the input state)", () => {
		const state = snapshot(
			{ phase: "round", round: 1, meta: { x: 1 } },
			{
				a: { name: "Al", completed: 1, revealed: { 0: "A" } },
				b: { name: "Bo", completed: 2, queue: [1, 2] },
			},
		);

		const next = applyDelta(state, {});

		expect(next).toEqual(state);
	});

	it("does not mutate the input state or delta", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{
				a: { name: "Al", completed: 1 },
				c: { name: "Cy", completed: 0 },
			},
		);
		const delta: DiffResult<TestRoom, TestPlayer> = {
			room: { phase: "finished" },
			players: { b: { name: "Bo", completed: 0 } },
			removedPlayers: ["c"],
		};
		const stateCopy = structuredClone(state);
		const deltaCopy = structuredClone(delta);

		applyDelta(state, delta);

		expect(state).toEqual(stateCopy);
		expect(delta).toEqual(deltaCopy);
	});

	it("returns a fresh snapshot sharing no reference with the input", () => {
		const state = snapshot(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 1 } },
		);

		const next = applyDelta(state, {});

		expect(next).not.toBe(state);
		expect(next.room).not.toBe(state.room);
		expect(next.players).not.toBe(state.players);
	});

	it("round-trips with diffSnapshot: apply(prev, diff(prev, next)) deep-equals next", () => {
		const prev = snapshot(
			{ phase: "round", round: 1, winnerId: "x" },
			{
				a: { name: "Al", completed: 1, queue: [1] },
				b: { name: "Bo", completed: 2 },
				c: { name: "Cy", completed: 0 },
			},
		);
		const next = snapshot(
			{ phase: "finished", round: 1, winnerId: undefined }, // room changed
			{
				a: { name: "Al", completed: 5, queue: [1, 2] }, // changed
				b: { name: "Bo", completed: 2 }, // unchanged
				// c removed
				d: { name: "Di", completed: 0 }, // added
			},
		);

		const rebuilt = applyDelta(prev, diffSnapshot(prev, next));

		expect(rebuilt).toEqual(next);
	});
});
