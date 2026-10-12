import type { BattleRoyaleBroadcastVersion } from "./broadcast.types.js";

export type TargetType = "first" | "last" | "random" | (string & {});

// Client-side selection intent for the attack picker. Distinct from the value
// sent to the server (which is always a concrete opponent UUID): "first"/"last"
// auto-track the live leader/trailer, "random" picks one opponent, and
// "player" means a specific opponent was clicked directly.
export type TargetMode = "first" | "last" | "random" | "player";

export type RevealedLetters = Record<number, string>;

// A single queued attack word plus who sent it. Replaces the old parallel
// `queue: string[]` / `attackerQueue: string[]` arrays (which had to be kept in
// lockstep); carrying the attacker name on the entry removes that fragility.
// See ATTACK_MECHANICS.md §5.2a.
export type AttackEntry = {
  word: string;
  // Display name of the attacker who sent this word; "" if unknown.
  attackerName: string;
  // Letters already revealed on THIS word, travelling with the entry so there
  // is no separate parallel array to keep aligned. Seeded by the attacker's
  // speed-scaled letter-reveal (§2.3) and grown by index-bleed (§5.2a) while
  // the word is cemented. Becomes the player's `revealed_letters` when this
  // word is consumed as the current word.
  reveal?: RevealedLetters;
};

// Client-facing projection of a single queued attack word, used to render the
// pending (ghosted + countdown) vs. cemented (solid) distinction. Deliberately
// does NOT carry the word itself — exposing an unsolved queued word would leak
// the answer. The client only needs the attacker (for the badge) and whether
// the slot is cemented (for styling); the shared batch `attackCementAt` on
// PlayerDisplay drives the single countdown shown over the pending words.
export type QueuedAttackView = {
  attackerName: string;
  cemented: boolean;
};

export type PlayerDisplay = {
  name: string;
  revealed_letters?: RevealedLetters;
  partialMatches?: string[];
  noMatch?: string[];
  display_queue?: RevealedLetters[];
  endTimeStamp?: number;
  isEliminated: boolean;
  life: number;
  totalGuesses: number;
  correctGuesses: number;
  currentWordGuesses: number;
  // Server-side bookkeeping: set once this player's aggregate stats have been
  // persisted for THIS match (at elimination, forfeit-on-leave, or finish), so
  // every real player is recorded exactly once and never double-counted across
  // the elimination/leave/finish/cleanup paths. Display-safe but read only by
  // the server.
  statsPersisted?: boolean;
  // Name of the last player to send this player an attack word. Drives the
  // "Eliminated by X" line on the results screen (who last attacked them).
  // Undefined means never attacked -> results screen shows "Timer".
  lastAttackerName?: string;
  // Mirrors the server's currentWordIsAttack so the client knows the word the
  // player is currently guessing arrived as an attack (and can badge it).
  currentWordIsAttack?: boolean;
  // Display name of the attacker who sent the word the player is CURRENTLY
  // guessing (when currentWordIsAttack). Used for the per-word attack badge,
  // which can differ from lastAttackerName when multiple attacks are queued.
  currentWordAttackerName?: string;
  // §5.2a — client-facing view of this player's queued attack words, in
  // consume order (pending first, then cemented). Pending entries render
  // ghosted under the `attackCementAt` countdown and vanish if the player
  // solves in time; cemented entries render solid and must be solved. Carries
  // no letters (see QueuedAttackView) — the client uses it only to count/style
  // slots.
  attackQueueView?: QueuedAttackView[];
  // §5.2a — absolute timestamp (ms) the current pending wave cements, or
  // undefined when there is no pending wave. Drives the single batch countdown
  // shown over the pending slots.
  attackCementAt?: number;
};

// Shared attack-queue state carried by both players and bots. Two-stage queue
// per ATTACK_MECHANICS.md §5.2a:
// - `pending`: freshly-arrived attack words still inside the batch grace window.
//   Removable by the defender's play (solve-scaled clearing, accidental match).
//   NOT yet part of the real solve cycle. Earliest (index 0) is closest to
//   cementing / removed first.
// - `cemented`: words whose grace window expired; locked into the real solve
//   cycle and consumed (index 0 first) when the player finishes their current
//   word. Only `cemented` counts against MAX_CEMENTED_ATTACK_WORDS.
// - `cementAt`: absolute timestamp (ms) at which the current pending wave
//   cements. Armed when `pending` goes empty -> non-empty and NOT reset by
//   later attacks; cleared when `pending` empties.
export type AttackQueueState = {
  pending: AttackEntry[];
  cemented: AttackEntry[];
  cementAt?: number;
};

export type PlayerServerData = {
  word: string;
  currentWordIsAttack: boolean;
} & AttackQueueState;

export type ServerPlayerData = Record<string, PlayerServerData>;

export type BotServerData = {
  word: string;
  currentWordIsAttack: boolean;
  level: 1 | 2 | 3 | 4 | 5;
  target: TargetType;
  guessTimeStamp?: number;
  botGuesses: number;
} & AttackQueueState;

export type ServerBotData = Map<
  string,
  {
    [botId: string]: BotServerData;
  }
>;
export type RoomTimers = {
  startTimer?: ReturnType<typeof setTimeout>;
  gameTimer?: ReturnType<typeof setInterval>;
  botTicker?: ReturnType<typeof setInterval>;
  updateTicker?: ReturnType<typeof setTimeout>;
  matchTimer?: ReturnType<typeof setTimeout>;
};

export type Room = {
  lobbyId: string;
  // Short, human-friendly code (e.g. "FROG-72") that resolves to this room's
  // `lobbyId`. Shared with friends so they can join the same public game via
  // the "Join Game" entry (v1 play-with-friends). The `lobbyId` UUID stays the
  // canonical id used everywhere internally; this is only the shareable handle.
  shareCode?: string;
  startTime: number;
  isStarted: boolean;
  createdAt: number;
  isFinished: boolean;
  winnerId?: string;
  isDraw: boolean;
  matchEndTime?: number;
};

export type RoomServerData = {
  playerData: ServerPlayerData;
  timers: RoomTimers;
  /**
   * Per-room delta-broadcast version state (realtime-broadcast-scaling, Req
   * 3.1): the last emitted `seq`, deltas-since-keyframe counter, and last-sent
   * Trimmed_Snapshot the emitter diffs against. Absent until the first delta
   * broadcast for the room; populated lazily by the emitter (task 6). Because
   * it lives on this server-only record, `cleanupGame` drops it automatically
   * when it deletes the room's `serverOnlyData` entry (Req 5.2).
   */
  broadcastVersion?: BattleRoyaleBroadcastVersion;
};

export type ServerOnlyData = Map<string, RoomServerData>;

export type Game = {
  room: Room;
  players: Map<string, PlayerDisplay>;
};

// --- Trimmed broadcast DTOs (realtime-broadcast-scaling, Req 2) ---------------
//
// The authoritative `Room` / `PlayerDisplay` above stay the source of truth for
// field SHAPES; these DTOs are the UI keep-list expressed as a type, projected
// off the authoritative types with `Pick`. Because the DTO is the keep-list, a
// field newly added to the authoritative type is server-only BY DEFAULT — it
// will not reach the wire (or the delta surface) until its key is added to the
// keep-list union below. The keep/drop rationale lives in this spec's
// `UI_FIELDS.md` audit; the unions here are the authority.
//
// Shared by client and server so there is one definition of the broadcast shape.

// Room-level fields the client renders. Drops `createdAt` (never read by any
// client component).
export type RoomUIFields =
  | "lobbyId"
  | "shareCode"
  | "startTime"
  | "isStarted"
  | "isFinished"
  | "winnerId"
  | "isDraw"
  | "matchEndTime";
export type ClientBattleRoyaleRoom = Pick<Room, RoomUIFields>;

// Per-player fields the client renders. Drops `endTimeStamp` (zero client
// matches; survival time is computed from `life`) and `statsPersisted`
// (server-only bookkeeping).
export type PlayerDisplayUIFields =
  | "name"
  | "isAnonymous"
  | "revealed_letters"
  | "partialMatches"
  | "noMatch"
  | "display_queue"
  | "isEliminated"
  | "life"
  | "totalGuesses"
  | "correctGuesses"
  | "currentWordGuesses"
  | "lastAttackerName"
  | "currentWordIsAttack"
  | "currentWordAttackerName"
  | "attackQueueView"
  | "attackCementAt";
export type ClientBattleRoyalePlayer = Pick<
  PlayerDisplay,
  PlayerDisplayUIFields
>;

export type ClientGame = {
  room: ClientBattleRoyaleRoom;
  players: Record<string, ClientBattleRoyalePlayer>;
};

// --- Render-contract guard (realtime-broadcast-scaling, Req 2.5) -------------
//
// The `Pick`s above already constrain each keep-list to `keyof` its
// authoritative type, so a bad key fails at the `Pick`. These assertions make
// that contract an explicit, named, compile-time check: if an authoritative
// field is renamed or removed while its key is still in the keep-list, the
// `satisfies` below fails to compile and names the offending key — rather than
// the error surfacing implicitly (and more opaquely) at the `Pick`.
//
// Pattern: a `satisfies readonly (keyof T)[]` on the keep-list as a literal
// array. The array is purely a type-level witness (`as const` + `satisfies`),
// carries no runtime behaviour of its own, and is never read elsewhere.
//
// To extend a keep-list: add the key to BOTH the union type above AND this
// witness array; TypeScript enforces the array stays exhaustive and valid.

const ROOM_UI_FIELDS = [
  "lobbyId",
  "shareCode",
  "startTime",
  "isStarted",
  "isFinished",
  "winnerId",
  "isDraw",
  "matchEndTime",
] as const satisfies readonly RoomUIFields[] satisfies readonly (keyof Room)[];

const PLAYER_DISPLAY_UI_FIELDS = [
  "name",
  "isAnonymous",
  "revealed_letters",
  "partialMatches",
  "noMatch",
  "display_queue",
  "isEliminated",
  "life",
  "totalGuesses",
  "correctGuesses",
  "currentWordGuesses",
  "lastAttackerName",
  "currentWordIsAttack",
  "currentWordAttackerName",
  "attackQueueView",
  "attackCementAt",
] as const satisfies readonly PlayerDisplayUIFields[] satisfies readonly (keyof PlayerDisplay)[];

// Exhaustiveness: the witness array must cover EVERY member of the keep-list
// union (not just a valid subset), so a union entry can't silently drift from
// the array. `never` here means a union member is missing from the array above.
type _AssertRoomExhaustive = Exclude<
  RoomUIFields,
  (typeof ROOM_UI_FIELDS)[number]
> extends never
  ? true
  : never;
type _AssertPlayerDisplayExhaustive = Exclude<
  PlayerDisplayUIFields,
  (typeof PLAYER_DISPLAY_UI_FIELDS)[number]
> extends never
  ? true
  : never;
const _roomExhaustive: _AssertRoomExhaustive = true;
const _playerDisplayExhaustive: _AssertPlayerDisplayExhaustive = true;
void _roomExhaustive;
void _playerDisplayExhaustive;
void ROOM_UI_FIELDS;
void PLAYER_DISPLAY_UI_FIELDS;
