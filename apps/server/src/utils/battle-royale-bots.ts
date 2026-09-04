import type {
  ServerBotData,
  PlayerDisplay,
  BotServerData,
  ServerPlayerData,
} from "types/battle-royale.types.js";
import {
  applyAttack,
  applyCorrectGuessReward,
  determineTarget,
} from "./battle-royale.js";
import logger from "./logger.js";

type BotGuessResult =
  | {
      type: "correct";
    }
  | {
      type: "reveal";
      amount: 1 | 2;
    }
  | {
      type: "incorrect";
    };

const getRandomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const ALL_LETTER_INDEXES = [0, 1, 2, 3, 4];

// hoisted so these lookup tables aren't re-allocated on every bot tick
const BASE_CORRECT_CHANCE = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 11 } as const;
const BASE_REVEAL_CHANCE = { 1: 20, 2: 25, 3: 30, 4: 35, 5: 40 } as const;
const REVEAL_TWO_CHANCE = { 1: 5, 2: 10, 3: 20, 4: 30, 5: 40 } as const;
const THINK_TIMES = {
  1: [8000, 14000],
  2: [6500, 12000],
  3: [5000, 10000],
  4: [3500, 7000],
  5: [2500, 5000],
} as const;

const revealRandom = (
  numberToReveal: number,
  oldReveal: number[],
  word: string,
) => {
  const available = ALL_LETTER_INDEXES.filter(
    (number) => !oldReveal.includes(number),
  );

  // Fisher-Yates instead of a random-comparator sort (which is biased and
  // allocates an extra copy via the leading spread).
  for (let i = available.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const reveal: Record<number, string> = {};
  for (const index of oldReveal) {
    reveal[index] = word[index] as string;
  }
  for (const index of available.slice(0, numberToReveal)) {
    reveal[index] = word[index] as string;
  }

  return reveal;
};

const getBotGuessResult = ({
  level,
  botGuesses,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  botGuesses: number;
}): BotGuessResult => {
  const roll = Math.random() * 100;

  // The bot gets better the longer it has been guessing.
  const progressBonus = Math.min(botGuesses * 1.5, 15);

  const correctChance = BASE_CORRECT_CHANCE[level] + progressBonus;
  const baseRevealChance = BASE_REVEAL_CHANCE[level];

  if (roll < correctChance) {
    return {
      type: "correct",
    };
  }

  if (roll < correctChance + baseRevealChance) {
    const amount = Math.random() * 100 < REVEAL_TWO_CHANCE[level] ? 2 : 1;

    return {
      type: "reveal",
      amount,
    };
  }

  return {
    type: "incorrect",
  };
};

const getBotThinkTime = (level: 1 | 2 | 3 | 4 | 5) => {
  const [min, max] = THINK_TIMES[level];

  return getRandomInt(min, max);
};

export const runBots = (
  serverOnlyBotdata: {
    [botId: string]: BotServerData;
  },
  playerData: Map<string, PlayerDisplay>,
  playerServerData: ServerPlayerData,
  onUpdate: () => void,
) => {
  logger.info({ botCount: Object.keys(serverOnlyBotdata).length }, "Starting bot ticker");
  return setInterval(() => {
    const now = Date.now();

    // avoid allocating an entries array every tick
    for (const botId in serverOnlyBotdata) {
      const botServerData = serverOnlyBotdata[botId];

      if (!botServerData) {
        continue;
      }

      const botDisplayData = playerData.get(botId);

      if (!botDisplayData) {
        continue;
      }

      if (botDisplayData.isEliminated) {        continue;
      }

      // The bot's life timer expired.
      if (now >= botDisplayData.life) {
        continue;
      }

      // First tick since the bot was added/started: begin thinking instead of
      // guessing immediately (guessTimeStamp is unset until after a guess).
      if (botServerData.guessTimeStamp === undefined) {
        botServerData.guessTimeStamp =
          now + getBotThinkTime(botServerData.level);
        continue;
      }

      // The bot is still thinking.
      if (now < botServerData.guessTimeStamp) {
        continue;
      }

      const result = getBotGuessResult({
        level: botServerData.level,
        botGuesses: botServerData.botGuesses,
      });

      botServerData.botGuesses++;
      botDisplayData.totalGuesses += 1;
      botDisplayData.currentWordGuesses += 1;

      switch (result.type) {
        case "correct": {
          const guessCount = botDisplayData.currentWordGuesses;
          const guessedWord = botServerData.word;

          applyCorrectGuessReward({
            player: botDisplayData,
            userId: botId,
            roomServerOnlyData: serverOnlyBotdata,
          });

          const targetId = determineTarget(
            playerData,
            botId,
            botServerData.target,
          );
          const target = playerData.get(targetId);
          const targetServerData =
            serverOnlyBotdata[targetId] ?? playerServerData[targetId];

          applyAttack(guessedWord, guessCount, target, targetServerData);
          onUpdate();

          break;
        }

        case "reveal": {
          const updatedReveal = revealRandom(
            result.amount,
            Object.keys(botDisplayData.revealed_letters ?? {}).map(Number),
            botServerData.word,
          );

          botDisplayData.revealed_letters = updatedReveal;

          onUpdate();

          break;
        }

        case "incorrect": {
          // Incorrect guess.
          // For now, no additional information gained.

          onUpdate();

          break;
        }
      }

      // Schedule the bot's next guess.
      botServerData.guessTimeStamp = now + getBotThinkTime(botServerData.level);
    }
  }, 250);
};
