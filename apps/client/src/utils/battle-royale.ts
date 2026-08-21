import type { Socket } from "socket.io-client";
import type { RefObject } from "react";
import type { TargetTypes } from "@/types/game";
import SpellCheckWords from "@/utils/spell-check-words";

export type SocketRef = RefObject<Socket | null>;

type GuessArgs = {
  guess: string;
  target: TargetTypes;
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
