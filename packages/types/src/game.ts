export type TargetTypes = "first" | "last" | "random" | (string & {});

export interface PlayerDisplay {
  name: string;
  revealed_letters?: RevealedLetters;
  partialMatches?: string[];
  noMatch?: string[];
  display_queue?: RevealedLetters[];
  endTimeStamp?: number;
  isEliminated: boolean;
  life: number;
  totalGuesses: number;
  currentWordGuesses: number;
};


export type RevealedLetters = Record<number, string>;

// this will be the server only queue
const queueExample = ["APPLE", "GUEST"];

// this will be the display_queue
const queueMatchesExample = [
  { 0: "A", 4: "E" },
  { 0: "G", 1: "U" },
];

export type ServerPlayerData = {
  [keyof: string]: {
    word: string;
    queue: string[];
  };
};

export type ServerOnlyData = Map<
  string,
  {
    playerData: Record<string, string>;
    timers: {
      startTimer?: ReturnType<typeof setTimeout>;
      gameTimer?: ReturnType<typeof setInterval>;
    };
  }
>;

export type ServerPlayerMap = Map<string, Record<string, string>>;

export type Room = {
  lobbyId: string;
  startTime: number;
  isStarted: boolean;
  createdAt: number;
};

export type Game = {
  room: Room;
  players: Map<string, PlayerDisplay>;
};

export type ClientGame = {
  room: Room;
  players: Record<string, PlayerDisplay>;
};
