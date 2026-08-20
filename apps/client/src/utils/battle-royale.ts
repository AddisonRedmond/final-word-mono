import type { Socket } from "socket.io-client";
import type { RefObject } from "react";

export type SocketRef = RefObject<Socket | null>;

export const sendGuess = (word: string, socketRef: SocketRef) => {
  const socket = socketRef.current;
  if (!socket || !socket.connected) {
    console.warn("Cannot send guess: socket is not connected");
    return;
  }

  socket.emit("guess", { word });
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
