import type {
  AttackEntry,
  AttackQueueState,
  BotServerData,
  Game,
  PlayerDisplay,
  PlayerServerData,
  QueuedAttackView,
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
import {
  persistBattleRoyaleStats,
  persistEliminatedAsLoss,
} from "../stats.js";
import {
  ATTACK_PENDING_MS,
  ATTACK_WORD_BONUS_MS,
  getGuessBonusMs,
  getPendingClearCount,
  getStartingHintCount,
  MATCH_TIME_LIMIT_MS,
  MAX_CEMENTED_ATTACK_WORDS,
} from "shared/battle-royale.js";

const initialTimer = 1.5 * 60 * 1000;
const Max_Wait_Time = 45 * 1000; //Seconds
const Max_Life_Timer = 1.5 * 60 * 1000; //Seconds
// §5.2a: cap applies to CEMENTED words only; pending words are an escapable
// buffer and don't count. Re-exported under the old name so existing callers
// keep working, and aliased to the shared constant so there's one source.
export const Max_Attack_Words = MAX_CEMENTED_ATTACK_WORDS;

// --- §5.2a attack-queue helpers ---------------------------------------------

/**
 * Number of CEMENTED attack words a player is carrying. This (not pending) is
 * what the `isAttackable` / cap checks compare against MAX_CEMENTED_ATTACK_WORDS.
 */
export const cementedCount = (data: AttackQueueState): number =>
  data.cemented.length;

/**
 * Builds the client-facing, letterless view of a player's queued attacks in
 * consume order (pending first, then cemented). Mirrored onto PlayerDisplay so
 * the UI can style pending (ghosted + countdown) vs. cemented (solid) slots
 * without ever learning the queued words.
 */
export const buildAttackQueueView = (
  data: AttackQueueState,
): QueuedAttackView[] => [
  ...data.pending.map((entry) => ({
    attackerName: entry.attackerName,
    cemented: false,
  })),
  ...data.cemented.map((entry) => ({
    attackerName: entry.attackerName,
    cemented: true,
  })),
];

/**
 * Mirrors the server-side queue state onto the player's display object so the
 * client sees the pending/cemented split, the batch countdown, and the
 * per-cemented-word letter reveals. Call after any mutation of
 * pending/cemented/cementAt or any cemented entry's `reveal`.
 */
export const syncAttackQueueDisplay = (
  player: PlayerDisplay,
  data: AttackQueueState,
) => {
  player.attackQueueView = buildAttackQueueView(data);
  player.attackCementAt = data.pending.length > 0 ? data.cementAt : undefined;
  // display_queue is the client's hopper: one RevealedLetters per CEMENTED word
  // (pending words are hidden/ghosted and show no letters), in consume order.
  player.display_queue = data.cemented.map((entry) => entry.reveal ?? {});
};

/**
 * Moves an entire expired pending wave into the cemented list (arrival order),
 * respecting the cemented cap, and clears the batch timer. Returns true when a
 * wave actually cemented (so the caller can emit an update).
 */
export const cementPendingWave = (data: AttackQueueState): boolean => {
  if (data.pending.length === 0) {
    data.cementAt = undefined;
    return false;
  }

  for (const entry of data.pending) {
    if (data.cemented.length >= MAX_CEMENTED_ATTACK_WORDS) {
      // Cemented cap reached: surplus pending words are dropped rather than
      // cemented (same spirit as the old queue-full branch).
      break;
    }
    data.cemented.push(entry);
  }

  data.pending = [];
  data.cementAt = undefined;
  return true;
};

/**
 * Solve-scaled clearing of PENDING words only, earliest-first. `guessCount` is
 * how many guesses the defender took on their current word. Cemented words are
 * never touched here. See getPendingClearCount / ATTACK_MECHANICS.md §5.2a.
 */
export const clearPendingBySolve = (
  data: AttackQueueState,
  guessCount: number,
) => {
  const toClear = getPendingClearCount(guessCount);

  if (toClear === Number.POSITIVE_INFINITY || toClear >= data.pending.length) {
    data.pending = [];
    data.cementAt = undefined;
    return;
  }

  // Remove the earliest `toClear` pending words (front of the list).
  data.pending.splice(0, toClear);

  if (data.pending.length === 0) {
    data.cementAt = undefined;
  }
};

/**
 * Removes a single CEMENTED word matching `guess` exactly (accidental-match
 * side effect). Pending words are intentionally left alone. Returns true when a
 * cemented word was removed. The entry's letter reveal travels on the entry, so
 * removing the entry also removes its reveal — callers re-sync the display.
 */
export const removeAccidentallyGuessedCemented = (
  data: AttackQueueState,
  guess: string,
): boolean => {
  const normalized = guess.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  const index = data.cemented.findIndex(
    (entry) => entry.word.toUpperCase() === normalized,
  );
  if (index === -1) {
    return false;
  }
  data.cemented.splice(index, 1);
  return true;
};

/**
 * Index-bleed: for each full-match index on the defender's current guess,
 * reveal that same position on any CEMENTED word that shares the same letter at
 * that index. Positional coincidence only (see §5.2a). Writes reveals onto each
 * cemented entry's own `reveal`. Pending words are not bled onto.
 */
export const applyIndexBleedToCemented = (
  data: AttackQueueState,
  fullMatches: Record<number, string>,
) => {
  const matchIndexes = Object.keys(fullMatches).map(Number);
  if (matchIndexes.length === 0 || data.cemented.length === 0) {
    return;
  }

  for (const entry of data.cemented) {
    const word = entry.word.toUpperCase();
    const reveal: RevealedLetters = { ...(entry.reveal ?? {}) };
    let changed = false;

    for (const index of matchIndexes) {
      const letter = fullMatches[index];
      if (letter && word[index] === letter.toUpperCase()) {
        reveal[index] = word[index] as string;
        changed = true;
      }
    }

    if (changed) {
      entry.reveal = reveal;
    }
  }
};

/**
 * Time-scaled starting hints: builds the pre-revealed letters for a freshly
 * assigned NON-attack word based on how long the match has been running. Random
 * positions (Fisher-Yates), count from getStartingHintCount. Returns {} once
 * the match is past the hint tiers (late game = no help). See
 * shared/battle-royale STARTING_HINT_TIERS.
 */
/**
 * Match start timestamp (ms) derived from the room's matchEndTime, or undefined
 * before the match has started. Used to time-scale starting hints.
 */
export const getMatchStartMs = (game: Game): number | undefined =>
  game.room.matchEndTime === undefined
    ? undefined
    : game.room.matchEndTime - MATCH_TIME_LIMIT_MS;

export const buildStartingHints = (
  word: string,
  matchStartMs: number | undefined,
): RevealedLetters => {
  if (matchStartMs === undefined || !word) {
    return {};
  }
  const elapsed = Date.now() - matchStartMs;
  const count = getStartingHintCount(elapsed);
  if (count <= 0) {
    return {};
  }

  const upper = word.toUpperCase();
  const indexes = Array.from({ length: upper.length }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j] as number, indexes[i] as number];
  }

  const revealed: RevealedLetters = {};
  for (const index of indexes.slice(0, count)) {
    revealed[index] = upper[index] as string;
  }
  return revealed;
};

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

    // Track which timers were actually armed so the log reflects real teardown.
    const clearedTimers: string[] = [];

    if (startTimer) {
      clearTimeout(startTimer);
      clearedTimers.push("startTimer");
    }

    if (gameTimer) {
      clearInterval(gameTimer);
      clearedTimers.push("gameTimer");
    }

    if (botTicker) {
      clearInterval(botTicker);
      clearedTimers.push("botTicker");
    }

    if (updateTicker) {
      clearTimeout(updateTicker);
      clearedTimers.push("updateTicker");
    }

    if (matchTimer) {
      clearTimeout(matchTimer);
      clearedTimers.push("matchTimer");
    }

    logger.info({ roomId, clearedTimers }, "Cleared Battle Royale room timers");
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
      pending: [],
      cemented: [],
      level: getRandomLevel(),
      target: "random",
      botGuesses: 0,
    };

    botsDisplayData.set(botNameForNow, {
      name: botNameForNow,
      isAnonymous: false, // bots are never guest accounts
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
  const matchStartMs = getMatchStartMs(game);
  const lifeExpiry = Date.now() + initialTimer;
  const roomPlayerData = serverOnlyData.get(game.room.lobbyId)?.playerData;
  const roomBotData = serverOnlyBotData.get(game.room.lobbyId);
  for (const [playerId, player] of game.players) {
    player.life = lifeExpiry;

    // Seed time-scaled starting hints on each player's first word so the early
    // game is gentler (0:00 -> 2 letters by default). Attack words are never
    // the first word, so no attack-word guard is needed here.
    const data = roomPlayerData?.[playerId] ?? roomBotData?.[playerId];
    if (data && !data.currentWordIsAttack) {
      player.revealed_letters = buildStartingHints(data.word, matchStartMs);
    }
  }

  timers.gameTimer = setInterval(() => {
    const now = Date.now();

    // §5.2a: cement any pending attack waves whose grace window has expired,
    // for both humans and bots. A player's whole pending wave cements together.
    let anyCemented = false;
    const roomData = serverOnlyData.get(game.room.lobbyId);
    const botData = serverOnlyBotData.get(game.room.lobbyId);
    for (const [playerId, player] of game.players) {
      if (player.isEliminated) {
        continue;
      }
      const data: AttackQueueState | undefined =
        roomData?.playerData[playerId] ?? botData?.[playerId];
      if (
        data &&
        data.pending.length > 0 &&
        data.cementAt !== undefined &&
        now >= data.cementAt
      ) {
        if (cementPendingWave(data)) {
          anyCemented = true;
        }
        syncAttackQueueDisplay(player, data);
      }
    }

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
    // reveal their words. Everyone expiring on this tick shares one timestamp
    // so final placement treats them as a survival-time tie (broken by
    // performance in rankPlayers).
    const eliminatedAt = Date.now();
    const eliminatedThisTick: string[] = [];
    for (const [playerId, player] of expiringPlayers) {
      if (playerId === simultaneousWinnerId) {
        continue;
      }
      player.isEliminated = true;
      player.endTimeStamp = eliminatedAt;
      eliminatedThisTick.push(playerId);
      revealEliminatedPlayerWord(
        player,
        playerId,
        game.room.lobbyId,
        serverOnlyData,
        serverOnlyBotData,
      );
    }

    // Record each real player eliminated on this tick as a loss NOW, at the
    // moment their outcome is decided (Option 1: record-at-outcome). Bots and
    // already-recorded players are skipped inside the helper.
    if (eliminatedThisTick.length > 0) {
      persistEliminatedAsLoss(game, eliminatedThisTick);
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
    // A pending wave cementing this tick counts as a change worth broadcasting.
    if (expiringPlayers.length === 0 && !anyCemented && !game.room.isFinished) {
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
  matchStartMs,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerPlayerData | { [botId: string]: BotServerData };
  // Match start timestamp (ms); when provided, a freshly assigned non-attack
  // word gets time-scaled starting hints. Omit to disable (e.g. pre-start).
  matchStartMs?: number;
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

  // Life bonus is only awarded for solving a NON-attack word (unchanged rule).
  if (!serverData.currentWordIsAttack) {
    player.life = Math.min(currentLife + bonusLife, maxLifeExpiry);
  }

  // §5.2a: a fast solve of the current word clears pending (uncemented) attack
  // words earliest-first, BEFORE we pull the next word. Only pending is touched.
  clearPendingBySolve(serverData, player.currentWordGuesses);

  player.correctGuesses += 1;
  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];

  // §5.2a: the next word only ever comes from the CEMENTED list (pending words
  // are not yet real). Its letter reveal travels on the entry.
  const nextEntry = serverData.cemented.shift();

  const nextWord = nextEntry?.word ?? getRandomWord();
  serverData.word = nextWord;
  serverData.currentWordIsAttack = nextEntry !== undefined;
  // Attack words keep their attacker-speed reveal; a fresh random word gets the
  // time-scaled starting hints (0 if omitted / late game).
  player.revealed_letters = nextEntry
    ? (nextEntry.reveal ?? {})
    : buildStartingHints(nextWord, matchStartMs);

  // Mirror onto display data so the client can badge the attack word with the
  // attacker's initials while the player is guessing it.
  player.currentWordIsAttack = serverData.currentWordIsAttack;
  player.currentWordAttackerName = nextEntry?.attackerName;

  syncAttackQueueDisplay(player, serverData);
};

export const advanceToNextWord = ({
  player,
  userId,
  roomServerOnlyData,
  matchStartMs,
}: {
  player: PlayerDisplay;
  userId: string;
  roomServerOnlyData: ServerPlayerData | { [botId: string]: BotServerData };
  // Match start timestamp (ms); when provided, a freshly assigned non-attack
  // word gets time-scaled starting hints. Omit to disable.
  matchStartMs?: number;
}) => {
  const serverData = roomServerOnlyData[userId];
  if (!serverData) {
    logger.warn(
      { userId },
      "Word rollover skipped: player server data missing",
    );
    return;
  }

  const nextEntry = serverData.cemented.shift();

  player.currentWordGuesses = 0;
  player.noMatch = [];
  player.partialMatches = [];

  const nextWord = nextEntry?.word ?? getRandomWord();
  player.revealed_letters = nextEntry
    ? (nextEntry.reveal ?? {})
    : buildStartingHints(nextWord, matchStartMs);

  serverData.word = nextWord;
  serverData.currentWordIsAttack = nextEntry !== undefined;
  // Mirror onto display data so the client can badge the attack word with the
  // attacker's initials while the player is guessing it.
  player.currentWordIsAttack = serverData.currentWordIsAttack;
  player.currentWordAttackerName = nextEntry?.attackerName;

  syncAttackQueueDisplay(player, serverData);
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

  if (!targetServerData) {
    return;
  }

  // §5.2a: the word arrives as PENDING (under the batch grace window), NOT
  // straight into the real queue. If the pending set was empty, arm the shared
  // batch timer; later attacks join the SAME wave and do NOT reset it.
  if (targetServerData.pending.length === 0) {
    targetServerData.cementAt = Date.now() + ATTACK_PENDING_MS;
  }

  // Speed-scaled letter reveal (§2.3), attached to the entry so it travels with
  // the word through pending -> cemented -> consumed.
  let lettersToReveal = 2;
  if (guessCount > 7) {
    lettersToReveal = 4;
  } else if (guessCount > 3) {
    lettersToReveal = 3;
  }

  const word = guessedWord.toUpperCase();
  const availableIndexes = Array.from(
    { length: word.length },
    (_, index) => index,
  );
  // Fisher-Yates shuffle so revealed letters are randomly positioned.
  for (let i = availableIndexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableIndexes[i], availableIndexes[j]] = [
      availableIndexes[j] as number,
      availableIndexes[i] as number,
    ];
  }
  const reveal: RevealedLetters = {};
  for (const index of availableIndexes.slice(0, lettersToReveal)) {
    reveal[index] = word[index] as string;
  }

  const entry: AttackEntry = {
    word,
    attackerName: attackerName ?? "",
    reveal,
  };
  targetServerData.pending.push(entry);

  syncAttackQueueDisplay(target, targetServerData);
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
