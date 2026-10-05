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
  // Guest flag stamped from `socket.data.isAnonymous` at join (Req 4.5, 4.6).
  // Display-safe boolean; part of the anonymous-sign-in feature. Bots set this
  // to `false` (a bot is never a guest account).
  isAnonymous: boolean;
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
};

export type ServerOnlyData = Map<string, RoomServerData>;

export type Game = {
  room: Room;
  players: Map<string, PlayerDisplay>;
};

export type ClientGame = {
  room: Room;
  players: Record<string, PlayerDisplay>;
};
