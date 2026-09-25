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
import logger from "../../../utils/logger.js";
import { scheduleMatchTimeLimit } from "./match-timer.js";
import { persistBattleRoyaleStats } from "../stats.js";
import {
  ATTACK_WORD_BONUS_MS,
  getGuessBonusMs,
  MATCH_TIME_LIMIT_MS,
} from "shared/battle-royale.js";

const initialTimer = 1.5 * 60 * 1000;
const Max_Wait_Time = 45 * 1000; //Seconds
const Max_Life_Timer = 1.5 * 60 * 1000; //Seconds
export const Max_Attack_Words = 3;

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

  // Persist aggregate stats for genuinely finished matches only. cleanupGame is
  // also called when a lobby empties out (players disconnected before a result)
  // — those aren't real games and must not count. We read the game before the
  // delete below, and fire-and-forget so a slow/failed write never blocks
  // teardown (persistBattleRoyaleStats swallows its own errors).
  const finishedGame = games.get(roomId);
  if (finishedGame?.room.isFinished) {
    void persistBattleRoyaleStats(finishedGame);
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

    // Pre-sweep active players (before this tick's expiry sweep).
    const activePlayers = Array.from(game.players.entries()).filter(
      ([, player]) => !player.isEliminated,
    );

    // Sweep expired players FIRST, before evaluating end conditions, so a bot
    // (or player) whose life expired on the same tick the game ends still gets
    // marked eliminated and disappears from the final lobby:update.
    // life is an absolute timestamp, so use Number.isFinite rather than > 0.
    const expiringPlayers = activePlayers.filter(
      ([, player]) => Number.isFinite(player.life) && now >= player.life,
    );

    // If the whole remaining field expires on the same tick, pick a winner by
    // fewest total guesses (or declare a draw if the entire room expired at
    // once), rather than letting everyone be eliminated into a false draw.
    let simultaneousWinnerId: string | undefined;
    if (
      expiringPlayers.length > 0 &&
      expiringPlayers.length === activePlayers.length
    ) {
      if (activePlayers.length === game.players.size) {
        // Entire room expired simultaneously -> genuine draw, no winner.
        game.room.isDraw = true;
        logger.info(
          { roomId: game.room.lobbyId, playerCount: game.players.size },
          "Game ended in a draw: all players expired simultaneously",
        );
      } else {
        const [winnerId, winner] = expiringPlayers.reduce((best, current) =>
          current[1].totalGuesses < best[1].totalGuesses ? current : best,
        );
        simultaneousWinnerId = winnerId;
        game.room.winnerId = winnerId;
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
    }

    // Mark all expiring players eliminated (skipping any chosen winner) and
    // reveal their words.
    for (const [playerId, player] of expiringPlayers) {
      if (playerId === simultaneousWinnerId) {
        continue;
      }
      player.isEliminated = true;
      revealEliminatedPlayerWord(
        player,
        playerId,
        game.room.lobbyId,
        serverOnlyData,
        serverOnlyBotData,
      );
    }

    // Recompute active players after the sweep, then evaluate end conditions.
    const remainingPlayers = Array.from(game.players.entries()).filter(
      ([, player]) => !player.isEliminated,
    );

    if (remainingPlayers.length === 1) {
      const [winnerId] = remainingPlayers[0] as [string, PlayerDisplay];
      game.room.winnerId = winnerId;
      game.room.isFinished = true;
      logger.info(
        { roomId: game.room.lobbyId, winnerId },
        "Game ended: one player remains",
      );
    } else if (remainingPlayers.length === 0) {
      game.room.isFinished = true;
      // Only force a draw if one wasn't already resolved to a winner above.
      if (!game.room.winnerId) {
        game.room.isDraw = true;
      }
      logger.info(
        { roomId: game.room.lobbyId },
        "Game ended: no active players remain",
      );
    }

    // Early-return only when nothing changed and the game is still running.
    if (expiringPlayers.length === 0 && !game.room.isFinished) {
      return;
    }

    io.to(game.room.lobbyId).emit("lobby:update", {
      ...game,
      players: Object.fromEntries(game.players),
    });

    if (game.room.isFinished) {
      cleanupGame(game.room.lobbyId, games, serverOnlyData, serverOnlyBotData);
    }
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
  // TODO: remove life time map, add time stamp that counts down for the user
  // starting at 60 seconds, counts down 1 second at a time, if the user gets to 6 guesses
  // each guess after that will remove 5s from their timer
  // if the timer reaches 0 they failed that word. Advancetonextword
  const rawBonusLife = getGuessBonusMs(player.currentWordGuesses);
  // Guard against a non-finite bonus corrupting player.life into NaN, which
  // would render as NaN on the client and drain the health bar to zero.
  const bonusLife = Number.isFinite(rawBonusLife) ? rawBonusLife : 0;
  const now = Date.now();
  const maxLifeExpiry = now + Max_Life_Timer;
  const currentLife = Math.max(Number.isFinite(player.life) ? player.life : now, now);

  const serverData = roomServerOnlyData[userId];
  if (!serverData) {
    logger.warn(
      { userId },
      "Correct guess reward skipped: player server data missing",
    );
    return;
  }
  const nextWord = serverData.queue.shift();
  const nextAttacker = serverData.attackerQueue?.shift();
  if (!serverData.currentWordIsAttack) {
    player.life = Math.min(currentLife + bonusLife, maxLifeExpiry);
  }

  player.correctGuesses += 1;
  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];
  player.revealed_letters = player.display_queue?.shift() ?? {};

  serverData.word = nextWord ?? getRandomWord();
  serverData.currentWordIsAttack = nextWord !== undefined;
  // Mirror onto display data so the client can badge the attack word with the
  // attacker's initials while the player is guessing it.
  player.currentWordIsAttack = serverData.currentWordIsAttack;
  player.currentWordAttackerName = nextWord !== undefined ? nextAttacker : undefined;
};

export const advanceToNextWord = ({
  player,
  userId,
  roomServerOnlyData,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerPlayerData | { [botId: string]: BotServerData };
}) => {
  const serverData = roomServerOnlyData[userId];
  if (!serverData) {
    logger.warn(
      { userId },
      "Word rollover skipped: player server data missing",
    );
    return;
  }

  const nextWord = serverData.queue.shift();
  const nextAttacker = serverData.attackerQueue?.shift();

  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];
  player.revealed_letters = player.display_queue?.shift() ?? {};

  serverData.word = nextWord ?? getRandomWord();
  serverData.currentWordIsAttack = nextWord !== undefined;
  // Mirror onto display data so the client can badge the attack word with the
  // attacker's initials while the player is guessing it.
  player.currentWordIsAttack = serverData.currentWordIsAttack;
  player.currentWordAttackerName = nextWord !== undefined ? nextAttacker : undefined;
};

export const applyAttack = (
  guessedWord: string,
  guessCount: number,
  target?: PlayerDisplay,
  targetServerData?: PlayerServerData | BotServerData,
  attackerName?: string,
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

  // Record who last attacked this player so the results screen can show
  // "Eliminated by X" (the most recent attacker, even if their word is still
  // queued behind earlier attacks).
  if (attackerName) {
    target.lastAttackerName = attackerName;
  }

  const attackQueueIsFull =
    targetServerData !== undefined &&
    targetServerData.queue.length >= Max_Attack_Words;

  if (attackQueueIsFull) {
    // Attack word queue is full: still reveal letters, just don't queue another word.
    logger.debug(
      { target: target.name, maxAttackWords: Max_Attack_Words },
      "Attack word not queued: target attack queue is full",
    );
  } else if (targetServerData) {
    targetServerData.queue.push(guessedWord.toUpperCase());
    // Track the sender in lockstep with the word so the per-word badge shows
    // the correct attacker when this specific word is later consumed.
    (targetServerData.attackerQueue ??= []).push(attackerName ?? "");
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
  isAttackable: (playerId: string) => boolean = () => true,
): string => {
  const activeIds: string[] = [];
  const attackableIds: string[] = [];
  let firstId = "";
  let firstLife = -Infinity;
  let lastId = "";
  let lastLife = Infinity;
  let attackableFirstId = "";
  let attackableFirstLife = -Infinity;
  let attackableLastId = "";
  let attackableLastLife = Infinity;
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

    if (isAttackable(playerId)) {
      attackableIds.push(playerId);

      if (player.life > attackableFirstLife) {
        attackableFirstLife = player.life;
        attackableFirstId = playerId;
      }

      if (player.life < attackableLastLife) {
        attackableLastLife = player.life;
        attackableLastId = playerId;
      }
    }
  }

  if (activeIds.length === 0) {
    return "";
  }

  // Prefer a target whose attack queue has room so a maxed-out queue doesn't
  // silently swallow every subsequent "first"/"last"/"random" attack.
  switch (target) {
    case "first":
      return attackableFirstId || firstId;

    case "last":
      return attackableLastId || lastId;

    case "random": {
      const pool = attackableIds.length > 0 ? attackableIds : activeIds;
      return pool[Math.floor(Math.random() * pool.length)] ?? "";
    }

    default: {
      // target is already a player id; fall back to another target if they
      // aren't targetable or their attack queue is full.
      if (targetIsActive && isAttackable(target)) {
        return target;
      }

      const pool = attackableIds.length > 0 ? attackableIds : activeIds;
      return pool[Math.floor(Math.random() * pool.length)] ?? "";
    }
  }
};
