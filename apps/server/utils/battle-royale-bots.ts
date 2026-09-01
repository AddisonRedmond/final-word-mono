import type {
  ServerBotData,
  PlayerDisplay,
  BotServerData,
} from "types/battle-royale.types.js";
import {
  applyAttack,
  applyCorrectGuessReward,
  determineTarget,
} from "./battle-royale.js";

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

const revealRandom = (
  numberToReveal: number,
  oldReveal: number[],
  word: string,
) => {
  const available = [0, 1, 2, 3, 4].filter(
    (number) => !oldReveal.includes(number),
  );

  const shuffled = [...available].sort(() => Math.random() - 0.5);

  const reveal = [...oldReveal, ...shuffled.slice(0, numberToReveal)];

  return Object.fromEntries(reveal.map((index) => [index, word[index]]));
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
    1: [8000, 14000],
    2: [6500, 12000],
    3: [5000, 10000],
    4: [3500, 7000],
    5: [2500, 5000],
  } as const;

  const [min, max] = thinkTimes[level];

  return getRandomInt(min, max);
};

export const runBots = (
  serverOnlyBotdata: {
    [botId: string]: BotServerData;
  },
  playerData: Map<string, PlayerDisplay>,
  onUpdate: () => void,
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

          applyAttack(guessedWord, guessCount, target);
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
