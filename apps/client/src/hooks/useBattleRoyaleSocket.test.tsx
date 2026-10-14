import { act, renderHook } from "@testing-library/react";
import { type RefObject, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { describe, expect, it } from "vitest";
import type {
	ClientBattleRoyalePlayer,
	ClientBattleRoyaleRoom,
	ClientGame,
} from "@/types/battle-royale.types";
import { useBattleRoyaleSocket } from "./useBattleRoyaleSocket";

// Feature: realtime-broadcast-scaling, Task 7.2 — resync wiring + removal
// handling (Req 4.4, 4.6). This is the integration-seam smoke test for the
// reducer-backed Battle Royale hook: it drives a sequence of broadcast
// envelopes through the hook's `socket.on` handlers and asserts that
//   - `setLobby` receives the REDUCED snapshot (not the raw payload),
//   - an in-order delta is applied onto the keyframe base,
//   - a forward Sequence_Number gap emits a single `resync`,
//   - the keyframe reply rebases and clears the in-flight flag,
//   - `removedPlayers` drops the player from the rendered opponents view.
// The full apply/resync behavioural matrix is Task 7.3; this keeps to the
// wiring + a smoke test.

type Handler = (payload: unknown) => void;

/**
 * Minimal fake Socket.IO client: records `on` handlers so the test can fire
 * server events, and records every `emit` so the test can assert a `resync`
 * went out. Only the surface the hook touches is implemented.
 */
class FakeSocket {
	readonly handlers = new Map<string, Handler>();
	readonly emitted: { event: string; args: unknown[] }[] = [];

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

	/**
	 * Fire a server event into the hook's registered handler, wrapped in `act`
	 * so the `setLobby` state update flushes before the test asserts.
	 */
	fire(event: string, payload: unknown) {
		act(() => {
			this.handlers.get(event)?.(payload);
		});
	}

	get resyncCount() {
		return this.emitted.filter((e) => e.event === "resync").length;
	}
}

const room = (over: Partial<ClientBattleRoyaleRoom> = {}): ClientBattleRoyaleRoom => ({
	lobbyId: "br-1",
	startTime: 0,
	isStarted: true,
	isFinished: false,
	isDraw: false,
	...over,
});

const player = (
	over: Partial<ClientBattleRoyalePlayer> = {},
): ClientBattleRoyalePlayer => ({
	name: "p",
	isEliminated: false,
	life: 3,
	totalGuesses: 0,
	correctGuesses: 0,
	currentWordGuesses: 0,
	...over,
});

/**
 * Mount the hook with a fresh fake socket and expose the latest reduced lobby
 * snapshot that the hook pushed via `setLobby`.
 */
const mount = () => {
	const socket = new FakeSocket();
	const { result } = renderHook(() => {
		const socketRef = useRef<Socket | null>(
			socket as unknown as Socket,
		) as RefObject<Socket | null>;
		const [lobby, setLobby] = useState<ClientGame | undefined>();
		useBattleRoyaleSocket({ socketRef, setLobby });
		return { lobby };
	});
	return { socket, result };
};

describe("useBattleRoyaleSocket reducer wiring (Task 7.2)", () => {
	it("renders the reduced keyframe snapshot via setLobby", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann" }) },
		});

		expect(result.current.lobby?.players.a?.name).toBe("ann");
		expect(socket.resyncCount).toBe(0);
	});

	it("applies an in-order delta onto the keyframe base", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann", life: 3 }) },
		});
		socket.fire("lobby:update", {
			seq: 2,
			type: "delta",
			players: { a: player({ name: "ann", life: 2 }) },
		});

		// The rendered snapshot reflects the applied delta, not a raw replace.
		expect(result.current.lobby?.players.a?.life).toBe(2);
		expect(socket.resyncCount).toBe(0);
	});

	it("emits a single resync on a forward gap and rebases on the keyframe reply", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann" }) },
		});

		// Gap: seq jumps from 1 to 3 (seq 2 dropped). Reducer holds last-good and
		// requests one resync.
		socket.fire("lobby:update", {
			seq: 3,
			type: "delta",
			players: { a: player({ name: "ann", life: 1 }) },
		});
		// Still holding the last-good keyframe; the gapped delta was NOT applied.
		expect(result.current.lobby?.players.a?.life).toBe(3);
		expect(socket.resyncCount).toBe(1);

		// A second gapped delta must NOT emit another resync (one in flight).
		socket.fire("lobby:update", {
			seq: 4,
			type: "delta",
			players: { a: player({ name: "ann", life: 0 }) },
		});
		expect(socket.resyncCount).toBe(1);

		// Server replies with a fresh keyframe on the same event → rebase + clear.
		socket.fire("lobby:update", {
			seq: 5,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann", life: 1 }) },
		});
		expect(result.current.lobby?.players.a?.life).toBe(1);

		// After the rebase, a new gap can request a resync again.
		socket.fire("lobby:update", {
			seq: 7,
			type: "delta",
			players: { a: player({ name: "ann" }) },
		});
		expect(socket.resyncCount).toBe(2);
	});

	it("drops removed players from the rendered opponents view (Req 4.6)", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room(),
			players: { a: player({ name: "ann" }), b: player({ name: "bob" }) },
		});
		expect(Object.keys(result.current.lobby?.players ?? {}).sort()).toEqual([
			"a",
			"b",
		]);

		socket.fire("lobby:update", {
			seq: 2,
			type: "delta",
			removedPlayers: ["b"],
		});
		expect(Object.keys(result.current.lobby?.players ?? {})).toEqual(["a"]);
	});

	it("replaces wholesale for a bare flag-off snapshot and never resyncs", () => {
		const { socket, result } = mount();

		// No seq/type → bare snapshot branch: always replace, never resync.
		socket.fire("join:ack", {
			room: room(),
			players: { a: player({ name: "ann" }) },
		});
		socket.fire("lobby:update", {
			room: room({ isFinished: true }),
			players: { c: player({ name: "cat" }) },
		});

		expect(result.current.lobby?.room.isFinished).toBe(true);
		expect(Object.keys(result.current.lobby?.players ?? {})).toEqual(["c"]);
		expect(socket.resyncCount).toBe(0);
	});
});

// Feature: realtime-broadcast-scaling, Task 7.3 — client apply/resync
// behavioural coverage (Req 4.3, 4.4, 4.5, 4.7, 5.4). Task 7.2 above covers the
// wiring smoke tests; these drive longer envelope sequences through the same
// hook seam to assert the end-to-end apply/resync behaviour the requirements
// name:
//   - several in-order deltas apply and ACCUMULATE (Req 4.7),
//   - a gap holds last-good, resyncs once, the keyframe reply restores a
//     correct view, and a later gap re-arms the resync (Req 4.3, 4.4, 4.5, 4.8),
//   - a mid-match join reaches a COMPLETE view from the join keyframe alone,
//     with no deltas needed (Req 5.4).
describe("useBattleRoyaleSocket apply/resync behaviour (Task 7.3)", () => {
	it("accumulates several in-order deltas onto the keyframe base (Req 4.7)", () => {
		const { socket, result } = mount();

		socket.fire("join:ack", {
			seq: 1,
			type: "keyframe",
			room: room({ isStarted: true }),
			players: {
				a: player({ name: "ann", life: 3, correctGuesses: 0 }),
				b: player({ name: "bob", life: 3, correctGuesses: 0 }),
			},
		});

		// Delta 2: ann loses a life.
		socket.fire("lobby:update", {
			seq: 2,
			type: "delta",
			players: { a: player({ name: "ann", life: 2, correctGuesses: 0 }) },
		});
		// Delta 3: ann scores a correct guess (a different field changes).
		socket.fire("lobby:update", {
			seq: 3,
			type: "delta",
			players: { a: player({ name: "ann", life: 2, correctGuesses: 1 }) },
		});
		// Delta 4: bob loses a life — a different player changes.
		socket.fire("lobby:update", {
			seq: 4,
			type: "delta",
			players: { b: player({ name: "bob", life: 2, correctGuesses: 0 }) },
		});

		// The rendered snapshot reflects the ACCUMULATION of all three deltas,
		// not just the last one: ann's two changes and bob's one all persist.
		expect(result.current.lobby?.players.a?.life).toBe(2);
		expect(result.current.lobby?.players.a?.correctGuesses).toBe(1);
		expect(result.current.lobby?.players.b?.life).toBe(2);
		// Untouched fields carried through from the keyframe base.
		expect(result.current.lobby?.players.a?.name).toBe("ann");
		expect(result.current.lobby?.room.isStarted).toBe(true);
		expect(socket.resyncCount).toBe(0);
	});

	it("reaches a complete mid-match view from the join keyframe alone (Req 5.4)", () => {
		const { socket, result } = mount();

		// A mid-match join: the server's first message is a keyframe carrying a
		// full in-progress snapshot (multiple players at varied states, a started
		// room). No deltas follow — the view must already be complete.
		socket.fire("join:ack", {
			seq: 7,
			type: "keyframe",
			room: room({
				lobbyId: "br-mid",
				startTime: 1000,
				isStarted: true,
				isFinished: false,
			}),
			players: {
				a: player({ name: "ann", life: 2, isEliminated: false }),
				b: player({ name: "bob", life: 0, isEliminated: true }),
				c: player({ name: "cat", life: 3, correctGuesses: 4 }),
			},
		});

		const lobby = result.current.lobby;
		// Every player present with their mid-match fields intact.
		expect(Object.keys(lobby?.players ?? {}).sort()).toEqual(["a", "b", "c"]);
		expect(lobby?.players.a?.life).toBe(2);
		expect(lobby?.players.b?.isEliminated).toBe(true);
		expect(lobby?.players.c?.correctGuesses).toBe(4);
		// Every room field present and reflecting an in-progress match.
		expect(lobby?.room.lobbyId).toBe("br-mid");
		expect(lobby?.room.isStarted).toBe(true);
		expect(lobby?.room.isFinished).toBe(false);
		expect(lobby?.room.startTime).toBe(1000);
		// A keyframe is never a gap: no resync was needed to complete the view.
		expect(socket.resyncCount).toBe(0);
	});
});
