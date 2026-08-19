import { randomUUID } from "node:crypto";
import words from "./words.js";
import type { Game } from "../../../packages/types/src/game.js";

const Max_Wait_Time = 45 * 1000; //Seconds

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

export const GetRandomWord = () => {
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex] ?? "PLAYER";
};

export const checkWord = (guess: string, word: string) => {
  // get partial matches,
  // get full matches,
  // get no matches
  // return object
};
