import type { Namespace } from "socket.io";
import type {
  ClientRaceMatch,
  ClientRacePlayer,
  ClientRaceRoom,
  RaceMatch,
  RacePlayer,
  RaceRoom,
} from "types/race.types.js";
import type { RaceDelta, RaceKeyframe } from "types/broadcast.types.js";
import { stampDelta, stampKeyframe } from "shared/broadcast-emit.js";
import {
  broadcastBytes,
  recordBroadcast,
  roomSocketCount,
} from "../../telemetry/strain.js";
import { config, serverOnlyData } from "./state.js";

/**
 * Projects one authoritative `RaceRoom` onto the trimmed `ClientRaceRoom` DTO
 * (realtime-broadcast-scaling Req 2). Copies ONLY the keep-list room fields the
 * client renders — `createdAt` is server-only and deliberately dropped. Returns
 * a NEW object; the live `match.room` is never mutated (Req 2.4).
 */
const projectRaceRoom = (room: RaceRoom): ClientRaceRoom => ({
  matchId: room.matchId,
  shareCode: room.shareCode,
  phase: room.phase,
  currentRoundIndex: room.currentRoundIndex,
  roundEndsAt: room.roundEndsAt,
  nextRoundStartsAt: room.nextRoundStartsAt,
  lobbyDeadline: room.lobbyDeadline,
  winnerId: room.winnerId,
  isDraw: room.isDraw,
});

/**
 * Projects one authoritative `RacePlayer` onto the trimmed `ClientRacePlayer`
 * DTO (realtime-broadcast-scaling Req 2). Copies ONLY the keep-list fields the
 * client renders — the server-only ranking/tie-break bookkeeping
 * (`qualifiedAt`, `roundGuesses`, `correctLetters`, `correctPositionsFound`,
 * `eliminatedAt`, `statsPersisted`) and `isBot` (no client component branches
 * on it) are dropped. Keyboard hint sets for the player's OWN board travel on
 * the `guess:ack` path, not here. Returns a NEW object; the live player is
 * never mutated (Req 2.4).
 */
const projectRacePlayer = (player: RacePlayer): ClientRacePlayer => ({
  name: player.name,
  isEliminated: player.isEliminated,
  isAnonymous: player.isAnonymous,
  completedWords: player.completedWords,
  qualified: player.qualified,
  totalGuesses: player.totalGuesses,
  correctGuesses: player.correctGuesses,
  placement: player.placement,
  revealedWord: player.revealedWord,
  hintRevealed: player.hintRevealed,
  lastFeedback: player.lastFeedback,
});

/**
 * Projects a server-side `RaceMatch` onto the trimmed, client-facing
 * `ClientRaceMatch` so it can be JSON-serialized over Socket.IO
 * (realtime-broadcast-scaling Req 2). This is the SINGLE projection point: both
 * the `join:ack` snapshot and the per-tick `race:update` broadcast serialize
 * through it, so the client applies one shape (Req 2.7).
 *
 * The payload carries only UI_Fields — the keep-lists audited in this spec's
 * `UI_FIELDS.md` and encoded as the `ClientRaceRoom` / `ClientRacePlayer` DTOs
 * (`Pick`s of the authoritative types). Non_UI_Fields and server-only state
 * never reach the wire (Req 2.1, 2.3). The projection builds entirely new
 * objects — the live `RaceMatch`, its `room`, and its players are read but
 * never mutated (Req 2.4), and the `Map` is turned into a plain `Record`.
 */
export const serializeRaceMatch = (match: RaceMatch): ClientRaceMatch => {
  const players: Record<string, ClientRacePlayer> = {};
  for (const [id, player] of match.players) {
    players[id] = projectRacePlayer(player);
  }

  return {
    room: projectRaceRoom(match.room),
    players,
  };
};

/**
 * Decide WHAT a trailing-edge `race:update` carries this tick
 * (realtime-broadcast-scaling, Req 3.3, 3.5, 3.6, 3.8, 5.5). Pure w.r.t.
 * Socket.IO — it only reads the match, consults the delta flag, and advances
 * the room's `broadcastVersion`; the caller (`emitRaceUpdate`) does the emit.
 *
 *   - flag OFF → returns the full Trimmed_Snapshot (`ClientRaceMatch`) EXACTLY
 *     as before and touches NO version state (byte-identical, Req 5.5).
 *   - flag ON, but the room has no version yet OR has hit the forced-keyframe
 *     bound (`ticksSinceKeyframe >= config.keyframeIntervalTicks`) → stamps a
 *     KEYFRAME via `buildRaceKeyframePayload` (first tick establishes
 *     `lastSent`; the cadence bounds client drift, Req 3.6).
 *   - flag ON, otherwise → diffs current vs `lastSent` via `stampDelta`. An
 *     empty diff is a SKIP (`undefined`): emit nothing, version UNCHANGED
 *     (Req 3.8). A non-empty diff returns the `RaceDelta` envelope and advances
 *     the version (seq+1, ticksSinceKeyframe+1, lastSent updated).
 *
 * Returns `undefined` ONLY in the skip case; every other case returns a payload
 * to emit on `race:update`.
 */
const buildRaceUpdatePayload = (
  match: RaceMatch,
): ClientRaceMatch | RaceKeyframe | RaceDelta | undefined => {
  if (!config.deltaBroadcastEnabled) {
    return serializeRaceMatch(match);
  }

  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  const version = roomServerOnlyData?.broadcastVersion;

  // No base yet, or the forced-keyframe cadence is due → emit a keyframe.
  // `buildRaceKeyframePayload` stamps + stores the advanced version itself.
  if (
    version === undefined ||
    version.lastSent === undefined ||
    version.ticksSinceKeyframe >= config.keyframeIntervalTicks
  ) {
    return buildRaceKeyframePayload(match);
  }

  const snapshot = serializeRaceMatch(match);
  const stamped = stampDelta(version, snapshot);
  if (stamped.skip) {
    return undefined;
  }
  if (roomServerOnlyData) {
    roomServerOnlyData.broadcastVersion = stamped.version;
  }
  return stamped.envelope;
};

/**
 * Immediately broadcasts the current match state to every socket in the lobby's
 * room via `race:update` (Req 10.1, 10.2). Sends on the `/race` namespace so
 * Race events stay isolated from Battle Royale and Duels.
 *
 * With the delta flag OFF this is byte-identical to its pre-delta behavior: the
 * full Trimmed_Snapshot every tick (Req 5.5). With it ON the payload is a
 * keyframe (first tick / forced cadence) or a change-only delta, and an empty
 * tick is skipped entirely — no emit, no telemetry (Req 3.8). The payload shape
 * changes; the trailing-edge tick cadence does not (Req 3.5).
 */
export const emitRaceUpdate = (nsp: Namespace, match: RaceMatch) => {
  const roomId = match.room.matchId;
  const payload = buildRaceUpdatePayload(match);

  // Empty-tick skip (Req 3.8): nothing changed since the last broadcast, so no
  // payload goes out and no fan-out is recorded. The Update_Window still ticked.
  if (payload === undefined) {
    return;
  }

  nsp.to(roomId).emit("race:update", payload);

  // Strain_Telemetry (Req 1.3, 1.6): record this Broadcast_Tick's cost after
  // the payload is serialized. `recordBroadcast` only accumulates (never logs
  // per tick) and swallows its own errors; the byte/recipient reads below are
  // likewise fenced so a telemetry fault can never alter the emitted payload or
  // drop a Broadcast_Tick. `recipients` is the room's socket count.
  recordBroadcast({
    mode: "race",
    roomId,
    bytes: broadcastBytes(payload),
    recipients: roomSocketCount(nsp.adapter, roomId),
  });
};

/**
 * Stamp and store a KEYFRAME for the match, returning the payload to emit
 * (realtime-broadcast-scaling, Req 3.2, 3.6).
 *
 * This is the SHARED core of every keyframe emission point (join / reconnect,
 * round transition, forced-keyframe cadence, resync reply). It decides WHAT
 * goes on the wire based on the delta flag and advances the per-room version;
 * the caller decides WHERE it goes (a room broadcast vs a single-socket
 * `join:ack` reply) and whether to record telemetry — so flag-off stays
 * byte-identical to each call site's pre-delta behavior.
 *
 * Wire protocol (design.md "the join:ack snapshot now carries seq"): keyframe
 * and delta ride the SAME event name as today. So:
 *   - flag OFF → returns the full Trimmed_Snapshot (`ClientRaceMatch`) EXACTLY
 *     as before, and does NOT touch version state (Req 5.5 / task 8.1).
 *   - flag ON  → lazily initializes the room's `broadcastVersion` (seq starts
 *     at 0, so the first keyframe is `seq: 1`), stamps the keyframe with the
 *     incremented `seq`, RESETS `ticksSinceKeyframe` to 0, stores the snapshot
 *     as `lastSent` for the delta emitter (task 6.2) to diff against, and
 *     returns the `RaceKeyframe` envelope. The version lives on the server-only
 *     record so `cleanupMatch` drops it automatically (Req 5.2).
 *
 * The returned payload is the full snapshot or the envelope — the caller emits
 * it under the appropriate event name.
 */
export const buildRaceKeyframePayload = (
  match: RaceMatch,
): ClientRaceMatch | RaceKeyframe => {
  const snapshot = serializeRaceMatch(match);

  if (!config.deltaBroadcastEnabled) {
    return snapshot;
  }

  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);
  const { envelope, version } = stampKeyframe(
    roomServerOnlyData?.broadcastVersion,
    snapshot,
  );
  if (roomServerOnlyData) {
    roomServerOnlyData.broadcastVersion = version;
  }
  return envelope;
};

/**
 * Emit a KEYFRAME to every socket in the match's room via `race:update`
 * (realtime-broadcast-scaling, Req 3.2). Used at the room-broadcast keyframe
 * points — round transition and the forced-keyframe cadence (task 6.2 calls
 * this when `ticksSinceKeyframe` reaches `config.keyframeIntervalTicks`).
 *
 * With the delta flag OFF this is byte-identical to `emitRaceUpdate`: same
 * event, same full-snapshot payload, same telemetry. With it ON it emits the
 * keyframe envelope and advances the room's version. Telemetry records the
 * one Broadcast_Tick's cost on whatever payload actually went on the wire.
 */
export const emitRaceKeyframe = (nsp: Namespace, match: RaceMatch) => {
  const roomId = match.room.matchId;
  const payload = buildRaceKeyframePayload(match);

  nsp.to(roomId).emit("race:update", payload);

  recordBroadcast({
    mode: "race",
    roomId,
    bytes: broadcastBytes(payload),
    recipients: roomSocketCount(nsp.adapter, roomId),
  });
};

/**
 * Coalesces state broadcasts: schedules at most one `race:update` per
 * `config.updateWindowMs` window per lobby, so a burst of guesses/progress
 * during a round cannot flood clients (Req 4.7, 3.6). Follows Battle Royale's
 * trailing-edge approach — the first call arms the room's `updateTicker`,
 * subsequent calls within the window are dropped, and the timer fires a single
 * broadcast then clears itself.
 */
export const scheduleRaceUpdate = (nsp: Namespace, match: RaceMatch) => {
  const roomServerOnlyData = serverOnlyData.get(match.room.matchId);

  if (!roomServerOnlyData) {
    return;
  }

  if (roomServerOnlyData.timers.updateTicker) {
    return;
  }

  roomServerOnlyData.timers.updateTicker = setTimeout(() => {
    roomServerOnlyData.timers.updateTicker = undefined;

    emitRaceUpdate(nsp, match);
  }, config.updateWindowMs);
};

/**
 * Broadcasts updated lobby membership to every Player in the lobby when a
 * Player joins (Req 3.6). Membership changes are user-visible and low-frequency
 * (bounded by lobby size), so this broadcasts immediately rather than through
 * the coalescing window used for high-frequency round progress.
 */
export const broadcastLobbyMembership = (nsp: Namespace, match: RaceMatch) => {
  emitRaceUpdate(nsp, match);
};
