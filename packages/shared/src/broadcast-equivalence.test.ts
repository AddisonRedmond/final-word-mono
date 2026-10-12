import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	type DiffResult,
	type Snapshot,
	applyDelta,
	deepEqual,
	diffSnapshot,
	isEmptyDiff,
} from "./broadcast-diff.ts";

// Feature: realtime-broadcast-scaling, Property: equivalence invariant
// (design.md "Deltas (property tests, the core)" / tasks.md 5.3).
//
// Models the delta protocol end-to-end on a structural `{ room, players }`
// Trimmed_Snapshot (mode-agnostic, mirroring the small fixture the 5.1/5.2 diff
// and apply logic are written against). For a random sequence of authoritative
// mutations the server computes `delta = diffSnapshot(prev, next)` each step; a
// simulated client starts from the SAME keyframe and applies each NON-empty
// delta (skipping empty ones, Req 3.8). The invariant: after every step the
// client's snapshot deep-equals the server's current Trimmed_Snapshot — i.e.
// `keyframe + applyDelta*` equals the server snapshot at each seq.
//
// Validates: Requirements 3.4, 3.8, 4.6, 4.7

// --- Structural fixture ------------------------------------------------------
// A small Trimmed_Snapshot shape with the field variety the real DTOs carry:
// the room has a primitive (`phase`), a number (`roundNumber`), and an
// array-valued field (`revealed`); each player has a primitive (`name`), a
// number (`score`), and an object-valued UI field (`board`). This exercises the
// deepEqual path for object/array fields, not just primitive compares.

type Room = {
	phase: string;
	roundNumber: number;
	revealed: string[];
};

type Player = {
	name: string;
	score: number;
	board: { guesses: number; lastGuess: string };
};

type Fixture = Snapshot<Room, Player>;

// --- Generators --------------------------------------------------------------

const phaseArb = fc.constantFrom("lobby", "playing", "intermission", "result");

const boardArb = fc.record({
	guesses: fc.integer({ min: 0, max: 6 }),
	lastGuess: fc.string({ maxLength: 5 }),
});

const playerArb: fc.Arbitrary<Player> = fc.record({
	name: fc.string({ minLength: 1, maxLength: 8 }),
	score: fc.integer({ min: 0, max: 1000 }),
	board: boardArb,
});

const roomArb: fc.Arbitrary<Room> = fc.record({
	phase: phaseArb,
	roundNumber: fc.integer({ min: 0, max: 10 }),
	revealed: fc.array(fc.string({ maxLength: 1 }), { maxLength: 5 }),
});

// Player ids drawn from a small pool so adds/changes/removes actually collide
// on the same ids across a sequence (otherwise "change" and "remove" would
// almost never hit an existing player).
const idArb = fc.constantFrom("p1", "p2", "p3", "p4", "p5");

const initialSnapshotArb: fc.Arbitrary<Fixture> = fc
	.array(fc.tuple(idArb, playerArb), { maxLength: 5 })
	.chain((entries) =>
		roomArb.map((room) => {
			const players: Record<string, Player> = {};
			for (const [id, p] of entries) players[id] = p;
			return { room, players };
		}),
	);

// A mutation transforms the server's CURRENT snapshot into a new one. We cover
// all of add / change-player / change-room / remove, plus explicit NO-OP paths
// so the empty-delta skip branch (Req 3.8) is exercised: "noop" leaves the
// snapshot untouched, and "change-player-same" / "change-room-same" rewrite a
// field to its existing value (which the deep-equal diff must treat as empty).
type Mutation =
	| { kind: "add"; id: string; player: Player }
	| { kind: "change-player"; id: string; player: Player }
	| { kind: "change-player-same"; id: string }
	| { kind: "remove"; id: string }
	| { kind: "change-room"; room: Room }
	| { kind: "change-room-same" }
	| { kind: "noop" };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
	fc
		.tuple(idArb, playerArb)
		.map(([id, player]) => ({ kind: "add", id, player }) as Mutation),
	fc
		.tuple(idArb, playerArb)
		.map(
			([id, player]) => ({ kind: "change-player", id, player }) as Mutation,
		),
	idArb.map((id) => ({ kind: "change-player-same", id }) as Mutation),
	idArb.map((id) => ({ kind: "remove", id }) as Mutation),
	roomArb.map((room) => ({ kind: "change-room", room }) as Mutation),
	fc.constant({ kind: "change-room-same" } as Mutation),
	fc.constant({ kind: "noop" } as Mutation),
);

// Apply a mutation to the server's authoritative snapshot, returning a fresh
// snapshot (never mutating the input — the server itself replaces state). This
// is the independent "truth" the diff/apply round-trip is checked against.
function applyMutation(state: Fixture, m: Mutation): Fixture {
	switch (m.kind) {
		case "add":
		case "change-player":
			// Both set players[id] to a fresh projection. "add" vs "change" is
			// just whether the id already existed; a single branch covers both,
			// and the generator labels them so coverage can assert all kinds ran.
			return {
				room: state.room,
				players: { ...state.players, [m.id]: m.player },
			};
		case "change-player-same": {
			// Rewrite an existing player to a DEEP COPY of its current value: a
			// no-op in meaning, but a new reference. The deep-equal diff must
			// treat this as "no change" so the delta is empty (Req 3.8). If the
			// id is absent this is a true no-op.
			const existing = state.players[m.id];
			if (existing === undefined) return state;
			const copy: Player = {
				name: existing.name,
				score: existing.score,
				board: { ...existing.board },
			};
			return { room: state.room, players: { ...state.players, [m.id]: copy } };
		}
		case "remove": {
			if (!Object.prototype.hasOwnProperty.call(state.players, m.id)) {
				return state; // true no-op when the id isn't present
			}
			const players = { ...state.players };
			delete players[m.id];
			return { room: state.room, players };
		}
		case "change-room":
			return { room: m.room, players: state.players };
		case "change-room-same":
			// Fresh reference, structurally identical room -> empty diff.
			return {
				room: {
					phase: state.room.phase,
					roundNumber: state.room.roundNumber,
					revealed: [...state.room.revealed],
				},
				players: state.players,
			};
		case "noop":
			return state;
	}
}

describe("delta protocol equivalence invariant (broadcast-diff)", () => {
	it("keyframe + applyDelta* equals the server Trimmed_Snapshot at each seq", () => {
		fc.assert(
			fc.property(
				initialSnapshotArb,
				fc.array(mutationArb, { minLength: 1, maxLength: 20 }),
				(initial, mutations) => {
					// Keyframe: client and server both start from the same base.
					let serverState: Fixture = initial;
					let clientState: Fixture = initial;

					for (const mutation of mutations) {
						const prevServer = serverState;
						const nextServer = applyMutation(prevServer, mutation);

						const delta: DiffResult<Room, Player> = diffSnapshot(
							prevServer,
							nextServer,
						);

						// Server advances to the new Trimmed_Snapshot.
						serverState = nextServer;

						// Client: apply only NON-empty deltas; skip empty ticks
						// (Req 3.8 — the emitter does not send them).
						if (!isEmptyDiff(delta)) {
							clientState = applyDelta(clientState, delta);
						}

						// Invariant (Req 4.7): client view == server snapshot now.
						expect(deepEqual(clientState, serverState)).toBe(true);
					}
				},
			),
			{ numRuns: 500 },
		);
	});

	it("a no-op mutation yields an empty diff that the client skips (Req 3.8)", () => {
		fc.assert(
			fc.property(initialSnapshotArb, (initial) => {
				// change-room-same produces a structurally identical snapshot.
				const next = applyMutation(initial, { kind: "change-room-same" });
				const delta = diffSnapshot(initial, next);
				expect(isEmptyDiff(delta)).toBe(true);
				// Skipping it keeps the client equal to the (unchanged) server.
				expect(deepEqual(initial, next)).toBe(true);
			}),
			{ numRuns: 200 },
		);
	});

	// Concrete anchors for the three player operations so a regression in any
	// single operation is easy to localize (add / change / remove round-trip).
	it("round-trips a player ADD", () => {
		const base: Fixture = {
			room: { phase: "playing", roundNumber: 1, revealed: ["a"] },
			players: { p1: { name: "al", score: 10, board: { guesses: 1, lastGuess: "x" } } },
		};
		const next: Fixture = {
			room: base.room,
			players: {
				...base.players,
				p2: { name: "bo", score: 0, board: { guesses: 0, lastGuess: "" } },
			},
		};
		const client = applyDelta(base, diffSnapshot(base, next));
		expect(deepEqual(client, next)).toBe(true);
	});

	it("round-trips a player CHANGE", () => {
		const base: Fixture = {
			room: { phase: "playing", roundNumber: 1, revealed: [] },
			players: { p1: { name: "al", score: 10, board: { guesses: 1, lastGuess: "x" } } },
		};
		const next: Fixture = {
			room: base.room,
			players: { p1: { name: "al", score: 42, board: { guesses: 2, lastGuess: "yz" } } },
		};
		const client = applyDelta(base, diffSnapshot(base, next));
		expect(deepEqual(client, next)).toBe(true);
	});

	it("round-trips a player REMOVE", () => {
		const base: Fixture = {
			room: { phase: "playing", roundNumber: 1, revealed: [] },
			players: {
				p1: { name: "al", score: 10, board: { guesses: 1, lastGuess: "x" } },
				p2: { name: "bo", score: 5, board: { guesses: 0, lastGuess: "" } },
			},
		};
		const next: Fixture = {
			room: base.room,
			players: { p1: base.players.p1 },
		};
		const delta = diffSnapshot(base, next);
		expect(delta.removedPlayers).toEqual(["p2"]);
		const client = applyDelta(base, delta);
		expect(deepEqual(client, next)).toBe(true);
	});
});
