import { describe, expect, it } from "vitest";
import type { Snapshot } from "./broadcast-diff.ts";
import {
	type BroadcastInput,
	type DeltaEnvelope,
	type KeyframeEnvelope,
	initialReducerState,
	reduceEnvelope,
	type ReducerState,
} from "./broadcast-reducer.ts";

// Pure sequence-aware reducer tests (realtime-broadcast-scaling, task 7.1).
//
// These exercise `reduceEnvelope` structurally with the same small room/player
// fixture used by the diff/apply tests (primitive fields plus object/array
// fields standing in for Race's `lastFeedback` / BR's `revealed_letters`). The
// reducer is mode-agnostic, so one structural fixture covers both modes.

type TestRoom = {
	phase: string;
	round: number;
	winnerId?: string;
};

type TestPlayer = {
	name: string;
	completed: number;
	queue?: number[];
};

const snap = (
	room: TestRoom,
	players: Record<string, TestPlayer>,
): Snapshot<TestRoom, TestPlayer> => ({ room, players });

const keyframe = (
	seq: number,
	room: TestRoom,
	players: Record<string, TestPlayer>,
): KeyframeEnvelope<TestRoom, TestPlayer> => ({
	seq,
	type: "keyframe",
	room,
	players,
});

const delta = (
	seq: number,
	body: Omit<DeltaEnvelope<TestRoom, TestPlayer>, "seq" | "type">,
): DeltaEnvelope<TestRoom, TestPlayer> => ({ seq, type: "delta", ...body });

// A state that already holds a keyframe at baseSeq, ready to receive deltas.
const stateAt = (
	baseSeq: number,
	snapshot: Snapshot<TestRoom, TestPlayer>,
	resyncInFlight = false,
): ReducerState<TestRoom, TestPlayer> => ({
	snapshot,
	baseSeq,
	resyncInFlight,
});

describe("initialReducerState", () => {
	it("starts with no snapshot, base 0, and no resync in flight", () => {
		const s = initialReducerState<TestRoom, TestPlayer>();
		expect(s.snapshot).toBeUndefined();
		expect(s.baseSeq).toBe(0);
		expect(s.resyncInFlight).toBe(false);
	});
});

describe("reduceEnvelope — keyframe", () => {
	it("replaces the snapshot and rebases baseSeq to the keyframe seq", () => {
		const start = initialReducerState<TestRoom, TestPlayer>();
		const kf = keyframe(1, { phase: "round", round: 1 }, {
			a: { name: "Al", completed: 0 },
		});

		const { state, effect } = reduceEnvelope(start, kf);

		expect(effect).toBe("none");
		expect(state.baseSeq).toBe(1);
		expect(state.resyncInFlight).toBe(false);
		expect(state.snapshot).toEqual(
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 0 } }),
		);
	});

	it("a keyframe over an existing snapshot replaces it wholesale", () => {
		const start = stateAt(
			5,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 3 } }),
		);
		const kf = keyframe(6, { phase: "finished", round: 2 }, {
			b: { name: "Bo", completed: 9 },
		});

		const { state } = reduceEnvelope(start, kf);

		expect(state.baseSeq).toBe(6);
		expect(state.snapshot).toEqual(
			snap({ phase: "finished", round: 2 }, { b: { name: "Bo", completed: 9 } }),
		);
	});

	it("does not mutate the input state or envelope", () => {
		const start = stateAt(
			1,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 0 } }),
		);
		const kf = keyframe(2, { phase: "round", round: 1 }, {
			a: { name: "Al", completed: 1 },
		});
		const startCopy = structuredClone(start);
		const kfCopy = structuredClone(kf);

		reduceEnvelope(start, kf);

		expect(start).toEqual(startCopy);
		expect(kf).toEqual(kfCopy);
	});
});

describe("reduceEnvelope — in-order delta", () => {
	it("applies a delta whose seq is exactly baseSeq+1 and advances baseSeq", () => {
		const start = stateAt(
			1,
			snap({ phase: "round", round: 1 }, {
				a: { name: "Al", completed: 0 },
				b: { name: "Bo", completed: 2 },
			}),
		);
		const d = delta(2, {
			room: { phase: "finished" },
			players: { a: { name: "Al", completed: 5 } },
			removedPlayers: ["b"],
		});

		const { state, effect } = reduceEnvelope(start, d);

		expect(effect).toBe("none");
		expect(state.baseSeq).toBe(2);
		expect(state.resyncInFlight).toBe(false);
		expect(state.snapshot).toEqual(
			snap({ phase: "finished", round: 1 }, { a: { name: "Al", completed: 5 } }),
		);
	});

	it("applies a run of in-order deltas, advancing baseSeq each time", () => {
		let s = stateAt(
			1,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 0 } }),
		);

		s = reduceEnvelope(
			s,
			delta(2, { players: { a: { name: "Al", completed: 1 } } }),
		).state;
		s = reduceEnvelope(
			s,
			delta(3, { players: { a: { name: "Al", completed: 2 } } }),
		).state;

		expect(s.baseSeq).toBe(3);
		expect(s.snapshot?.players.a).toEqual({ name: "Al", completed: 2 });
	});
});

describe("reduceEnvelope — forward gap + resync (one in flight)", () => {
	it("holds last-good and requests a resync once on a forward gap", () => {
		const lastGood = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 3 },
		});
		const start = stateAt(1, lastGood);
		// seq jumps from base 1 to 3 (2 was dropped) -> gap.
		const d = delta(3, { players: { a: { name: "Al", completed: 9 } } });

		const { state, effect } = reduceEnvelope(start, d);

		expect(effect).toBe("request-resync");
		expect(state.resyncInFlight).toBe(true);
		// held: snapshot and base unchanged, delta NOT applied
		expect(state.baseSeq).toBe(1);
		expect(state.snapshot).toEqual(lastGood);
	});

	it("does NOT request again while a resync is already in flight", () => {
		const lastGood = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 3 },
		});
		const afterFirstGap = stateAt(1, lastGood, true); // resyncInFlight = true
		const secondGap = delta(5, {
			players: { a: { name: "Al", completed: 9 } },
		});

		const { state, effect } = reduceEnvelope(afterFirstGap, secondGap);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(true);
		expect(state.baseSeq).toBe(1);
		expect(state.snapshot).toEqual(lastGood);
	});

	it("the resync keyframe reply clears resyncInFlight and rebases", () => {
		const lastGood = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 3 },
		});
		const awaiting = stateAt(1, lastGood, true);
		// Server replies with a fresh keyframe at the current seq.
		const reply = keyframe(6, { phase: "round", round: 2 }, {
			a: { name: "Al", completed: 10 },
		});

		const { state, effect } = reduceEnvelope(awaiting, reply);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(false);
		expect(state.baseSeq).toBe(6);
		expect(state.snapshot).toEqual(
			snap({ phase: "round", round: 2 }, { a: { name: "Al", completed: 10 } }),
		);
	});

	it("after a keyframe rebase, the next in-order delta applies again", () => {
		const awaiting = stateAt(
			1,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 3 } }),
			true,
		);
		const rebased = reduceEnvelope(
			awaiting,
			keyframe(6, { phase: "round", round: 2 }, {
				a: { name: "Al", completed: 10 },
			}),
		).state;

		const { state, effect } = reduceEnvelope(
			rebased,
			delta(7, { players: { a: { name: "Al", completed: 11 } } }),
		);

		expect(effect).toBe("none");
		expect(state.baseSeq).toBe(7);
		expect(state.snapshot?.players.a).toEqual({ name: "Al", completed: 11 });
	});
});

describe("reduceEnvelope — stale / duplicate delta", () => {
	it("ignores a delta with seq === baseSeq (duplicate) with no resync", () => {
		const lastGood = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 3 },
		});
		const start = stateAt(4, lastGood);
		const dup = delta(4, { players: { a: { name: "Al", completed: 999 } } });

		const { state, effect } = reduceEnvelope(start, dup);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(false);
		expect(state.baseSeq).toBe(4);
		expect(state.snapshot).toEqual(lastGood); // NOT applied
	});

	it("ignores a delta with seq < baseSeq (old reorder) with no resync", () => {
		const lastGood = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 3 },
		});
		const start = stateAt(4, lastGood);
		const old = delta(2, { players: { a: { name: "Al", completed: 1 } } });

		const { state, effect } = reduceEnvelope(start, old);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(false);
		expect(state.baseSeq).toBe(4);
		expect(state.snapshot).toEqual(lastGood);
	});
});

describe("reduceEnvelope — delta before any keyframe", () => {
	it("holds (nothing to render) and requests a resync once", () => {
		const start = initialReducerState<TestRoom, TestPlayer>();
		const d = delta(2, { players: { a: { name: "Al", completed: 1 } } });

		const { state, effect } = reduceEnvelope(start, d);

		expect(effect).toBe("request-resync");
		expect(state.resyncInFlight).toBe(true);
		expect(state.snapshot).toBeUndefined(); // nothing rendered yet
		expect(state.baseSeq).toBe(0);
	});

	it("does not request a second time if one is already in flight", () => {
		const awaiting: ReducerState<TestRoom, TestPlayer> = {
			snapshot: undefined,
			baseSeq: 0,
			resyncInFlight: true,
		};
		const d = delta(3, { players: { a: { name: "Al", completed: 1 } } });

		const { state, effect } = reduceEnvelope(awaiting, d);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(true);
		expect(state.snapshot).toBeUndefined();
	});
});

describe("reduceEnvelope — flag-off bare snapshot", () => {
	it("always replaces state from a bare snapshot and never resyncs", () => {
		const start = initialReducerState<TestRoom, TestPlayer>();
		const bare: BroadcastInput<TestRoom, TestPlayer> = snap(
			{ phase: "round", round: 1 },
			{ a: { name: "Al", completed: 0 } },
		);

		const { state, effect } = reduceEnvelope(start, bare);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(false);
		expect(state.snapshot).toEqual(
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 0 } }),
		);
	});

	it("a subsequent bare snapshot replaces wholesale (no gap check)", () => {
		const first = reduceEnvelope(
			initialReducerState<TestRoom, TestPlayer>(),
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 0 } }),
		).state;

		const { state, effect } = reduceEnvelope(
			first,
			snap({ phase: "finished", round: 2 }, { b: { name: "Bo", completed: 7 } }),
		);

		expect(effect).toBe("none");
		expect(state.snapshot).toEqual(
			snap({ phase: "finished", round: 2 }, { b: { name: "Bo", completed: 7 } }),
		);
	});

	it("a bare snapshot while awaiting a resync clears resyncInFlight", () => {
		const awaiting = stateAt(
			1,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 3 } }),
			true,
		);
		const bare = snap({ phase: "round", round: 1 }, {
			a: { name: "Al", completed: 4 },
		});

		const { state, effect } = reduceEnvelope(awaiting, bare);

		expect(effect).toBe("none");
		expect(state.resyncInFlight).toBe(false);
		expect(state.snapshot?.players.a).toEqual({ name: "Al", completed: 4 });
	});
});

describe("reduceEnvelope — purity on the hold path", () => {
	it("does not mutate state or the delta when holding on a gap", () => {
		const start = stateAt(
			1,
			snap({ phase: "round", round: 1 }, { a: { name: "Al", completed: 3 } }),
		);
		const d = delta(4, { players: { a: { name: "Al", completed: 9 } } });
		const startCopy = structuredClone(start);
		const dCopy = structuredClone(d);

		reduceEnvelope(start, d);

		expect(start).toEqual(startCopy);
		expect(d).toEqual(dCopy);
	});
});
