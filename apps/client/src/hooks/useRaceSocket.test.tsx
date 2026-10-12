import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ClientRacePlayer,
	ClientRaceRoom,
} from "@/types/race.types";

// Feature: realtime-broadcast-scaling, Task 7.3 — client apply/resync
// behavioural coverage for the RACE hook seam (Req 4.3, 4.4, 4.5, 4.7, 5.4).
//
// This mirrors the Battle Royale seam test (Task 7.2/7.3) but for `useRaceSocket`.
// Unlike the Battle Royale hook — which takes a `socketRef` — `useRaceSocket`
// creates its OWN socket via `io(...)` on mount and only wires its handlers once
// `connect` fires (that handler also runs the clock sync and emits `join`). So
// the test:
//   - mocks `socket.io-client`'s `io` to return a FakeSocket,
//   - mocks `@/env` so `NEXT_PUBLIC_WS_URL` is defined,
//   - mocks `@/state/server-clock-store` so the connect handler's clock sync is
//     an inert no-op (no real timers/network),
//   - passes a `token` so the connect effect actually runs,
//   - fires `connect` first, then drives `join:ack` / `race:update` envelopes
//     through the registered handlers and asserts the reduced `match` snapshot.

// `env` is read at module load inside the hook's effect; a plain object is enough.
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_WS_URL: "ws://localhost" } }));

// The connect handler calls `useServerClockStore.getState().sync(socket)` and
// the cleanup calls `.reset()`. Stub both to inert no-ops so no real clock
// handshake (timers/emits) runs during the test.
vi.mock("@/state/server-clock-store", () => ({
	useServerClockStore: {
		getState: () => ({ sync: vi.fn(async () => {}), reset: vi.fn() }),
	},
}));

type Handler = (payload: unknown) => void;

/**
 * Minimal fake Socket.IO client for the Race hook. Records `on` handlers so the
 * test can fire server events, records every `emit` so the test can assert a
 * `resync` went out, and reports `connected` (the hook guards `sendGuess` /
 * `leave` on it, though these tests don't exercise those paths). Only the
 * surface `useRaceSocket` touches is implemented.
 */
class FakeSocket {
	readonly handlers = new Map<string, Handler>();
	readonly emitted: { event: string; args: unknown[] }[] = [];
	connected = false;

	on(event: string, handler: Handler) {
		this.handlers.set(event, handler);
		return this;
	}

	off(event: string) {
		this.handlers.delete(event);
		return this;
	}

	emit(event: string, ...args: unknown[]) {
		this.emitted.push({ event, args });
		return this;
	}

	disconnect() {
		this.connected = false;
		return this;
	}

	/**
	 * Fire a server event into the hook's registered handler, wrapped in `act`
	 * so the `setMatch` state update flushes before the test asserts.
	 */
	fire(event: string, payload?: unknown) {
		act(() => {
			this.handlers.get(event)?.(payload);
		});
	}

	get resyncCount() {
		return this.emitted.filter((e) => e.event === "resync").length;
	}
}

// The hook imports `{ io }` from "socket.io-client"; return our fake from it.
const ioMock = vi.hoisted(() => vi.fn());
vi.mock("socket.io-client", () => ({ io: ioMock }));

import { useRaceSocket } from "./useRaceSocket";

const room = (over: Partial<ClientRaceRoom> = {}): ClientRaceRoom => ({
	matchId: "race-1",
	phase: "round",
	currentRoundIndex: 0,
	lobbyDeadline: 0,
	isDraw: false,
	...over,
});

const player = (over: Partial<ClientRacePlayer> = {}): ClientRacePlayer => ({
	name: "p",
	isEliminated: false,
	isAnonymous: false,
	completedWords: 0,
	qualified: false,
	totalGuesses: 0,
	correctGuesses: 0,
	...over,
});

/**
 * Mount the hook with a fresh fake socket wired through the mocked `io`, fire
 * `connect` to run the hook's connect handler (clock sync + `join`), and expose
 * the latest reduced match snapshot plus the fake socket for assertions.
 */
const mount = () => {
	const socket = new FakeSocket();
	ioMock.mockReturnValue(socket as unknown as ReturnType<typeof ioMock>);
	const { result } = renderHook(() => useRaceSocket({ token: "tok" }));
	// Mark connected and run the connect handler so the hook is live.
	socket.connected = true;
	socket.fire("connect");
	return { socket, result };
};

beforeEach(() => {
	ioMock.mockReset();
});

describe("useRaceSocket reducer wiring (Task 7.2 parity)", () => {
	it("renders the reduced keyframe snapshot via setMatch", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann" }) },
		});

		expect(result.current.match?.players.a?.name).toBe("ann");
		expect(socket.resyncCount).toBe(0);
	});

	it("applies an in-order delta onto the keyframe base", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann", completedWords: 0 }) },
		});
		socket.fire("race:update", {
			seq: 2,
			type: "delta",
			players: { a: player({ name: "ann", completedWords: 1 }) },
		});

		expect(result.current.match?.players.a?.completedWords).toBe(1);
		expect(socket.resyncCount).toBe(0);
	});

	it("drops removed players from the rendered opponents view (Req 4.6)", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann" }), b: player({ name: "bob" }) },
		});
		expect(Object.keys(result.current.match?.players ?? {}).sort()).toEqual([
			"a",
			"b",
		]);

		socket.fire("race:update", {
			seq: 2,
			type: "delta",
			removedPlayers: ["b"],
		});
		expect(Object.keys(result.current.match?.players ?? {})).toEqual(["a"]);
	});

	it("replaces wholesale for a bare flag-off snapshot and never resyncs", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			room: room(),
			players: { a: player({ name: "ann" }) },
		});
		socket.fire("race:update", {
			room: room({ phase: "finished", winnerId: "c" }),
			players: { c: player({ name: "cat" }) },
		});

		expect(result.current.match?.room.phase).toBe("finished");
		expect(Object.keys(result.current.match?.players ?? {})).toEqual(["c"]);
		expect(socket.resyncCount).toBe(0);
	});
});

describe("useRaceSocket apply/resync behaviour (Task 7.3)", () => {
	it("accumulates several in-order deltas onto the keyframe base (Req 4.7)", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room({ currentRoundIndex: 1 }),
			players: {
				a: player({ name: "ann", completedWords: 0, totalGuesses: 0 }),
				b: player({ name: "bob", completedWords: 0, totalGuesses: 0 }),
			},
		});

		// Delta 2: ann completes a word.
		socket.fire("race:update", {
			seq: 2,
			type: "delta",
			players: { a: player({ name: "ann", completedWords: 1, totalGuesses: 3 }) },
		});
		// Delta 3: ann qualifies (a different field changes).
		socket.fire("race:update", {
			seq: 3,
			type: "delta",
			players: {
				a: player({
					name: "ann",
					completedWords: 1,
					totalGuesses: 3,
					qualified: true,
				}),
			},
		});
		// Delta 4: bob completes a word — a different player changes.
		socket.fire("race:update", {
			seq: 4,
			type: "delta",
			players: { b: player({ name: "bob", completedWords: 1, totalGuesses: 2 }) },
		});

		// The rendered snapshot reflects the ACCUMULATION of all three deltas.
		expect(result.current.match?.players.a?.completedWords).toBe(1);
		expect(result.current.match?.players.a?.qualified).toBe(true);
		expect(result.current.match?.players.a?.totalGuesses).toBe(3);
		expect(result.current.match?.players.b?.completedWords).toBe(1);
		expect(result.current.match?.room.currentRoundIndex).toBe(1);
		expect(socket.resyncCount).toBe(0);
	});

	it("holds last-good on a gap, resyncs once, rebases on the keyframe, and re-arms", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann", completedWords: 0 }) },
		});

		// Gap: seq jumps 1 → 3 (seq 2 dropped). Hold last-good, request one resync.
		socket.fire("race:update", {
			seq: 3,
			type: "delta",
			players: { a: player({ name: "ann", completedWords: 5 }) },
		});
		// The gapped delta was NOT applied — still holding the keyframe view.
		expect(result.current.match?.players.a?.completedWords).toBe(0);
		expect(socket.resyncCount).toBe(1);

		// A second gapped delta must NOT emit another resync (one in flight).
		socket.fire("race:update", {
			seq: 4,
			type: "delta",
			players: { a: player({ name: "ann", completedWords: 9 }) },
		});
		expect(socket.resyncCount).toBe(1);

		// Server replies with a fresh keyframe → rebase on it and clear in-flight.
		socket.fire("race:update", {
			seq: 5,
			type: "keyframe",
			room: room({ currentRoundIndex: 2 }),
			players: { a: player({ name: "ann", completedWords: 2 }) },
		});
		expect(result.current.match?.players.a?.completedWords).toBe(2);
		expect(result.current.match?.room.currentRoundIndex).toBe(2);

		// After the rebase, a new gap can request a resync again (re-armed).
		socket.fire("race:update", {
			seq: 7,
			type: "delta",
			players: { a: player({ name: "ann", completedWords: 3 }) },
		});
		expect(socket.resyncCount).toBe(2);
	});

	it("reaches a complete mid-match view from the join keyframe alone (Req 5.4)", () => {
		const { socket, result } = mount();

		// Mid-match join: the server's first message is a keyframe carrying a full
		// in-progress snapshot (multiple players at varied states, round in
		// progress). No deltas follow — the view must already be complete.
		socket.fire("join:ack", {
			seq: 9,
			type: "keyframe",
			room: room({
				matchId: "race-mid",
				phase: "round",
				currentRoundIndex: 3,
				roundEndsAt: 50_000,
			}),
			players: {
				a: player({ name: "ann", completedWords: 2, qualified: true }),
				b: player({ name: "bob", isEliminated: true, placement: 4 }),
				c: player({ name: "cat", completedWords: 1 }),
			},
		});

		const match = result.current.match;
		// Every player present with their mid-match fields intact.
		expect(Object.keys(match?.players ?? {}).sort()).toEqual(["a", "b", "c"]);
		expect(match?.players.a?.qualified).toBe(true);
		expect(match?.players.b?.isEliminated).toBe(true);
		expect(match?.players.b?.placement).toBe(4);
		expect(match?.players.c?.completedWords).toBe(1);
		// Every room field present and reflecting an in-progress round.
		expect(match?.room.matchId).toBe("race-mid");
		expect(match?.room.phase).toBe("round");
		expect(match?.room.currentRoundIndex).toBe(3);
		expect(match?.room.roundEndsAt).toBe(50_000);
		// A keyframe is never a gap: no resync was needed to complete the view.
		expect(socket.resyncCount).toBe(0);
	});
});
