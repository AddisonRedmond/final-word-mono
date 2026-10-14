// --- Versioned broadcast envelopes (realtime-broadcast-scaling, Req 3) -------
//
// Every state broadcast for a room is wrapped in a versioned envelope so the
// client can detect missed or out-of-order payloads and rebase via a resync.
// There are two envelope variants, both stamped with a per-room, monotonically
// increasing `seq` (Req 3.1):
//
//   - Keyframe: a full Trimmed_Snapshot (complete room + players), sent on
//     join / reconnect / round transition / forced-keyframe cadence / resync
//     (Req 3.2). The client replaces its local state with it and rebases.
//   - Delta: only what changed since the previous Broadcast_Tick for that room
//     (Req 3.3) — changed room-level fields, changed/added players, and the
//     ids of removed players. Every field is optional, so an all-absent delta
//     is a representable "no change" (which the emitter may skip, Req 3.8).
//
// Design decision — one GENERIC envelope, not a Race one and a BR one.
// Battle Royale and Race share the exact keyframe/delta/resync model (Req 3.7),
// differing only in the room/player DTO shapes they carry. So the envelope is
// parameterised by `Room` and `Player`, and each mode gets a thin alias
// (`RaceEnvelope`, `BattleRoyaleEnvelope`) binding its trimmed DTOs. This keeps
// a single definition of the protocol shared by client and server, while the
// trim/diff logic stays mode-specific through the type parameters.
//
// The parameters are the mode's TRIMMED DTOs (e.g. `ClientRaceRoom` /
// `ClientRacePlayer`), so the envelope can only ever carry wire-trimmed fields
// — a non-UI field cannot appear in a keyframe or a delta by construction.

import type {
  ClientRaceRoom,
  ClientRacePlayer,
  ClientRaceMatch,
} from "./race.types.js";
import type {
  ClientBattleRoyaleRoom,
  ClientBattleRoyalePlayer,
  ClientGame,
} from "./battle-royale.types.js";

/**
 * A full Trimmed_Snapshot of a room, stamped with its sequence number. The
 * client replaces its local state with the keyframe and records `seq` as its
 * new base (Req 3.2, 4.1). `Room` / `Player` are the mode's trimmed DTOs.
 */
export type Keyframe<Room, Player> = {
  seq: number;
  type: "keyframe";
  room: Room;
  players: Record<string, Player>;
};

/**
 * A change-only payload carrying what differs from the previous Broadcast_Tick
 * for a room, stamped with its sequence number (Req 3.3, 3.4):
 *   - `room`    — only the room-level fields that changed (partial of the DTO).
 *   - `players` — only the players that joined or whose UI fields changed; each
 *                 entry is a partial of the player DTO (deltas carry just the
 *                 changed fields).
 *   - `removedPlayers` — ids of players no longer in the authoritative field,
 *                 so applying the delta reproduces the exact player set.
 * Every field is optional: an all-absent delta represents "no change" and need
 * not be sent (Req 3.8).
 */
export type Delta<Room, Player> = {
  seq: number;
  type: "delta";
  room?: Partial<Room>;
  players?: Record<string, Partial<Player>>;
  removedPlayers?: string[];
};

/**
 * The broadcast envelope: either a Keyframe or a Delta. One generic protocol
 * shape for both modes (Req 3.7); narrow on `type`.
 */
export type BroadcastEnvelope<Room, Player> =
  | Keyframe<Room, Player>
  | Delta<Room, Player>;

// --- Mode-specific aliases ---------------------------------------------------
// Bind the generic envelope to each mode's trimmed DTOs. Client and server
// import these so both ends share one definition per mode.

export type RaceKeyframe = Keyframe<ClientRaceRoom, ClientRacePlayer>;
export type RaceDelta = Delta<ClientRaceRoom, ClientRacePlayer>;
export type RaceEnvelope = BroadcastEnvelope<ClientRaceRoom, ClientRacePlayer>;

export type BattleRoyaleKeyframe = Keyframe<
  ClientBattleRoyaleRoom,
  ClientBattleRoyalePlayer
>;
export type BattleRoyaleDelta = Delta<
  ClientBattleRoyaleRoom,
  ClientBattleRoyalePlayer
>;
export type BattleRoyaleEnvelope = BroadcastEnvelope<
  ClientBattleRoyaleRoom,
  ClientBattleRoyalePlayer
>;

// --- Per-room broadcast version state (realtime-broadcast-scaling, Req 3.1) --
//
// Server-only bookkeeping the delta emitter keeps for each room so it can stamp
// monotonic sequence numbers, honour the forced-keyframe cadence, and diff the
// current Trimmed_Snapshot against the one it last sent. It lives next to the
// room's other server-only state (`RaceRoomServerData.broadcastVersion` /
// `RoomServerData.broadcastVersion`), so it is dropped automatically when the
// room's server-only entry is deleted in `cleanupMatch` / `cleanupGame` (Req
// 5.2 — the authoritative per-room maps are untouched; this is server-only).
//
// This task defines the shape and wires the cleanup only. No field is read or
// mutated yet — seq incrementing happens in the keyframe/delta emitter (task 6)
// and `lastSent` is produced by the diff (task 5).
//
// `Snapshot` is the mode's FULL Trimmed_Snapshot (`ClientRaceMatch` for Race,
// `ClientGame` for Battle Royale) — the exact shape the diff (task 5.1)
// compares current-vs-last-sent, so the emitter stores whatever it will diff.
export type BroadcastVersion<Snapshot> = {
  /** Per-room, monotonically increasing sequence number last emitted (Req 3.1). */
  seq: number;
  /**
   * Count of deltas emitted since the last keyframe. Drives the forced-keyframe
   * cadence (Req 3.6): when it reaches the configured bound the next tick is a
   * keyframe. Reset to 0 on every keyframe.
   */
  ticksSinceKeyframe: number;
  /**
   * The last full Trimmed_Snapshot broadcast for this room, so the next tick can
   * diff current-vs-`lastSent` (task 5.1). Absent until the first emit.
   */
  lastSent?: Snapshot;
};

/** Race's per-room broadcast version, keyed on the trimmed `ClientRaceMatch`. */
export type RaceBroadcastVersion = BroadcastVersion<ClientRaceMatch>;

/** Battle Royale's per-room broadcast version, keyed on the trimmed `ClientGame`. */
export type BattleRoyaleBroadcastVersion = BroadcastVersion<ClientGame>;
