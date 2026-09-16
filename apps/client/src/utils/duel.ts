import words from "./words";

export const getRandomWord = (): string => {
  return words[Math.floor(Math.random() * words.length)]!;
};
