import type {
  BotServerData,
  Game,
  PlayerDisplay,
  PlayerServerData,
  RevealedLetters,
  RoomTimers,
  ServerBotData,
  ServerOnlyData,
  ServerPlayerData,
  TargetType,
} from "types/battle-royale.types.js";
import type { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import words from "./words.js";
import logger from "./logger.js";
import { scheduleMatchTimeLimit } from "./match-timer.js";
import {
  ATTACK_WORD_BONUS_MS,
  getGuessBonusMs,
  MATCH_TIME_LIMIT_MS,
} from "shared/battle-royale.js";

const initialTimer = 120 * 1000;
const Max_Wait_Time = 45 * 1000; //Seconds

export const cleanupGame = (
  roomId: string,
  games: Map<string, Game>,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
) => {
  const roomServerOnlyData = serverOnlyData.get(roomId);

  logger.info(
    {
      roomId,
      playerCount: games.get(roomId)?.players.size ?? 0,
      hasServerData: Boolean(roomServerOnlyData),
    },
    "Cleaning up game",
  );

  if (roomServerOnlyData) {
    const { startTimer, gameTimer, botTicker, updateTicker, matchTimer } =
      roomServerOnlyData.timers;

    if (startTimer) {
      clearTimeout(startTimer);
    }

    if (gameTimer) {
      clearInterval(gameTimer);
    }

    if (botTicker) {
      clearInterval(botTicker);
    }

    if (updateTicker) {
      clearTimeout(updateTicker);
    }

    if (matchTimer) {
      clearTimeout(matchTimer);
    }
  }

  games.delete(roomId);
  serverOnlyData.delete(roomId);
  serverOnlyBotData.delete(roomId);
};

export const handleAddBots = (numberOfBotsToAdd: number) => {
  const getRandomLevel = (): 1 | 2 | 3 | 4 => {
    // Average several uniform rolls to approximate a bell curve centered on level 3.
    const rolls = 3;
    const average =
      Array.from({ length: rolls }, () => Math.random()).reduce(
        (sum, value) => sum + value,
        0,
      ) / rolls;

    const level = Math.floor(average * 4) + 1;

    return Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4;
  };

  const roomBotServerData: { [botId: string]: BotServerData } = {};
  const botsDisplayData = new Map<string, PlayerDisplay>();
  const lifeExpiry = Date.now() + initialTimer;

  for (let i = 0; i < numberOfBotsToAdd; i++) {
    // add bots to a bot object so they can be tracked
    const botNameForNow = `bot${i}`;

    roomBotServerData[botNameForNow] = {
      word: getRandomWord(),
      currentWordIsAttack: false,
      queue: [],
      level: getRandomLevel(),
      target: "random",
      botGuesses: 0,
    };

    botsDisplayData.set(botNameForNow, {
      name: botNameForNow,
      life: lifeExpiry,
      isEliminated: false,
      totalGuesses: 0,
      correctGuesses: 0,
      currentWordGuesses: 0,
    });
  }
  logger.info({ botCount: numberOfBotsToAdd }, "Bots prepared for lobby");
  return { roomBotServerData, botsDisplayData };
};

// shows the eliminated player the word they were guessing, without granting a correct-guess reward
const revealEliminatedPlayerWord = (
  player: PlayerDisplay,
  playerId: string,
  roomId: string,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
) => {
  const word =
    serverOnlyData.get(roomId)?.playerData[playerId]?.word ??
    serverOnlyBotData.get(roomId)?.[playerId]?.word;

  if (!word) {
    return;
  }

  const revealed: RevealedLetters = {};
  word.split("").forEach((letter, index) => {
    revealed[index] = letter;
  });

  player.revealed_letters = revealed;
};

export const handleStartGame = (
  game: Game,
  io: Server,
  timers: RoomTimers,
  games: Map<string, Game>,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
): void => {
  // TODO: probably reduce amount of time gained as game continues
  if (game.room.isStarted || game.room.isFinished) {
    logger.warn(
      { roomId: game.room.lobbyId },
      "Game start ignored: game has already started or finished",
    );
    return;
  }

  logger.info(
    { roomId: game.room.lobbyId, playerCount: game.players.size },
    "Starting game",
  );
  game.room.isStarted = true;
  game.room.matchEndTime = Date.now() + MATCH_TIME_LIMIT_MS;
  const lifeExpiry = Date.now() + initialTimer;
  for (const player of game.players.values()) {
    player.life = lifeExpiry;
  }

  timers.gameTimer = setInterval(() => {
    const now = Date.now();
    const activePlayers = Array.from(game.players.entries()).filter(
      ([, player]) => !player.isEliminated,
    );

    if (activePlayers.length === 1) {
      const [winnerId] = activePlayers[0] as [string, PlayerDisplay];
      game.room.winnerId = winnerId;
      game.room.isFinished = true;
      logger.info(
        { roomId: game.room.lobbyId, winnerId },
        "Game ended: one player remains",
      );
      io.to(game.room.lobbyId).emit("lobby:update", {
        ...game,
        players: Object.fromEntries(game.players),
      });
      cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
      return;
    }

    if (activePlayers.length === 0) {
      game.room.isFinished = true;
      game.room.isDraw = true;
      logger.info(
        { roomId: game.room.lobbyId },
        "Game ended: no active players remain",
      );
      io.to(game.room.lobbyId).emit("lobby:update", {
        ...game,
        players: Object.fromEntries(game.players),
      });
      cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
      return;
    }

    const expiringPlayers = activePlayers.filter(
      ([, player]) => player.life > 0 && now >= player.life,
    );

    if (expiringPlayers.length === 0) {
      return;
    }

    if (expiringPlayers.length === activePlayers.length) {
      if (activePlayers.length === game.players.size) {
        game.room.isFinished = true;
        game.room.isDraw = true;
        logger.info(
          { roomId: game.room.lobbyId, playerCount: game.players.size },
          "Game ended in a draw: all players expired simultaneously",
        );
      } else {
        const [winnerId, winner] = expiringPlayers.reduce((best, current) =>
          current[1].totalGuesses < best[1].totalGuesses ? current : best,
        );
        winner.isEliminated = false;
        game.room.winnerId = winnerId;
        game.room.isFinished = true;
        logger.info(
          {
            roomId: game.room.lobbyId,
            winnerId,
            totalGuesses: winner.totalGuesses,
            tiedPlayers: expiringPlayers.length,
          },
          "Game ended: fewest guesses won simultaneous expiration",
        );
      }

      for (const [playerId, player] of expiringPlayers) {
        if (
          !game.room.winnerId ||
          player !== game.players.get(game.room.winnerId)
        ) {
          player.isEliminated = true;
          revealEliminatedPlayerWord(
            player,
            playerId,
            game.room.lobbyId,
            serverOnlyData,
            serverOnlyBotData,
          );
        }
      }

      io.to(game.room.lobbyId).emit("lobby:update", {
        ...game,
        players: Object.fromEntries(game.players),
      });
      cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
      return;
    }

    for (const [playerId, player] of expiringPlayers) {
      player.isEliminated = true;
      revealEliminatedPlayerWord(
        player,
        playerId,
        game.room.lobbyId,
        serverOnlyData,
        serverOnlyBotData,
      );
    }

    io.to(game.room.lobbyId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });
  }, 1000);

  timers.matchTimer = scheduleMatchTimeLimit({
    game,
    io,
    games,
    serverOnlyData,
    serverOnlyBotData,
    revealEliminatedPlayerWord,
    cleanupGame,
  });
};

export const handleStartLobbyTimer = (
  game: Game,
  io: Server,
  gameTimers: RoomTimers,
  games: Map<string, Game>,
  serverOnlyData: ServerOnlyData,
  serverOnlyBotData: ServerBotData,
) => {
  if (game.room.isStarted) {
    logger.warn(
      { roomId: game.room.lobbyId },
      "Lobby timer start ignored: game already started",
    );
    return;
  }

  handleStartGame(
    game,
    io,
    gameTimers,
    games,
    serverOnlyData,
    serverOnlyBotData,
  );
  io.to(game.room.lobbyId).emit("lobby:update", {
    ...game,
    players: Object.fromEntries(game.players),
  });

  return true;
};

export const findGameForUser = (
  games: Map<string, Game>,
  userId: string,
): Game | undefined => {
  return Array.from(games.values()).find((game) => game.players.has(userId));
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
      isFinished: false,
      isDraw: false,
    },
    players: new Map(),
  };

  games.set(lobbyId, game);
  logger.info(
    { roomId: lobbyId, startTime: game.room.startTime },
    "Created game lobby",
  );
  return game;
};

export const getRandomWord = () => {
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex] ?? "PLAYER";
};

export const applyCorrectGuessReward = ({
  player,
  userId,
  roomServerOnlyData,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerPlayerData | { [botId: string]: BotServerData };
}) => {
  const bonusLife = getGuessBonusMs(player.currentWordGuesses);
  const now = Date.now();
  const maxLifeExpiry = now + 3 * 60 * 1000;
  const currentLife = Math.max(player.life, now);

  const serverData = roomServerOnlyData[userId];
  if (!serverData) {
    logger.warn(
      { userId },
      "Correct guess reward skipped: player server data missing",
    );
    return;
  }
  const nextWord = serverData.queue.shift();
  const earnedBonus = serverData.currentWordIsAttack
    ? ATTACK_WORD_BONUS_MS
    : bonusLife;
  player.life = Math.min(currentLife + earnedBonus, maxLifeExpiry);

  player.correctGuesses += 1;
  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];
  player.revealed_letters = player.display_queue?.shift() ?? {};

  serverData.word = nextWord ?? getRandomWord();
  serverData.currentWordIsAttack = nextWord !== undefined;
};

export const applyAttack = (
  guessedWord: string,
  guessCount: number,
  target?: PlayerDisplay,
  targetServerData?: PlayerServerData | BotServerData,
) => {
  if (!target || target.isEliminated || !guessedWord) {
    logger.warn(
      {
        targetFound: Boolean(target),
        targetEliminated: target?.isEliminated,
        hasGuessedWord: Boolean(guessedWord),
      },
      "Attack skipped",
    );
    return;
  }

  if (targetServerData) {
    targetServerData.queue.push(guessedWord.toUpperCase());
  }

  let lettersToReveal = 0;

  if (guessCount <= 3) {
    lettersToReveal = 2;
  } else if (guessCount <= 7) {
    lettersToReveal = 3;
  } else {
    lettersToReveal = 4;
  }

  if (lettersToReveal === 0) {
    logger.debug({ guessCount }, "Attack queued without letter reveal");
    return;
  }

  const queue = target.display_queue ?? (target.display_queue = []);

  if (queue.length < 4) {
    const word = guessedWord.toUpperCase();
    const availableIndexes = Array.from(
      { length: word.length },
      (_, index) => index,
    );

    // Fisher-Yates shuffle so revealed letters are randomly positioned
    for (let i = availableIndexes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableIndexes[i], availableIndexes[j]] = [
        availableIndexes[j],
        availableIndexes[i],
      ];
    }

    const revealedLetters: RevealedLetters = {};
    for (const index of availableIndexes.slice(0, lettersToReveal)) {
      revealedLetters[index] = word[index] as string;
    }

    queue.push(revealedLetters);
    return;
  }

  const entriesByLetterCount: { index: number; count: number }[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const count = Object.keys(queue[index] as RevealedLetters).length;
    if (count > 0) {
      entriesByLetterCount.push({ index, count });
    }
  }
  entriesByLetterCount.sort((a, b) => b.count - a.count);

  for (const { index } of entriesByLetterCount.slice(0, lettersToReveal)) {
    const entry = queue[index] as RevealedLetters;
    const keys = Object.keys(entry).map(Number);
    const keyToRemove = keys[Math.floor(Math.random() * keys.length)];

    if (keyToRemove !== undefined) {
      delete entry[keyToRemove];
    }
  }
};

export const determineTarget = (
  players: Map<string, PlayerDisplay>,
  selfId: string,
  target: TargetType,
): string => {
  const activeIds: string[] = [];
  let firstId = "";
  let firstLife = -Infinity;
  let lastId = "";
  let lastLife = Infinity;
  let targetIsActive = false;

  for (const [playerId, player] of players) {
    if (playerId === selfId || player.isEliminated) {
      continue;
    }

    activeIds.push(playerId);

    if (player.life > firstLife) {
      firstLife = player.life;
      firstId = playerId;
    }

    if (player.life < lastLife) {
      lastLife = player.life;
      lastId = playerId;
    }

    if (playerId === target) {
      targetIsActive = true;
    }
  }

  if (activeIds.length === 0) {
    return "";
  }

  switch (target) {
    case "first":
      return firstId;

    case "last":
      return lastId;

    case "random":
      return activeIds[Math.floor(Math.random() * activeIds.length)] ?? "";

    default:
      // target is already a player id; fall back to random if they aren't targetable.
      return targetIsActive
        ? target
        : (activeIds[Math.floor(Math.random() * activeIds.length)] ?? "");
  }
};
