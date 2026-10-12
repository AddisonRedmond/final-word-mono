import { describe, expect, it } from "vitest";
import {
	type BroadcastVersionState,
	type Snapshot,
	stampDelta,
	stampKeyframe,
} from "./broadcast-emit.ts";

// Pure keyframe-stamp tests (realtime-broadcast-scaling, task 6.1).
//
// `stampKeyframe` is mode-agnostic, so a small structural room/player fixture
// standing in for the trimmed DTOs covers both Race and Battle Royale. These
// assert the three stamp invariants the emitters and the client reducer rely
// on: a monotonically increasing `seq`, `ticksSinceKeyframe` reset to 0, and
// `lastSent` holding the just-built snapshot.

type TestRoom = { phase: string; round: number };
type TestPlayer = { name: string; completed: number };

const snapshot = (
	room: TestRoom,
	players: Record<string, TestPlayer>,
): Snapshot<TestRoom, TestPlayer> => ({ room, players });

const sample = snapshot(
	{ phase: "round", round: 1 },
	{ p1: { name: "A", completed: 2 }, p2: { name: "B", completed: 0 } },
);

describe("stampKeyframe (task 6.1)", () => {
	it("stamps the first keyframe at seq 1 when no version exists yet", () => {
		const { envelope, version } = stampKeyframe(undefined, sample);

		expect(envelope.type).toBe("keyframe");
		expect(envelope.seq).toBe(1);
		expect(version.seq).toBe(1);
	});

	it("carries the FULL snapshot (room + all players) in the keyframe", () => {
		const { envelope } = stampKeyframe(undefined, sample);

		expect(envelope.room).toEqual(sample.room);
		expect(envelope.players).toEqual(sample.players);
	});

	it("resets ticksSinceKeyframe to 0 and stores lastSent = the snapshot", () => {
		const prior: BroadcastVersionState<TestRoom, TestPlayer> = {
			seq: 7,
			ticksSinceKeyframe: 13,
			lastSent: snapshot({ phase: "lobby", round: 0 }, {}),
		};

		const { version } = stampKeyframe(prior, sample);

		expect(version.ticksSinceKeyframe).toBe(0);
		expect(version.lastSent).toEqual(sample);
	});

	it("INCREMENTS seq by exactly one from the previous version (monotonic)", () => {
		const prior: BroadcastVersionState<TestRoom, TestPlayer> = {
			seq: 41,
			ticksSinceKeyframe: 5,
		};

		const { envelope, version } = stampKeyframe(prior, sample);

		expect(envelope.seq).toBe(42);
		expect(version.seq).toBe(42);
	});

	it("does NOT mutate the previous version record or the snapshot", () => {
		const prior: BroadcastVersionState<TestRoom, TestPlayer> = {
			seq: 2,
			ticksSinceKeyframe: 9,
		};
		const priorCopy = { ...prior };
		const roomBefore = { ...sample.room };

		stampKeyframe(prior, sample);

		expect(prior).toEqual(priorCopy);
		expect(sample.room).toEqual(roomBefore);
	});

	it("keeps the +1 cadence across repeated keyframes (feeds the client reducer)", () => {
		let version: BroadcastVersionState<TestRoom, TestPlayer> | undefined;
		const seqs: number[] = [];

		for (let i = 0; i < 4; i++) {
			const stamped = stampKeyframe(version, sample);
			version = stamped.version;
			seqs.push(stamped.envelope.seq);
		}

		expect(seqs).toEqual([1, 2, 3, 4]);
	});
});

// Pure delta-stamp tests (realtime-broadcast-scaling, task 6.2).
//
// `stampDelta` diffs the room's `lastSent` snapshot against the just-built one
// and either SKIPS (empty diff → version unchanged, no envelope, Req 3.8) or
// returns a `type: "delta"` envelope carrying only the changes with the version
// advanced (seq+1, ticksSinceKeyframe+1, lastSent updated). Like
// `stampKeyframe` it is mode-agnostic, so the same structural fixture covers
// both Race and Battle Royale.

describe("stampDelta (task 6.2)", () => {
	const base = (
		over: Partial<BroadcastVersionState<TestRoom, TestPlayer>> = {},
	): BroadcastVersionState<TestRoom, TestPlayer> => ({
		seq: 1,
		ticksSinceKeyframe: 0,
		lastSent: sample,
		...over,
	});

	it("SKIPS when nothing changed since lastSent (empty diff, Req 3.8)", () => {
		// Same values as `sample` but a fresh object, so only a deep diff — not
		// reference equality — can tell they are unchanged.
		const unchanged = snapshot(
			{ phase: "round", round: 1 },
			{ p1: { name: "A", completed: 2 }, p2: { name: "B", completed: 0 } },
		);

		const result = stampDelta(base(), unchanged);

		expect(result.skip).toBe(true);
		// A skip carries no envelope and no advanced version.
		expect(result).toEqual({ skip: true });
	});

	it("does NOT advance seq / ticks on a skipped empty tick (Req 3.8)", () => {
		const version = base({ seq: 5, ticksSinceKeyframe: 3 });
		const versionCopy = { ...version };

		const result = stampDelta(version, sample);

		expect(result.skip).toBe(true);
		// The caller leaves the stored version untouched; stampDelta must not
		// have mutated it either.
		expect(version).toEqual(versionCopy);
	});

	it("stamps a delta with seq prev+1 and type 'delta' when a room field changed", () => {
		const next = snapshot(
			{ phase: "intermission", round: 1 }, // phase changed
			{ p1: { name: "A", completed: 2 }, p2: { name: "B", completed: 0 } },
		);

		const result = stampDelta(base({ seq: 7, ticksSinceKeyframe: 2 }), next);

		expect(result.skip).toBe(false);
		if (result.skip) return; // narrow for TS
		expect(result.envelope.type).toBe("delta");
		expect(result.envelope.seq).toBe(8);
		// Only the changed room field travels; players did not change so they
		// are omitted entirely.
		expect(result.envelope.room).toEqual({ phase: "intermission" });
		expect(result.envelope.players).toBeUndefined();
	});

	it("carries only the changed/added players in the delta", () => {
		const next = snapshot(
			{ phase: "round", round: 1 },
			{
				p1: { name: "A", completed: 5 }, // changed
				p2: { name: "B", completed: 0 }, // unchanged → omitted
				p3: { name: "C", completed: 1 }, // added
			},
		);

		const result = stampDelta(base(), next);

		expect(result.skip).toBe(false);
		if (result.skip) return;
		expect(Object.keys(result.envelope.players ?? {}).sort()).toEqual([
			"p1",
			"p3",
		]);
		expect(result.envelope.players?.p1).toEqual({ name: "A", completed: 5 });
		expect(result.envelope.players?.p3).toEqual({ name: "C", completed: 1 });
	});

	it("carries removedPlayers for players no longer present", () => {
		const next = snapshot(
			{ phase: "round", round: 1 },
			{ p1: { name: "A", completed: 2 } }, // p2 removed
		);

		const result = stampDelta(base(), next);

		expect(result.skip).toBe(false);
		if (result.skip) return;
		expect(result.envelope.removedPlayers).toEqual(["p2"]);
	});

	it("advances the version: seq+1, ticksSinceKeyframe+1, lastSent = new snapshot", () => {
		const next = snapshot(
			{ phase: "round", round: 2 }, // round changed
			{ p1: { name: "A", completed: 2 }, p2: { name: "B", completed: 0 } },
		);

		const result = stampDelta(base({ seq: 4, ticksSinceKeyframe: 6 }), next);

		expect(result.skip).toBe(false);
		if (result.skip) return;
		expect(result.version.seq).toBe(5);
		expect(result.version.ticksSinceKeyframe).toBe(7);
		expect(result.version.lastSent).toEqual(next);
	});

	it("does NOT mutate the previous version or the snapshot", () => {
		const version = base({ seq: 2, ticksSinceKeyframe: 1 });
		const versionCopy = {
			...version,
			lastSent: version.lastSent,
		};
		const next = snapshot(
			{ phase: "intermission", round: 1 },
			{ p1: { name: "A", completed: 2 }, p2: { name: "B", completed: 0 } },
		);
		const nextRoomBefore = { ...next.room };

		stampDelta(version, next);

		expect(version.seq).toBe(versionCopy.seq);
		expect(version.ticksSinceKeyframe).toBe(versionCopy.ticksSinceKeyframe);
		expect(version.lastSent).toBe(versionCopy.lastSent);
		expect(next.room).toEqual(nextRoomBefore);
	});

	it("stamps sequential seqs across a keyframe-then-deltas chain", () => {
		// Keyframe establishes seq 1 + lastSent, then two changed ticks stamp
		// seq 2 and seq 3 — the +1 cadence the client reducer checks.
		let { version } = stampKeyframe(undefined, sample);
		expect(version.seq).toBe(1);

		const changedA = snapshot(
			{ phase: "intermission", round: 1 },
			sample.players,
		);
		const stampA = stampDelta(version, changedA);
		expect(stampA.skip).toBe(false);
		if (stampA.skip) return;
		expect(stampA.envelope.seq).toBe(2);
		version = stampA.version;

		const changedB = snapshot({ phase: "round", round: 2 }, sample.players);
		const stampB = stampDelta(version, changedB);
		expect(stampB.skip).toBe(false);
		if (stampB.skip) return;
		expect(stampB.envelope.seq).toBe(3);
	});
});
