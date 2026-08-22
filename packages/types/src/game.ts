export type TargetTypes = "first" | "last" | "random" | (string & {});

export type PlayerDisplay = {
  name: string;
  revealed_letters?: Record<number, string>;
  partialMatches?: string[];
  noMatch?: string[];
  queue?: string[];
  endTimeStamp?: number;
  isEliminated: boolean;
  life: number;
  totalGuesses: number;
  currentWordGuesses: number;
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
