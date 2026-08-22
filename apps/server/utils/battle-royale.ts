import type { Game } from "../../../packages/types/src/game.js";
import type { Server } from "socket.io";

const initialTimer = 120 * 1000;

type GameTimers = {
  startTimer?: ReturnType<typeof setTimeout>;
  gameTimer?: ReturnType<typeof setInterval>;
};

export const crownWinnerAndCleanUp = () => {};

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
  4: 30 * 1000,
  5: 30 * 1000,
  6: 20 * 1000,
  7: 15 * 1000,
};

const calculateMatchObj = (word: string, guess: string) => {
  const fullMatches: Record<number, string> = {};
  const partialMatches: string[] = [];
  const noMatch: string[] = [];

  for (let index = 0; index < guess.length; index += 1) {
    const guessedLetter = guess[index];

    if (!guessedLetter) {
      continue;
    }

    if (word[index] === guessedLetter) {
      fullMatches[index] = guessedLetter;
      continue;
    }

    if (word.includes(guessedLetter)) {
      partialMatches.push(guessedLetter);
      continue;
    }

    noMatch.push(guessedLetter);
  }

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
    fullMatches: matchObj.fullMatches,
    partialMatches: matchObj.partialMatches,
    noMatch: matchObj.noMatch,
  };
};
