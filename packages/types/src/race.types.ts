export type RacePhase = "lobby" | "round" | "intermission" | "finished";

export type LetterFeedback = {
  index: number;
  letter: string;
  state: "correct" | "present" | "absent";
};

// One player's per-round + per-match state (display-safe; assigned word is server-only).
export type RacePlayer = {
  name: string;
  isBot: boolean;
  isEliminated: boolean;
  // per-round
  completedWords: number; // words correctly guessed this round (Req 4.4)
  qualified: boolean; // reached qualifyingCount this round (Req 4.5)
  qualifiedAt?: number; // timestamp qualification occurred (Req 4.5, 5.2)
  roundGuesses: number; // guesses this round (tie-break, Req 5.3)
  // per-match aggregates (persisted)
  totalGuesses: number;
  correctGuesses: number;
  // Cumulative count of individual letters graded `correct` across all of this
  // player's guesses this match. Used as the secondary elimination-placement
  // key (after total correct WORDS, before total guesses), so a player who was
  // "closer" on their words places ahead of one who wasn't.
  correctLetters: number;
  // finishing outcome
  placement?: number; // final placement (Req 5.5)
  eliminatedAt?: number; // time of elimination (Req 5.5)
  // latest grading feedback for the client
  lastFeedback?: LetterFeedback[];
  // Server-side bookkeeping: set once this player's aggregate stats have been
  // persisted for THIS match (at elimination, forfeit-on-leave, or finish), so
  // every real player is recorded exactly once and never double-counted across
  // the elimination/leave/finish/cleanup paths. Never broadcast meaningfully;
  // it is display-safe (a plain boolean) but only read server-side.
  statsPersisted?: boolean;
};

export type RaceRoom = {
  matchId: string;
  phase: RacePhase;
  createdAt: number;
  lobbyDeadline: number; // countdown-to-start (Req 3.4, 10.1)
  currentRoundIndex: number;
  roundEndsAt?: number; // absolute round-timer expiry (Req 4.2, 10.2)
  // Absolute timestamp the NEXT round begins, set while in the `intermission`
  // phase so the client can count down to it (clock-skew corrected). Cleared/
  // stale outside intermission.
  nextRoundStartsAt?: number;
  winnerId?: string;
  isDraw: boolean;
};

export type RaceMatch = { room: RaceRoom; players: Map<string, RacePlayer> };
export type ClientRaceMatch = {
  room: RaceRoom;
  players: Record<string, RacePlayer>;
};

// Server-only per-player secret state (never broadcast) — the assigned word,
// and rate-gate bookkeeping. Parallels Battle Royale's PlayerServerData.
// Race is a solo race-to-qualify with independent per-player words: there is
// NO attack queue, currentWordIsAttack, currentWordAttackerName, or
// lastAttackerName carried over from Battle Royale.
export type RacePlayerServerData = { word: string; lastAcceptedGuessAt: number };
