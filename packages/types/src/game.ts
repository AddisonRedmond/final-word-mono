export type PlayerDisplay = {
  userId: string;
  name: string;
  fullMatches?: number[];
  partialMatches?: number[];
  noMatch?: string[];
  queue?: string[];
  endTimeStamp?: number;
  isEliminated: boolean;
};

export type ServerOnlyData = Map<
  string,
  {
    playerData: Record<string, string>;
    gameTimers: {
      startTimer: ReturnType<typeof setTimeout>;
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
