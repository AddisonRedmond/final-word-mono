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

export const userAlreadyJoined = (
  games: Map<string, Game>,
  userId: string,
): boolean => {
  return Array.from(games.values()).some((game) =>
    game.players.has(userId),
  );
};
