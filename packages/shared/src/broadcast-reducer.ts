// Pure sequence-aware client reducer for keyframe/delta broadcasts
// (realtime-broadcast-scaling, design.md "Client apply + Resync", task 7.1).
//
// This module is the CLIENT-side driver that sits above `applyDelta`: it takes
// the client's current reducer state and one incoming broadcast, decides what
// to do with it (rebase on a keyframe, apply an in-order delta, or hold the
// last-good snapshot and request a resync), and returns the NEW state plus the
// side-effect the caller must perform. It is PURE and framework-agnostic — it
// performs no I/O and emits no socket events; the React hooks (task 7.2) wire
// the returned `effect` to an actual `resync` emit. Keeping the decision logic
// here means both modes (Race, Battle Royale) share one implementation and the
// gap/resync rules are stated and tested once.
//
// Design decisions (documented so the reducer, the hooks, and the tests agree):
//
//   1. GENERIC / cross-mode. Like `diffSnapshot`/`applyDelta`, the reducer is
//      `reduceEnvelope<Room, Player>` operating STRUCTURALLY on `{ room,
//      players }`; it never imports a mode's DTO. The hooks call it with
//      `ClientRaceMatch` / `ClientGame` bound to `Room`/`Player`.
//
//   2. PURE, no I/O. A resync is a NETWORK action, so the reducer never emits.
//      Instead `reduceEnvelope` returns `{ state, effect }` where `effect` is
//      `"none"` or `"request-resync"`, and the caller performs the emit. This
//      keeps the branch logic (which is the correctness-sensitive part) unit
//      testable without a socket.
//
//   3. STRUCTURAL envelope shape. Mirroring its sibling modules, this file
//      restates the keyframe/delta/bare-snapshot shapes structurally instead of
//      importing `types/broadcast.types.js`, so `shared` stays free of a
//      cross-package dependency. The shapes are structurally identical to
//      `Keyframe<Room, Player>` / `Delta<Room, Player>` there; the hooks type
//      their call site against the real aliases, which the compiler verifies.
//
// --- Sequence-number scheme (produced by `broadcast-emit.ts`) ---------------
//
// The server stamps a per-room monotonic `seq` (lazily from 0, so the first
// envelope a room sends is a keyframe at `seq: 1`). EVERY emitted envelope —
// keyframe OR delta — bumps `seq` by exactly one, so a delta always carries
// `seq === previousSeq + 1`, and a forced/round keyframe interleaved between
// deltas keeps that same +1 cadence. The reducer therefore:
//
//   - KEYFRAME  → replace the snapshot, set `baseSeq = keyframe.seq`, clear
//     `resyncInFlight` (a keyframe is a fresh rebase, and also the resync reply
//     — Req 4.1, 4.4, 4.8). Effect `"none"`.
//   - DELTA, `seq === baseSeq + 1` → apply via `applyDelta`, advance
//     `baseSeq = delta.seq` (Req 4.2, 4.6). Effect `"none"`.
//   - DELTA, `seq <= baseSeq` → a STALE/DUPLICATE payload (already reflected, or
//     an old reorder). Ignore it — hold the last-good snapshot — and do NOT
//     request a resync: it is not a missing-update gap forward, just stale, so
//     resyncing would be wasteful. Effect `"none"` (Req 4.3, 4.5).
//   - DELTA, `seq > baseSeq + 1` → a FORWARD GAP (a payload was dropped or
//     reordered). Do NOT apply; hold the last-good snapshot (Req 4.3, 4.5) and
//     request a resync so the server sends a fresh keyframe to rebase on
//     (Req 4.4). But at most ONE resync in flight at a time (Req 4.8): if
//     `resyncInFlight` is already set, request nothing (effect `"none"`);
//     otherwise set `resyncInFlight = true` and effect `"request-resync"`.
//   - DELTA before any keyframe (`snapshot === undefined`) → there is no base to
//     apply onto, so this is treated as a gap: hold (nothing to render yet) and
//     request a resync (subject to the one-in-flight rule) so a keyframe
//     establishes the base. `baseSeq` is 0 before the first keyframe, and the
//     server's first real envelope is a keyframe at `seq: 1`, so this path is
//     only reached if a delta somehow arrives first.
//
// --- Flag-off compatibility: bare full snapshots -----------------------------
//
// When the delta-broadcast flag is OFF, the server emits a bare full
// Trimmed_Snapshot (`{ room, players }`, with NO `seq`/`type`) on the same
// event. The reducer accepts either an envelope OR a bare snapshot: a value
// with no `type` field is treated as an IMPLICIT KEYFRAME — it always REPLACES
// the state and clears `resyncInFlight`, and never requests a resync (there is
// no sequence to gap-check). `baseSeq` is left unchanged for a bare snapshot
// (there is no seq to adopt): with the flag off, every tick is a bare snapshot
// that replaces wholesale, so `baseSeq` is simply never consulted. This keeps
// the client correct whether the flag is on or off, and lets a room that is
// toggled on later rebase cleanly on its first real keyframe.

import {
	applyDelta,
	type DiffResult,
	type Snapshot,
} from "./broadcast-diff.ts";

/**
 * A full Trimmed_Snapshot stamped with its sequence number — structurally
 * identical to `Keyframe<Room, Player>` in `types/broadcast.types.js`. The
 * client replaces its local state with it and records `seq` as the new base.
 */
export type KeyframeEnvelope<Room, Player> = {
	seq: number;
	type: "keyframe";
	room: Room;
	players: Record<string, Player>;
};

/**
 * A change-only payload stamped with its sequence number — structurally
 * identical to `Delta<Room, Player>` in `types/broadcast.types.js`. Carries
 * only the changed room fields, changed/added players, and removed-player ids.
 */
export type DeltaEnvelope<Room, Player> = {
	seq: number;
	type: "delta";
	room?: Partial<Room>;
	players?: Record<string, Partial<Player>>;
	removedPlayers?: string[];
};

/** A versioned broadcast: either a keyframe or a delta (narrow on `type`). */
export type BroadcastEnvelope<Room, Player> =
	| KeyframeEnvelope<Room, Player>
	| DeltaEnvelope<Room, Player>;

/**
 * What the reducer accepts on a state-broadcast event: a versioned envelope
 * (flag ON) OR a bare full Trimmed_Snapshot with no `seq`/`type` (flag OFF).
 * The reducer discriminates on the presence of the `type` field.
 */
export type BroadcastInput<Room, Player> =
	| BroadcastEnvelope<Room, Player>
	| Snapshot<Room, Player>;

/**
 * The client's sequence-aware reducer state:
 *   - `snapshot`      — the last-good Trimmed_Snapshot to render; `undefined`
 *     before the first keyframe/bare-snapshot has been received.
 *   - `baseSeq`       — the `seq` the current `snapshot` reflects. 0 before any
 *     keyframe (the server's first keyframe is `seq: 1`). Not meaningful while
 *     only bare flag-off snapshots have been seen.
 *   - `resyncInFlight`— true while a resync has been requested but no rebasing
 *     keyframe has arrived yet, so a burst of gaps requests at most once
 *     (Req 4.8).
 */
export type ReducerState<Room, Player> = {
	snapshot?: Snapshot<Room, Player>;
	baseSeq: number;
	resyncInFlight: boolean;
};

/**
 * The side-effect the caller (hook) must perform after a reduce:
 *   - `"none"`           — do nothing; just adopt the returned state.
 *   - `"request-resync"` — emit a `resync` request to the server (exactly once
 *     per detected gap burst, enforced by `resyncInFlight`).
 */
export type ReducerEffect = "none" | "request-resync";

/** The result of reducing one broadcast: the new state and the effect to run. */
export type ReduceResult<Room, Player> = {
	state: ReducerState<Room, Player>;
	effect: ReducerEffect;
};

/** The reducer's initial state: nothing rendered yet, no resync outstanding. */
export const initialReducerState = <Room, Player>(): ReducerState<
	Room,
	Player
> => ({
	snapshot: undefined,
	baseSeq: 0,
	resyncInFlight: false,
});

/**
 * Narrows a `BroadcastInput` to a versioned envelope. A bare flag-off snapshot
 * has no `type` field; an envelope always does.
 */
const isEnvelope = <Room, Player>(
	input: BroadcastInput<Room, Player>,
): input is BroadcastEnvelope<Room, Player> =>
	typeof (input as { type?: unknown }).type === "string";

/**
 * Pure sequence-aware reduce (Req 4.1, 4.2, 4.3, 4.5, 4.8).
 *
 * Takes the current reducer state and one incoming broadcast (envelope or bare
 * flag-off snapshot) and returns the NEW state plus the effect the caller must
 * perform. Never mutates `state` or `input`; a fresh state object is returned.
 * The underlying snapshot transform (`applyDelta`) is itself pure, so the held
 * last-good snapshot is never partially mutated on a gap.
 *
 * Branches (see the module header for the full rationale):
 *   - bare snapshot (no `type`) → replace, clear resync, keep `baseSeq`; none.
 *   - keyframe                  → replace, `baseSeq = seq`, clear resync; none.
 *   - delta `seq === baseSeq+1` → apply, `baseSeq = seq`; none.
 *   - delta `seq <= baseSeq`    → stale/duplicate: hold, no resync; none.
 *   - delta `seq > baseSeq+1`   → gap: hold, request resync (one in flight).
 *   - delta before any snapshot → gap: hold, request resync (one in flight).
 */
export const reduceEnvelope = <Room, Player>(
	state: ReducerState<Room, Player>,
	input: BroadcastInput<Room, Player>,
): ReduceResult<Room, Player> => {
	// --- Flag-OFF bare snapshot: always replace, never resync. ---------------
	if (!isEnvelope(input)) {
		return {
			state: {
				snapshot: { room: input.room, players: { ...input.players } },
				// No seq to adopt; leave the base as-is (unused while flag off).
				baseSeq: state.baseSeq,
				resyncInFlight: false,
			},
			effect: "none",
		};
	}

	// --- KEYFRAME: fresh rebase; also the resync reply (Req 4.1, 4.4, 4.8). --
	if (input.type === "keyframe") {
		return {
			state: {
				snapshot: { room: input.room, players: { ...input.players } },
				baseSeq: input.seq,
				resyncInFlight: false,
			},
			effect: "none",
		};
	}

	// --- DELTA ---------------------------------------------------------------
	// In-order and we have a base to apply onto: apply + advance (Req 4.2, 4.6).
	if (state.snapshot !== undefined && input.seq === state.baseSeq + 1) {
		const body: DiffResult<Room, Player> = {
			room: input.room,
			players: input.players,
			removedPlayers: input.removedPlayers,
		};
		return {
			state: {
				snapshot: applyDelta(state.snapshot, body),
				baseSeq: input.seq,
				resyncInFlight: state.resyncInFlight,
			},
			effect: "none",
		};
	}

	// Stale / duplicate / old-reorder delta (and we have a base): the payload is
	// already reflected or superseded. Hold last-good, do NOT resync — this is
	// not a forward gap, just stale (Req 4.3, 4.5).
	if (state.snapshot !== undefined && input.seq <= state.baseSeq) {
		return {
			state: { ...state },
			effect: "none",
		};
	}

	// Forward GAP (seq > baseSeq + 1), OR a delta arriving before any keyframe
	// (no base to apply onto). Either way: hold the last-good snapshot and
	// request a resync — but at most one in flight at a time (Req 4.3, 4.5, 4.8).
	if (state.resyncInFlight) {
		// A resync is already outstanding; hold and request nothing more.
		return {
			state: { ...state },
			effect: "none",
		};
	}

	return {
		state: {
			snapshot: state.snapshot,
			baseSeq: state.baseSeq,
			resyncInFlight: true,
		},
		effect: "request-resync",
	};
};
