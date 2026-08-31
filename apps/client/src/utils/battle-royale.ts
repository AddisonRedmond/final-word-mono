import type { Socket } from "socket.io-client";
import type { RefObject } from "react";
import type { PlayerDisplay, TargetType } from "@/types/battle-royale.types";
import SpellCheckWords from "@/utils/spell-check-words";

export type SocketRef = RefObject<Socket | null>;

type GuessArgs = {
  guess: string;
  target: TargetType;
  socketRef: SocketRef;
};

const validGuessWords = new Set(SpellCheckWords);

const normalizeGuess = (word: string): string => word.trim().toUpperCase();

const isValidGuess = (word: string): boolean => {
  const normalizedWord = normalizeGuess(word);

  if (!/^[A-Z]{5}$/.test(normalizedWord)) {
    return false;
  }

  return validGuessWords.has(normalizedWord);
};

export const sendGuess = ({ guess, target, socketRef }: GuessArgs): void => {
  const socket = socketRef.current;
  if (!socket || !socket.connected) {
    console.warn("Cannot send guess: socket is not connected");
    return;
  }

  if (!isValidGuess(guess)) {
    console.warn("Cannot send guess: invalid word");
    return;
  }

  socket.emit("guess", { word: normalizeGuess(guess), target });
};

export const sendJoin = (socketRef: SocketRef) => {
  const socket = socketRef.current;
  if (!socket || !socket.connected) {
    console.warn("Cannot join: socket is not connected");
    return;
  }

  socket.emit("join");
};

export const leave = (socketRef: SocketRef) => {
  const socket = socketRef.current;
  if (!socket || !socket.connected) {
    return;
  }

  socket.emit("leave", () => {
    socket.disconnect();
  });
};

export const determineTarget = (
  playerDisplayData: Record<string, PlayerDisplay>,
  target: TargetType,
): string => {
  const activePlayers = Object.entries(playerDisplayData).filter(
    ([, player]) => !player.isEliminated,
  );

  if (activePlayers.length === 0) {
    return "";
  }

  switch (target) {
    case "first": {
      return activePlayers.reduce((highest, current) =>
        current[1].life > highest[1].life ? current : highest,
      )[0];
    }

    case "last": {
      return activePlayers.reduce((lowest, current) =>
        current[1].life < lowest[1].life ? current : lowest,
      )[0];
    }

    case "random": {
      const randomIndex = Math.floor(Math.random() * activePlayers.length);

      return activePlayers[randomIndex]?.[0] ?? "";
    }

    default:
      // target is already a player UUID.
      return target;
  }
};
