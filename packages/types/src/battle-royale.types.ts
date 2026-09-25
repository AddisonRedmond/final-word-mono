export type TargetType = "first" | "last" | "random" | (string & {});

// Client-side selection intent for the attack picker. Distinct from the value
// sent to the server (which is always a concrete opponent UUID): "first"/"last"
// auto-track the live leader/trailer, "random" picks one opponent, and
// "player" means a specific opponent was clicked directly.
export type TargetMode = "first" | "last" | "random" | "player";

export type RevealedLetters = Record<number, string>;

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
};

export type PlayerServerData = {
  word: string;
  currentWordIsAttack: boolean;
  queue: string[];
  // Attacker display name for each queued attack word, kept in lockstep with
  // `queue` so the badge on a consumed attack word shows the correct sender.
  attackerQueue?: string[];
};

export type ServerPlayerData = Record<string, PlayerServerData>;

export type BotServerData = {
  word: string;
  currentWordIsAttack: boolean;
  queue: string[];
  // Attacker display name for each queued attack word, kept in lockstep with
  // `queue` so the badge on a consumed attack word shows the correct sender.
  attackerQueue?: string[];
  level: 1 | 2 | 3 | 4 | 5;
  target: TargetType;
  guessTimeStamp?: number;
  botGuesses: number;
};

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
