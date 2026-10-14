import type { Server } from "socket.io";
import type {
  ClientBattleRoyalePlayer,
  ClientBattleRoyaleRoom,
  ClientGame,
  Game,
  PlayerDisplay,
  Room,
} from "types/battle-royale.types.js";
import type {
  BattleRoyaleDelta,
  BattleRoyaleKeyframe,
} from "types/broadcast.types.js";
import { stampDelta, stampKeyframe } from "shared/broadcast-emit.js";
import {
  broadcastBytes,
  recordBroadcast,
  roomSocketCount,
} from "../../telemetry/strain.js";
import {
  DELTA_BROADCAST_ENABLED,
  GAME_UPDATE_DELAY,
  KEYFRAME_INTERVAL_TICKS,
  serverOnlyData,
} from "./state.js";

/**
 * Projects one authoritative `Room` onto the trimmed `ClientBattleRoyaleRoom`
 * DTO (realtime-broadcast-scaling Req 2). Copies ONLY the keep-list room fields
 * the client renders — `createdAt` is server-only and deliberately dropped.
 * Returns a NEW object; the live `game.room` is never mutated (Req 2.4).
 */
const projectRoom = (room: Room): ClientBattleRoyaleRoom => ({
  lobbyId: room.lobbyId,
  shareCode: room.shareCode,
  startTime: room.startTime,
  isStarted: room.isStarted,
  isFinished: room.isFinished,
  winnerId: room.winnerId,
  isDraw: room.isDraw,
  matchEndTime: room.matchEndTime,
});

/**
 * Projects one authoritative `PlayerDisplay` onto the trimmed
 * `ClientBattleRoyalePlayer` DTO (realtime-broadcast-scaling Req 2). Copies
 * ONLY the keep-list fields the client renders — `endTimeStamp` (survival time
 * is derived from `life`) and `statsPersisted` (server-only bookkeeping) are
 * dropped. Returns a NEW object; the live player is never mutated (Req 2.4).
 *
 * `revealed_letters` is dropped for ELIMINATED players: no client surface reads
 * it for them (eliminated opponents are filtered out of the opponents grid, and
 * an eliminated player's own board is covered by the `Eliminated` overlay, which
 * reads none of these letters). On elimination the server fills this map with
 * the whole solution word, so keeping it would re-broadcast a full-word map for
 * every eliminated slot in every keyframe for the rest of the match — the bulk
 * of the keyframe growth observed in prod. Dropping it keeps dead slots light.
 */
const projectPlayer = (
  player: PlayerDisplay,
): ClientBattleRoyalePlayer => ({
  name: player.name,
  revealed_letters: player.isEliminated ? undefined : player.revealed_letters,
  partialMatches: player.partialMatches,
  noMatch: player.noMatch,
  display_queue: player.display_queue,
  isEliminated: player.isEliminated,
  // Set once at the moment of outcome; carries the eliminated player's word and
  // this game's points to the end screen. Undefined (and thus absent-valued)
  // for living players.
  revealedWord: player.revealedWord,
  points: player.points,
  life: player.life,
  totalGuesses: player.totalGuesses,
  correctGuesses: player.correctGuesses,
  currentWordGuesses: player.currentWordGuesses,
  lastAttackerName: player.lastAttackerName,
  currentWordIsAttack: player.currentWordIsAttack,
  currentWordAttackerName: player.currentWordAttackerName,
  attackQueueView: player.attackQueueView,
  attackCementAt: player.attackCementAt,
});

/**
 * Projects a server-side `Game` onto the trimmed, client-facing `ClientGame`
 * so it can be JSON-serialized over Socket.IO (realtime-broadcast-scaling
 * Req 2). This is the SINGLE projection point for Battle Royale: the `join:ack`
 * snapshot and every `lobby:update` broadcast serialize through it, so the
 * client applies one shape (Req 2.6, 2.7).
 *
 * The payload carries only UI_Fields — the keep-lists audited in this spec's
 * `UI_FIELDS.md` and encoded as the `ClientBattleRoyaleRoom` /
 * `ClientBattleRoyalePlayer` DTOs (`Pick`s of the authoritative types).
 * Non_UI_Fields and server-only state never reach the wire (Req 2.1, 2.3). The
 * projection builds entirely new objects — the live `Game`, its `room`, and its
 * players are read but never mutated (Req 2.4), and the `Map` is turned into a
 * plain `Record`.
 */
export const serializeGame = (game: Game): ClientGame => {
  const players: Record<string, ClientBattleRoyalePlayer> = {};
  for (const [id, player] of game.players) {
    players[id] = projectPlayer(player);
  }

  return {
    room: projectRoom(game.room),
    players,
  };
};

/**
 * Decide WHAT a trailing-edge `lobby:update` carries this tick
 * (realtime-broadcast-scaling, Req 3.3, 3.5, 3.6, 3.8, 5.5). Battle Royale
 * mirror of Race's `buildRaceUpdatePayload` — both modes share the model
 * (Req 3.7). Pure w.r.t. Socket.IO: reads the game, consults the delta flag,
 * and advances the room's `broadcastVersion`; the caller does the emit.
 *
 *   - flag OFF → returns the full Trimmed_Snapshot (`ClientGame`) EXACTLY as
 *     before and touches NO version state (byte-identical, Req 5.5).
 *   - flag ON, but the room has no version yet OR has hit the forced-keyframe
 *     bound (`ticksSinceKeyframe >= KEYFRAME_INTERVAL_TICKS`) → stamps a
 *     KEYFRAME via `buildBattleRoyaleKeyframePayload` (first tick establishes
 *     `lastSent`; the cadence bounds client drift, Req 3.6).
 *   - flag ON, otherwise → diffs current vs `lastSent` via `stampDelta`. An
 *     empty diff is a SKIP (`undefined`): emit nothing, version UNCHANGED
 *     (Req 3.8). A non-empty diff returns the `BattleRoyaleDelta` envelope and
 *     advances the version (seq+1, ticksSinceKeyframe+1, lastSent updated).
 *
 * Returns `undefined` ONLY in the skip case.
 */
const buildBattleRoyaleUpdatePayload = (
  roomId: string,
  game: Game,
): ClientGame | BattleRoyaleKeyframe | BattleRoyaleDelta | undefined => {
  if (!DELTA_BROADCAST_ENABLED) {
    return serializeGame(game);
  }

  const roomServerOnlyData = serverOnlyData.get(roomId);
  const version = roomServerOnlyData?.broadcastVersion;

  // No base yet, or the forced-keyframe cadence is due → emit a keyframe.
  // `buildBattleRoyaleKeyframePayload` stamps + stores the advanced version.
  if (
    version === undefined ||
    version.lastSent === undefined ||
    version.ticksSinceKeyframe >= KEYFRAME_INTERVAL_TICKS
  ) {
    return buildBattleRoyaleKeyframePayload(roomId, game);
  }

  const snapshot = serializeGame(game);
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
 * Immediately broadcasts the current lobby/game state to a room via
 * `lobby:update`.
 *
 * With the delta flag OFF this is byte-identical to its pre-delta behavior: the
 * full Trimmed_Snapshot every tick (Req 5.5). With it ON the payload is a
 * keyframe (first tick / forced cadence) or a change-only delta, and an empty
 * tick is skipped entirely — no emit, no telemetry (Req 3.8). The payload shape
 * changes; the trailing-edge tick cadence does not (Req 3.5).
 */
export const emitLobbyUpdate = (io: Server, roomId: string, game: Game) => {
  const payload = buildBattleRoyaleUpdatePayload(roomId, game);

  // Empty-tick skip (Req 3.8): nothing changed since the last broadcast, so no
  // payload goes out and no fan-out is recorded. The Update_Window still ticked.
  if (payload === undefined) {
    return;
  }

  io.to(roomId).emit("lobby:update", payload);

  // Strain_Telemetry (Req 1.3, 1.6): record this Broadcast_Tick's cost after
  // the payload is serialized. `recordBroadcast` only accumulates (never logs
  // per tick) and swallows its own errors; the byte/recipient reads are
  // likewise fenced so a telemetry fault can never alter the emitted payload or
  // drop a Broadcast_Tick. `recipients` is the room's socket count.
  recordBroadcast({
    mode: "battle-royale",
    roomId,
    bytes: broadcastBytes(payload),
    recipients: roomSocketCount(io.sockets?.adapter, roomId),
  });
};

/**
 * Stamp and store a KEYFRAME for the game, returning the payload to emit
 * (realtime-broadcast-scaling, Req 3.2, 3.6). Battle Royale mirror of Race's
 * `buildRaceKeyframePayload` — both modes share the keyframe model (Req 3.7).
 *
 * This is the SHARED core of every keyframe emission point (join / reconnect,
 * phase transition — game start, forced-keyframe cadence, resync reply). It
 * decides WHAT goes on the wire based on the delta flag and advances the
 * per-room version; the caller decides WHERE it goes (room broadcast vs a
 * single-socket `join:ack`) so flag-off stays byte-identical per call site.
 *
 * Wire protocol (design.md "the join:ack snapshot now carries seq"): keyframe
 * and delta ride the SAME event name as today. So:
 *   - flag OFF → returns the full Trimmed_Snapshot (`ClientGame`) EXACTLY as
 *     before, and does NOT touch version state (Req 5.5 / task 8.1).
 *   - flag ON  → lazily initializes the room's `broadcastVersion` (seq starts
 *     at 0, so the first keyframe is `seq: 1`), stamps the keyframe with the
 *     incremented `seq`, RESETS `ticksSinceKeyframe` to 0, stores the snapshot
 *     as `lastSent` for the delta emitter (task 6.2) to diff against, and
 *     returns the `BattleRoyaleKeyframe` envelope. The version lives on the
 *     server-only record so `cleanupGame` drops it automatically (Req 5.2).
 */
export const buildBattleRoyaleKeyframePayload = (
  roomId: string,
  game: Game,
): ClientGame | BattleRoyaleKeyframe => {
  const snapshot = serializeGame(game);

  if (!DELTA_BROADCAST_ENABLED) {
    return snapshot;
  }

  const roomServerOnlyData = serverOnlyData.get(roomId);
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
 * Emit a KEYFRAME to every socket in the room via `lobby:update`
 * (realtime-broadcast-scaling, Req 3.2). Used at the room-broadcast keyframe
 * points — phase transition (game start) and the forced-keyframe cadence
 * (task 6.2 calls this when `ticksSinceKeyframe` reaches
 * `KEYFRAME_INTERVAL_TICKS`).
 *
 * With the delta flag OFF this is byte-identical to `emitLobbyUpdate`: same
 * event, same full-snapshot payload, same telemetry. With it ON it emits the
 * keyframe envelope and advances the room's version. Telemetry records the one
 * Broadcast_Tick's cost on whatever payload actually went on the wire.
 */
export const emitBattleRoyaleKeyframe = (
  io: Server,
  roomId: string,
  game: Game,
) => {
  const payload = buildBattleRoyaleKeyframePayload(roomId, game);

  io.to(roomId).emit("lobby:update", payload);

  recordBroadcast({
    mode: "battle-royale",
    roomId,
    bytes: broadcastBytes(payload),
    recipients: roomSocketCount(io.sockets?.adapter, roomId),
  });
};

/**
 * Coalesces lobby updates: schedules at most one broadcast per
 * `GAME_UPDATE_DELAY` window per room to avoid flooding clients.
 */
export const scheduleLobbyUpdate = (io: Server, roomId: string, game: Game) => {
  const roomServerOnlyData = serverOnlyData.get(roomId);

  if (!roomServerOnlyData) {
    return;
  }

  if (roomServerOnlyData.timers.updateTicker) {
    return;
  }

  roomServerOnlyData.timers.updateTicker = setTimeout(() => {
    roomServerOnlyData.timers.updateTicker = undefined;

    emitLobbyUpdate(io, roomId, game);
  }, GAME_UPDATE_DELAY);
};
