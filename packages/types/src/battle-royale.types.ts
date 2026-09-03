export type TargetType = "first" | "last" | "random" | (string & {});

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
  currentWordGuesses: number;
};

export type PlayerServerData = {
  word: string;
  queue: string[];
};

export type ServerPlayerData = Record<string, PlayerServerData>;

export type BotServerData = {
  word: string;
  queue: string[];
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
};

export type Room = {
  lobbyId: string;
  startTime: number;
  isStarted: boolean;
  createdAt: number;
  isFinished: boolean;
  winnerId?: string;
  isDraw: boolean;
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
