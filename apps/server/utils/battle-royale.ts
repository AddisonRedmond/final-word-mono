import type {
  Game,
  PlayerDisplay,
  ServerBotData,
} from "../../../packages/types/src/game.js";
import type { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import words from "./words.js";

const initialTimer = 120 * 1000;
const Max_Wait_Time = 45 * 1000; //Seconds

type GameTimers = {
  startTimer?: ReturnType<typeof setTimeout>;
  gameTimer?: ReturnType<typeof setInterval>;
};

export const crownWinnerAndCleanUp = () => {};

export const handleAddBots = (numberOfBotsToAdd: number) => {
  const getRandomLevel = (): 1 | 2 | 3 | 4 | 5 => {
    return (Math.floor(Math.random() * 5) + 1) as 1 | 2 | 3 | 4 | 5;
  };

  const botsServerData: ServerBotData = new Map();
  const botsDisplayData = new Map<string, PlayerDisplay>();
  const lifeExpiry = Date.now() + initialTimer;

  for (let i = 0; i < numberOfBotsToAdd; i++) {
    // add bots to a bot object so they can be tracked
    const botNameForNow = `bot${i}`;

    botsServerData.set(botNameForNow, {
      word: getRandomWord(),
      queue: [],
      level: getRandomLevel(),
    });

    botsDisplayData.set(botNameForNow, {
      name: botNameForNow,
      life: lifeExpiry,
      isEliminated: false,
      totalGuesses: 0,
      currentWordGuesses: 0,
    });
  }
  return { botsServerData, botsDisplayData };
};

export const handleStartGame = (
  game: Game,
  io: Server,
  timers: GameTimers,
): void => {
  game.room.isStarted = true;
  const lifeExpiry = Date.now() + initialTimer;
  for (const player of game.players.values()) {
    player.life = lifeExpiry;
  }

  timers.gameTimer = setInterval(() => {
    let changed = false;
    const now = Date.now();

    for (const player of game.players.values()) {
      if (!player.isEliminated && player.life > 0 && now >= player.life) {
        player.isEliminated = true;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    io.to(game.room.lobbyId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });

    if (
      !Array.from(game.players.values()).some((player) => !player.isEliminated)
    ) {
      clearInterval(timers.gameTimer);
      timers.gameTimer = undefined;
    }
  }, 1000);
};

export const handleStartLobbyTimer = (
  game: Game,
  io: Server,
  gameTimers: GameTimers,
): void => {
  if (game.room.isStarted) {
    return;
  }

  handleStartGame(game, io, gameTimers);
  io.to(game.room.lobbyId).emit("lobby:update", {
    ...game,
    players: Object.fromEntries(game.players),
  });
};

export const findGameForUser = (
  games: Map<string, Game>,
  userId: string,
): Game | undefined => {
  return Array.from(games.values()).find((game) => game.players.has(userId));
};

export const lifeMap = {
  1: 60 * 1000,
  2: 60 * 1000,
  3: 45 * 1000,
  4: 45 * 1000,
  5: 30 * 1000,
  6: 30 * 1000,
  7: 15 * 1000,
  8: 15 * 1000,
  9: 10 * 1000,
  10: 10 * 1000,
};

const calculateMatchObj = (word: string, guess: string) => {
  const fullMatches: Record<number, string> = {};
  const partialMatches: string[] = [];
  const noMatch: string[] = [];

  word.split("").forEach((letter, index) => {
    const guessedLetter = guess[index];

    if (!guessedLetter) {
      return;
    }

    if (letter === guessedLetter) {
      fullMatches[index] = letter;
      return;
    }

    if (guess.includes(letter)) {
      partialMatches.push(letter);
      return;
    }

    noMatch.push(guessedLetter);
  });

  return {
    fullMatches,
    partialMatches,
    noMatch,
  };
};

export const checkWord = (guess: string, word: string) => {
  const normalizedGuess = guess.trim().toUpperCase();
  const normalizedWord = word.trim().toUpperCase();

  const matchObj = calculateMatchObj(normalizedWord, normalizedGuess);

  const isMatch =
    normalizedGuess.length > 0 && normalizedGuess === normalizedWord;

  return {
    isMatch,
    ...matchObj,
  };
};

export const getOrCreateGame = (
  games: Map<string, Game>,
  maxPlayers: number,
): Game => {
  for (const game of games.values()) {
    if (!game.room.isStarted && game.players.size < maxPlayers) {
      return game;
    }
  }

  const lobbyId = randomUUID();
  const game: Game = {
    room: {
      lobbyId,
      startTime: Date.now() + Max_Wait_Time,
      createdAt: Date.now(),
      isStarted: false,
    },
    players: new Map(),
  };

  games.set(lobbyId, game);
  return game;
};

export const getRandomWord = () => {
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex] ?? "PLAYER";
};
