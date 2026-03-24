export interface Player {
  [userId: string]: {
    word: string;
    guesses: string[];
    endTimeStamp: number;
    backlog: string[];
    backlogGuesses: string[];
  };
}

export interface Game {
  lobbyId: string;
  createdAt: number;
  started: boolean;
  winner: string;
  players: Player;
}
