import { create } from "zustand";

/**
 * Tracks whether the user is currently in a live realtime game (Battle Royale
 * or Race). This is set from the home page where those games mount/unmount.
 *
 * It exists so app-global UI — notably the duel notification toasts — can
 * avoid offering navigation that would yank the player out of an in-progress
 * match. While a realtime game is active, duel toasts drop their "View duels"
 * link so a stray click can't abandon the game.
 */
type GameSessionState = {
	isRealtimeGameActive: boolean;
	setRealtimeGameActive: (active: boolean) => void;
};

export const useGameSessionStore = create<GameSessionState>((set) => ({
	isRealtimeGameActive: false,
	setRealtimeGameActive: (active) => set({ isRealtimeGameActive: active }),
}));
