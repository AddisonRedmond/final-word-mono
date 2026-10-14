// Pure trimmed-snapshot diff for delta broadcasts
// (realtime-broadcast-scaling, design.md "Pure diff + apply logic").
//
// This module is the SERVER-side half of the delta protocol: given the
// previous Trimmed_Snapshot a room broadcast and the current one, it computes
// the change-only delta body — the room-level fields that changed, the players
// that joined or whose UI fields changed, and the ids of players that were
// removed. The client-side counterpart (task 5.2 `applyDelta`) merges this body
// back onto its local state; the two MUST stay consistent, which is why they
// live together in `shared` and are exercised by one equivalence property test
// (task 5.3).
//
// Design decisions (documented so diff + apply + the property test agree):
//
//   1. GENERIC / cross-mode. Battle Royale and Race share the exact
//      keyframe/delta model (Req 3.7) and differ only in their trimmed DTO
//      shapes. So `diffSnapshot<Room, Player>` is parameterised and operates
//      STRUCTURALLY on `{ room, players }` — it never imports a mode's DTO. The
//      emitter (task 6) calls it with `ClientRaceMatch` / `ClientGame` and the
//      result is structurally the body of a `Delta<Room, Player>` (minus
//      `seq`/`type`, which the emitter stamps).
//
//   2. WHOLE-PLAYER, not field-level sub-diff. When a player is included, the
//      delta carries that player's FULL current projection, not just the fields
//      that changed. This matches design.md ("a player appears in `players`
//      only if any UI_Field changed … Field-level sub-diffing is an available
//      later refinement, not required") and keeps apply trivial: merging the
//      full projection over the previous player — or adding it when new — always
//      reproduces the authoritative player exactly. The return type is still
//      `Partial<Player>` per the envelope, which a full projection satisfies.
//
//   3. The diff compares the TRIMMED snapshot only. The caller passes already
//      projected snapshots, so churny server-only fields (ranking/tie-break
//      bookkeeping, etc.) are absent by construction and can never cause a
//      player to appear in a delta (UI_FIELDS.md "Diff-surface rule").
//
//   4. EMPTY diff is representable as "no change". An all-empty diff omits every
//      field; `isEmptyDiff` lets the emitter cheaply detect it and skip the tick
//      without advancing `seq` (Req 3.8).
//
// Purity: no I/O, no mutation of the inputs, deterministic. The result is a
// freshly built object; `prev` and `next` are only read.

/**
 * Structural shape the diff operates on: a room object plus a map of players by
 * id. Both the mode's full Trimmed_Snapshots (`ClientRaceMatch`, `ClientGame`)
 * satisfy this, so one generic diff serves both modes.
 */
export type Snapshot<Room, Player> = {
	room: Room;
	players: Record<string, Player>;
};

/**
 * The change-only body of a delta (design.md): structurally the `Delta`
 * envelope minus `seq`/`type`, which the emitter stamps. Every field is
 * optional so an all-absent result represents "no change".
 *
 *   - `room`    — only the room-level fields whose value changed.
 *   - `players` — the players that joined or whose UI fields changed, each
 *                 carried as its full current projection (decision 2 above).
 *   - `removedPlayers` — ids present in `prev` but absent from `next`.
 */
export type DiffResult<Room, Player> = {
	room?: Partial<Room>;
	players?: Record<string, Partial<Player>>;
	removedPlayers?: string[];
};

/**
 * Structural deep-equality for the small primitive / object / array values that
 * trimmed DTO fields hold (e.g. `revealed_letters`, `display_queue`,
 * `attackQueueView`, `lastFeedback`). Used so an object- or array-valued field
 * that is structurally unchanged does NOT register as a change and falsely pull
 * a player into a delta.
 *
 * Kept local and dependency-free (no suitable direct dependency exists in the
 * workspace). Handles the value shapes trimmed DTOs actually carry: primitives,
 * plain objects, and arrays. `NaN` is treated as equal to itself (so a numeric
 * field holding `NaN` does not look perpetually changed); `null`/`undefined`
 * are distinguished only from each other and from other values.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;

	// Same-reference and primitive-equality handled above; `NaN === NaN` is
	// false, so treat two NaNs as equal here.
	if (typeof a === "number" && typeof b === "number") {
		return Number.isNaN(a) && Number.isNaN(b);
	}

	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}

	const aIsArray = Array.isArray(a);
	const bIsArray = Array.isArray(b);
	if (aIsArray !== bIsArray) return false;

	if (aIsArray && bIsArray) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}

	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
		if (!deepEqual(aObj[key], bObj[key])) return false;
	}
	return true;
};

/**
 * Diffs two room objects, returning ONLY the fields whose value changed
 * (shallow per-field compare, deep-equal on each field's value so object/array
 * fields don't register false changes). Returns `undefined` when nothing
 * changed, so the caller can omit `room` from the delta entirely.
 *
 * The union of keys from both objects is walked, so a field going from present
 * to absent (or vice versa) is detected and carried as its new value.
 */
const diffRoom = <Room>(prev: Room, next: Room): Partial<Room> | undefined => {
	const changed: Partial<Room> = {};
	let hasChange = false;

	const prevObj = prev as Record<string, unknown>;
	const nextObj = next as Record<string, unknown>;
	const keys = new Set<string>([
		...Object.keys(prevObj),
		...Object.keys(nextObj),
	]);

	for (const key of keys) {
		if (!deepEqual(prevObj[key], nextObj[key])) {
			(changed as Record<string, unknown>)[key] = nextObj[key];
			hasChange = true;
		}
	}

	return hasChange ? changed : undefined;
};

/**
 * Whether a diff result represents no change at all — no room-level change, no
 * added/changed player, and no removal. The emitter uses this to skip an empty
 * tick without advancing `seq` (Req 3.8).
 */
export const isEmptyDiff = <Room, Player>(
	diff: DiffResult<Room, Player>,
): boolean =>
	diff.room === undefined &&
	diff.players === undefined &&
	diff.removedPlayers === undefined;

/**
 * Pure trimmed-snapshot diff (Req 3.3, 3.4, 3.8).
 *
 * Compares two already-trimmed snapshots and returns the change-only delta
 * body:
 *   - `room`: only the room-level fields that changed (omitted if none).
 *   - `players`: each player present in `next` that is NEW or whose projection
 *     changed vs `prev`, carried as its full current projection (omitted if
 *     none). A player whose trimmed fields are all unchanged is omitted — so a
 *     player appears only when a rendered field of theirs changed
 *     (UI_FIELDS.md diff-surface rule).
 *   - `removedPlayers`: ids present in `prev` but absent from `next` (omitted if
 *     none).
 *
 * An all-empty diff omits every field; test it with `isEmptyDiff`. Inputs are
 * never mutated.
 */
export const diffSnapshot = <Room, Player>(
	prev: Snapshot<Room, Player>,
	next: Snapshot<Room, Player>,
): DiffResult<Room, Player> => {
	const result: DiffResult<Room, Player> = {};

	// Room-level changed fields.
	const roomDiff = diffRoom(prev.room, next.room);
	if (roomDiff !== undefined) {
		result.room = roomDiff;
	}

	// Added / changed players: everything in `next` that is new or differs.
	const changedPlayers: Record<string, Partial<Player>> = {};
	let hasPlayerChange = false;
	for (const id of Object.keys(next.players)) {
		const nextPlayer = next.players[id];
		// `id` comes from `Object.keys(next.players)`, so the entry is always
		// present; the guard is only to satisfy `noUncheckedIndexedAccess` in
		// stricter consumers (e.g. the client typecheck).
		if (nextPlayer === undefined) continue;
		const prevPlayer = prev.players[id];
		// New player (not in prev) OR an existing player whose projection
		// changed. Carry the FULL current projection either way (decision 2).
		if (prevPlayer === undefined || !deepEqual(prevPlayer, nextPlayer)) {
			changedPlayers[id] = nextPlayer;
			hasPlayerChange = true;
		}
	}
	if (hasPlayerChange) {
		result.players = changedPlayers;
	}

	// Removed players: ids in `prev` no longer present in `next`.
	const removed: string[] = [];
	for (const id of Object.keys(prev.players)) {
		if (!Object.prototype.hasOwnProperty.call(next.players, id)) {
			removed.push(id);
		}
	}
	if (removed.length > 0) {
		result.removedPlayers = removed;
	}

	return result;
};

// --- Pure client apply (realtime-broadcast-scaling, task 5.2) ----------------
//
// `applyDelta` is the CLIENT-side counterpart to `diffSnapshot`: given the
// client's current Trimmed_Snapshot and a change-only delta body, it returns the
// NEW snapshot, leaving the input untouched (Req 4.2, 4.6). The two halves live
// together so they stay consistent and the equivalence property test (task 5.3)
// can import both — composing `applyDelta(state, diffSnapshot(prev, next))`.
//
// Design decisions (mirroring `diffSnapshot` so the pair round-trips):
//
//   1. GENERIC / cross-mode. Like the diff, apply is `applyDelta<Room, Player>`
//      operating STRUCTURALLY on `{ room, players }`; it never imports a mode's
//      DTO. The sequence-aware reducer (task 7) calls it with `ClientRaceMatch`
//      / `ClientGame`.
//
//   2. Accepts the CHANGE-ONLY body (`DiffResult`), i.e. the `Delta` envelope
//      minus `seq`/`type`. The reducer strips the envelope and passes the body,
//      so `applyDelta` composes directly with `diffSnapshot`'s output.
//
//   3. ROOM — shallow merge. The delta carries each changed room field's FULL
//      new value (diff decision: whole-value per field, not a nested sub-diff),
//      so spreading the room partial over the current room reproduces the
//      authoritative room exactly. A field the delta carries as `undefined`
//      (present -> absent, see `diffRoom`) is written as `undefined`, matching
//      what the diff recorded.
//
//   4. PLAYERS — merge the delta's projection over the previous player (or add
//      it when new). Because the diff carries each included player's FULL
//      current projection (whole-player, not a field-level sub-diff — decision 2
//      in the diff header), merging the projection over the previous entry and
//      replacing it are equivalent. The shallow merge is kept as the safe
//      general form: it is correct for the whole-player projection today and
//      still correct if the diff is later refined to field-level sub-diffs.
//
//   5. REMOVALS — delete every id in `removedPlayers` from the new players map,
//      so the client's opponents view matches the authoritative field (Req
//      4.6). Removal is applied AFTER the merge so an id that (pathologically)
//      appears in both `players` and `removedPlayers` ends up removed.
//
//   6. EMPTY delta is a NO-OP. An all-absent delta yields a snapshot deep-equal
//      to the input (Req 3.8 — the emitter skips empty ticks, but applying one
//      must still be identity). The result is always a freshly built object;
//      the input `state` and the `delta` are only read, never mutated (Req 4.2).

/**
 * Pure client apply (Req 4.2, 4.6).
 *
 * Merges a change-only delta body onto the client's current Trimmed_Snapshot
 * and returns the NEW snapshot without mutating the input:
 *   - room: shallow-merge the changed room fields over the current room.
 *   - players: for each entry in `delta.players`, merge its projection over the
 *     current player (or add it when new).
 *   - removedPlayers: delete each listed id from the players map.
 *
 * Applying an empty delta returns a snapshot deep-equal to `state`. `state` and
 * `delta` are never mutated; a fresh snapshot (with fresh `room`/`players`
 * objects) is returned.
 */
export const applyDelta = <Room, Player>(
	state: Snapshot<Room, Player>,
	delta: DiffResult<Room, Player>,
): Snapshot<Room, Player> => {
	// Shallow-merge changed room fields over the current room (decision 3).
	// When `delta.room` is absent, the room is carried through unchanged (still
	// a fresh object so the result shares no reference with the input).
	const room: Room =
		delta.room === undefined
			? { ...state.room }
			: { ...state.room, ...delta.room };

	// Start from a fresh copy of the current players map, then merge/add the
	// delta's players and apply removals (decisions 4, 5).
	const players: Record<string, Player> = { ...state.players };

	if (delta.players !== undefined) {
		for (const id of Object.keys(delta.players)) {
			const incoming = delta.players[id];
			const existing = players[id];
			// Merge the (full) projection over the previous player, or add it
			// when the player is new. Both yield the same result for the
			// whole-player projection the diff carries today.
			players[id] =
				existing === undefined
					? ({ ...incoming } as Player)
					: ({ ...existing, ...incoming } as Player);
		}
	}

	if (delta.removedPlayers !== undefined) {
		for (const id of delta.removedPlayers) {
			delete players[id];
		}
	}

	return { room, players };
};
