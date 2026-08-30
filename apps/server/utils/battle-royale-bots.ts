import type {
  ServerBotData,
  PlayerDisplay,
  BotServerData,
} from "../../../packages/types/src/game.js";
import { applyCorrectGuessReward } from "./battle-royale.js";

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

const getBotGuessResult = ({
  level,
  botGuesses,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  botGuesses: number;
}): BotGuessResult => {
  const roll = Math.random() * 100;

  // The bot gets better the longer it has been guessing.
  const progressBonus = Math.min(botGuesses * 2, 20);

  // Base chance to correctly guess the entire word.
  const baseCorrectChance = {
    1: 2,
    2: 4,
    3: 7,
    4: 11,
    5: 16,
  }[level];

  // Chance to get a useful reveal.
  const baseRevealChance = {
    1: 20,
    2: 25,
    3: 30,
    4: 35,
    5: 40,
  }[level];

  const correctChance = baseCorrectChance + progressBonus;

  // Higher-level bots have a greater chance of revealing two letters.
  const revealTwoChance = {
    1: 5,
    2: 10,
    3: 20,
    4: 30,
    5: 40,
  }[level];

  if (roll < correctChance) {
    return {
      type: "correct",
    };
  }

  if (roll < correctChance + baseRevealChance) {
    const amount = Math.random() * 100 < revealTwoChance ? 2 : 1;

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
  const thinkTimes = {
    1: [4000, 7000],
    2: [3000, 6000],
    3: [2000, 5000],
    4: [1500, 3500],
    5: [1000, 2500],
  } as const;

  const [min, max] = thinkTimes[level];

  return getRandomInt(min, max);
};

export const runBots = (
  serverOnlyBotdata: {
    [botId: string]: BotServerData;
  },
  playerData: Map<string, PlayerDisplay>,
) => {
  return setInterval(() => {
    const now = Date.now();

    for (const [botId, botServerData] of Object.entries(serverOnlyBotdata)) {
      const botDisplayData = playerData.get(botId);

      if (!botDisplayData) {
        continue;
      }

      if (botDisplayData.isEliminated) {
        continue;
      }

      // The bot's life timer expired.
      if (now >= botDisplayData.life) {
        continue;
      }

      // The bot is still thinking.
      if (botServerData.guessTimeStamp && now < botServerData.guessTimeStamp) {
        continue;
      }

      const result = getBotGuessResult({
        level: botServerData.level,
        botGuesses: botServerData.botGuesses,
      });

      botServerData.botGuesses++;

      switch (result.type) {
        case "correct": {
          // Bot correctly guesses botServerData.word
          applyCorrectGuessReward({
            player:botDisplayData,
            userId:botId,
            roomServerOnlyData: serverOnlyBotdata,
          });

          break;
        }

        case "reveal": {
          // Reveal result.amount letters
          // Use botServerData.word to determine
          // which letters are available to reveal.

          break;
        }

        case "incorrect": {
          // Incorrect guess
          // For now, no additional information gained.

          break;
        }
      }

      // Schedule the bot's next guess.
      botServerData.guessTimeStamp = now + getBotThinkTime(botServerData.level);
    }
  }, 250);
};
