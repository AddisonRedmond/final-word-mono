// Pure versioned-emit stamping for keyframe/delta broadcasts
// (realtime-broadcast-scaling, design.md "Keyframes, Deltas, Sequence_Numbers").
//
// This module owns the SMALL pure bookkeeping shared by both modes' emitters:
// given a room's current broadcast version (or none yet) and the just-built
// Trimmed_Snapshot, it computes the NEW version record and the envelope to send.
// It never touches Socket.IO, Authoritative_State, or a mode's DTO — the
// mode-specific emit wrappers (race/lobby.ts, battle-royale/lobby.ts) build the
// snapshot, call these, then do the actual `emit`. Keeping the seq/cadence math
// here means Race and Battle Royale stamp versions identically (Req 3.7) and the
// rules below are stated once.
//
// --- Sequence-number scheme (consumed by the client reducer, task 7.1) -------
//
// A room's `seq` is a per-room monotonically increasing counter (Req 3.1). The
// version record is lazily created with `seq: 0`; EVERY emitted envelope
// (keyframe or delta) increments `seq` BEFORE stamping, so:
//
//   - the first envelope a room ever sends is a keyframe at `seq: 1`;
//   - a delta always carries `seq === previousSeq + 1`.
//
// This matches the client reducer (task 7.1), which rebases on any keyframe and
// applies a delta only when `delta.seq === baseSeq + 1`. Because a keyframe can
// bump `seq` by exactly one too, a keyframe interleaved between deltas keeps the
// same +1 cadence the client checks, so the client never spuriously requests a
// resync across a forced/round keyframe.
//
// --- Keyframe vs delta ------------------------------------------------------
//
// This module implements BOTH the KEYFRAME stamp (task 6.1) and the DELTA stamp
// (task 6.2). A keyframe carries the FULL current Trimmed_Snapshot, increments
// `seq`, RESETS `ticksSinceKeyframe` to 0, and stores the snapshot as
// `lastSent` so the next delta can diff against it. A delta carries only what
// changed since `lastSent` (computed via `diffSnapshot` from `broadcast-diff`),
// increments `seq`, BUMPS `ticksSinceKeyframe`, and updates `lastSent`; an
// empty diff is a SKIP that emits nothing and leaves the version UNCHANGED (so
// an idle tick never advances `seq`, Req 3.8).
//
// Dependency note: like `broadcast-diff.ts`, this module is GENERIC and stays
// free of a cross-package dependency on `types` — it restates the small
// keyframe-envelope shape structurally below. The envelope it returns is
// structurally identical to `Keyframe<Room, Player>` / `Delta<Room, Player>` in
// `types/broadcast.types.js` (the mode emitters type their call site against
// the alias, so the shapes are kept in lockstep there). It DOES depend on its
// sibling `broadcast-diff.js` (same package) for the pure diff.

import {
	type DiffResult,
	diffSnapshot,
	isEmptyDiff,
} from "./broadcast-diff.ts";

/**
 * The structural shape of a mode's full Trimmed_Snapshot: a room object plus a
 * players map. Both `ClientRaceMatch` and `ClientGame` satisfy this, so one
 * generic stamp serves both modes. Mirrors `Snapshot` in `broadcast-diff.ts`.
 */
export type Snapshot<Room, Player> = {
	room: Room;
	players: Record<string, Player>;
};

/**
 * The keyframe envelope this module stamps — structurally identical to
 * `Keyframe<Room, Player>` in `types/broadcast.types.js` (a full Trimmed_Snapshot
 * stamped with its `seq`). Restated here so `shared` stays dependency-free; the
 * mode emitters assign the result to the real `Keyframe` alias, which the
 * compiler verifies matches.
 */
export type KeyframeEnvelope<Room, Player> = {
	seq: number;
	type: "keyframe";
	room: Room;
	players: Record<string, Player>;
};

/**
 * The per-room broadcast version record this module advances. Structurally the
 * same as `BroadcastVersion<Snapshot>` in `types/broadcast.types.js`, restated
 * generically over `Room`/`Player` so this pure module does not depend on a
 * mode's DTO. The emitters pass their concrete `RaceBroadcastVersion` /
 * `BattleRoyaleBroadcastVersion` (which are assignable to this).
 */
export type BroadcastVersionState<Room, Player> = {
	seq: number;
	ticksSinceKeyframe: number;
	lastSent?: Snapshot<Room, Player>;
};

/**
 * Result of stamping a keyframe: the envelope to emit and the new version
 * record the caller must store back on the room's server-only state.
 */
export type KeyframeStamp<Room, Player> = {
	envelope: KeyframeEnvelope<Room, Player>;
	version: BroadcastVersionState<Room, Player>;
};

/**
 * Pure keyframe stamp (Req 3.2, 3.6).
 *
 * Given the room's current version record (or `undefined` before the first
 * emit) and the just-built Trimmed_Snapshot, returns the keyframe envelope and
 * the NEW version record:
 *   - `seq`                = previous seq (0 if none) + 1  — monotonic (Req 3.1);
 *   - `type`               = "keyframe", carrying the full `room` + `players`;
 *   - `ticksSinceKeyframe` = 0  — the forced-keyframe cadence counter resets;
 *   - `lastSent`           = the snapshot, so task 6.2's delta diffs against it.
 *
 * Neither argument is mutated: a fresh version record and a fresh envelope are
 * returned. The snapshot's `room`/`players` are referenced (not deep-copied) by
 * both the envelope and `lastSent`; callers pass a freshly projected snapshot
 * (the mode projections build new objects), so this sharing is safe.
 */
export const stampKeyframe = <Room, Player>(
	current: BroadcastVersionState<Room, Player> | undefined,
	snapshot: Snapshot<Room, Player>,
): KeyframeStamp<Room, Player> => {
	const seq = (current?.seq ?? 0) + 1;

	const envelope: KeyframeEnvelope<Room, Player> = {
		seq,
		type: "keyframe",
		room: snapshot.room,
		players: snapshot.players,
	};

	const version: BroadcastVersionState<Room, Player> = {
		seq,
		ticksSinceKeyframe: 0,
		lastSent: snapshot,
	};

	return { envelope, version };
};

/**
 * The delta envelope this module stamps — structurally identical to
 * `Delta<Room, Player>` in `types/broadcast.types.js` (a change-only body
 * stamped with its `seq`). Restated here so `shared` stays free of a `types`
 * dependency; the mode emitters assign the result to the real `Delta` alias,
 * which the compiler verifies matches. Carries only the changed room fields,
 * changed/added players, and removed-player ids the diff produced.
 */
export type DeltaEnvelope<Room, Player> = {
	seq: number;
	type: "delta";
	room?: Partial<Room>;
	players?: Record<string, Partial<Player>>;
	removedPlayers?: string[];
};

/**
 * Result of stamping a delta. Either:
 *   - `{ skip: true }` — the diff was empty (no change since `lastSent`), so the
 *     caller emits NOTHING and leaves the version untouched (Req 3.8); or
 *   - `{ skip: false, envelope, version }` — a non-empty delta to emit plus the
 *     advanced version record the caller stores back.
 *
 * A discriminated union so the caller must handle the skip case explicitly
 * rather than conditionally reading an optional envelope.
 */
export type DeltaStamp<Room, Player> =
	| { skip: true }
	| {
			skip: false;
			envelope: DeltaEnvelope<Room, Player>;
			version: BroadcastVersionState<Room, Player>;
	  };

/**
 * Pure delta stamp (Req 3.3, 3.5, 3.8).
 *
 * Given the room's current version record (which MUST carry `lastSent` — a
 * delta can only be stamped once a keyframe has established a base) and the
 * just-built Trimmed_Snapshot, diffs `current.lastSent` against `snapshot`:
 *
 *   - EMPTY diff  → returns `{ skip: true }`. No envelope, and the version is
 *     NOT advanced: an idle Update_Window ticked but no payload goes out and
 *     `seq` does not move (Req 3.8), so the next real change still stamps the
 *     next sequential `seq` the client expects.
 *   - NON-EMPTY   → returns `{ skip: false, envelope, version }` where:
 *       - `seq`                = previous seq + 1  — monotonic (Req 3.1), one
 *         greater than the last emitted envelope so the client applies it;
 *       - `type`               = "delta", carrying only the diff body;
 *       - `ticksSinceKeyframe` = previous + 1  — advances the forced-keyframe
 *         cadence counter (Req 3.6);
 *       - `lastSent`           = the new snapshot, so the next delta diffs
 *         against the state the client now holds.
 *
 * Neither argument is mutated: a fresh version record and a fresh envelope are
 * returned. The snapshot is referenced (not deep-copied) as the new `lastSent`;
 * callers pass a freshly projected snapshot, so this sharing is safe. If
 * `current.lastSent` is absent (no prior keyframe), the whole snapshot is
 * treated as new state via an empty-prev diff — but callers wire a forced
 * keyframe on the first tick, so this is a defensive fallback, not the path.
 */
export const stampDelta = <Room, Player>(
	current: BroadcastVersionState<Room, Player>,
	snapshot: Snapshot<Room, Player>,
): DeltaStamp<Room, Player> => {
	const prev: Snapshot<Room, Player> = current.lastSent ?? {
		room: {} as Room,
		players: {},
	};

	const diff: DiffResult<Room, Player> = diffSnapshot(prev, snapshot);

	// Empty diff → skip the tick entirely; the version is left UNCHANGED so
	// `seq` does not advance on an idle window (Req 3.8).
	if (isEmptyDiff(diff)) {
		return { skip: true };
	}

	const seq = current.seq + 1;

	const envelope: DeltaEnvelope<Room, Player> = {
		seq,
		type: "delta",
		...diff,
	};

	const version: BroadcastVersionState<Room, Player> = {
		seq,
		ticksSinceKeyframe: current.ticksSinceKeyframe + 1,
		lastSent: snapshot,
	};

	return { skip: false, envelope, version };
};
