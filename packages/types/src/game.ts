export type PlayerDisplay = {
  userId: string;
  name: string;
  fullMatches?: number[];
  partialMatches?: number[];
  noMatch?: string[];
  queue?: string[];
  endTimeStamp?: number;
};

export type ServerOnlyData = {
  word: string;
};

export type ServerPlayerMap = Map<string, Record<string, string>>;

export type Room = {
  lobbyId: string;
  startTime: number;
  isStarted: boolean;
};

export type Game = {
  room: Room;
  players: Map<string, PlayerDisplay>;
};
