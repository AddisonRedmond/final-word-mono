import type {
  BotServerData,
  Game,
  PlayerDisplay,
  PlayerServerData,
  RevealedLetters,
  RoomTimers,
  ServerPlayerData,
  TargetType,
} from "types/battle-royale.types.js";
import type { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import words from "./words.js";

const initialTimer = 120 * 1000;
const Max_Wait_Time = 45 * 1000; //Seconds

export const crownWinnerAndCleanUp = () => {};

export const handleAddBots = (numberOfBotsToAdd: number) => {
  const getRandomLevel = (): 1 | 2 | 3 | 4 | 5 => {
    // Average several uniform rolls to approximate a bell curve centered on level 3.
    const rolls = 3;
    const average =
      Array.from({ length: rolls }, () => Math.random()).reduce(
        (sum, value) => sum + value,
        0,
      ) / rolls;

    const level = Math.floor(average * 5) + 1;

    return Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5;
  };

  const roomBotServerData: { [botId: string]: BotServerData } = {};
  const botsDisplayData = new Map<string, PlayerDisplay>();
  const lifeExpiry = Date.now() + initialTimer;

  for (let i = 0; i < numberOfBotsToAdd; i++) {
    // add bots to a bot object so they can be tracked
    const botNameForNow = `bot${i}`;

    roomBotServerData[botNameForNow] = {
      word: getRandomWord(),
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
      currentWordGuesses: 0,
    });
  }
  return { roomBotServerData, botsDisplayData };
};

export const handleStartGame = (
  game: Game,
  io: Server,
  timers: RoomTimers,
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
  gameTimers: RoomTimers,
) => {
  if (game.room.isStarted) {
    return;
  }

  handleStartGame(game, io, gameTimers);
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

export const applyCorrectGuessReward = ({
  player,
  userId,
  roomServerOnlyData,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerPlayerData | { [botId: string]: BotServerData };
}) => {
  const guessCount = Math.min(
    Math.max(player.currentWordGuesses, 1),
    10,
  ) as keyof typeof lifeMap;
  const bonusLife = lifeMap[guessCount];
  const now = Date.now();
  const maxLifeExpiry = now + 3 * 60 * 1000;
  const currentLife = Math.max(player.life, now);

  const serverData = roomServerOnlyData[userId];
  const nextWord = serverData.queue.shift();
  // only reward bonus life for a fresh random word, not an incoming attack word
  if (nextWord === undefined) {
    player.life = Math.min(currentLife + bonusLife, maxLifeExpiry);
  }

  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];

  // the display_queue is kept in step with serverData.queue, so the reveal for
  // the word that's about to become active moves into revealed_letters with it.
  player.revealed_letters = player.display_queue?.shift() ?? {};

  serverData.word = nextWord ?? getRandomWord();
};

export const applyAttack = (
  guessedWord: string,
  guessCount: number,
  target?: PlayerDisplay,
  targetServerData?: PlayerServerData | BotServerData,
) => {
  if (!target || target.isEliminated || !guessedWord) {
    return;
  }

  if (targetServerData) {
    targetServerData.queue.push(guessedWord.toUpperCase());
  }

  let lettersToReveal = 0;

  if (guessCount <= 4) {
    lettersToReveal = 3;
  } else if (guessCount <= 6) {
    lettersToReveal = 2;
  } else if (guessCount >= 10) {
    lettersToReveal = 1;
  }

  if (lettersToReveal === 0) {
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

  // Queue is already full: chip a letter off the fullest existing entries
  // instead of shifting/pushing, so queue order and remaining letters stay put.
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
  // single pass over the map instead of building/filtering an entries array
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
