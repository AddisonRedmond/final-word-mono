export interface Player {
  [userId: string]: {
    word: string;
    guesses: string[];
    endTimeStamp: number;
    backlog: string[];
    backlogGuesses: string[];
    isBot?: boolean;
    healthMs: number;
    activeWord: string;
    activeWordGuesses: string[];
    targetMode: "random" | "first" | "last" | "specific";
    targetUserId: string;
    attackQueue: Array<{ word: string; revealedPositions: number[] }>;
  };
}

export interface Game {
  lobbyId: string;
  createdAt: number;
  started: boolean;
  winner: string;
  players: Player;
  beginAtCountdown: number;
  maxPlayers: number;
  minPlayers: number;
}
