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
  // Number of DISTINCT positions of the current (final-round) word this player
  // has revealed by their OWN correct guesses — the "most letters found"
  // tie-break for resolving the Final_Round when nobody solves it. Mirrors the
  // server-only `foundPositions` set so ranking stays a pure function of the
  // display player. Excludes any letter the game helper revealed. Reset per
  // word; only meaningful on the final round.
  correctPositionsFound?: number;
  // finishing outcome
  placement?: number; // final placement (Req 5.5)
  eliminatedAt?: number; // time of elimination (Req 5.5)
  // The word this player was trying to guess, revealed to THEM once they are
  // eliminated so the elimination card can show "the word was …" (mirrors
  // Battle Royale revealing the eliminated player's word). Set only at the
  // moment of elimination; undefined while still racing. Display-safe because an
  // eliminated player is out of the match and can no longer act on it.
  revealedWord?: string;
  // Letters of this player's CURRENT word that the game helper has revealed to
  // them (index -> letter), shown on their board/keyboard like found letters.
  // Reset when a new word is assigned. These are server-provided assists and
  // deliberately do NOT count toward the final-round "most letters" tie-break.
  hintRevealed?: Record<number, string>;
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
  // Short, human-friendly code (e.g. "FROG-72") that resolves to this match's
  // `matchId`. Shared with friends so they can join the same public race via
  // the "Join Game" entry (v1 play-with-friends). The `matchId` UUID stays the
  // canonical id used everywhere internally; this is only the shareable handle.
  shareCode?: string;
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
export type RacePlayerServerData = {
  word: string;
  lastAcceptedGuessAt: number;
  // Accumulated keyboard hints for the CURRENT word, mirroring Battle Royale's
  // per-player revealed/partial/absent sets. Reset whenever a new word is
  // assigned (round begin or after a correct guess). The partial set honours
  // the duplicate-letter rule: a letter stays yellow while an occurrence is
  // still unrevealed (e.g. the second P in APPLE), so it never looks fully
  // solved while a duplicate remains unfound.
  revealedLetters?: Record<number, string>;
  partialMatches?: string[];
  noMatch?: string[];
  // Final-round game-helper bookkeeping (server-only), reset when a new word is
  // assigned:
  //   - `foundPositions`: positions of the current word this player revealed by
  //     their OWN correct guesses (a letter graded `correct` at that index).
  //     This is the "distinct correct positions found" count used as the
  //     final-round tie-break — helper reveals are excluded by construction.
  //   - `hintPositions`: positions the helper has revealed for this player, so
  //     the next reveal never repeats one and tie-break counting can exclude
  //     them.
  foundPositions?: number[];
  hintPositions?: number[];
};
