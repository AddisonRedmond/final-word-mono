import { create } from "zustand";
import type { ClientMessage, ServerMessage } from "@/types/ws"

interface WsState {
  status: "connecting" | "open" | "closing" | "closed";
  lastMessage: ClientMessage | null;
  sendMessage: (msg: ServerMessage) => void;
  // internal setters called by useWebSocket hook
  _setSend: (fn: (msg: ServerMessage) => void) => void;
  _setStatus: (s: WsState["status"]) => void;
  _setLastMessage: (m: ClientMessage) => void;
}

export const useWsStore = create<WsState>((set) => ({
  status: "closed",
  lastMessage: null,
  sendMessage: () => {},
  _setSend: (fn) => set({ sendMessage: fn }),
  _setStatus: (s) => set({ status: s }),
  _setLastMessage: (m) => set({ lastMessage: m }),
}));
