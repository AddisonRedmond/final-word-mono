export type PlayerDisplay = {
  name: string;
  fullMatches?: number[];
  partialMatches?: number[];
  noMatch?: string[];
  queue?: string[];
  endTimeStamp?: number;
  isEliminated: boolean;
  life: number;
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
