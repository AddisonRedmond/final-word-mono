import { randomUUID } from "node:crypto";
import type { Game } from "../../../packages/types/src/game.ts";

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
			startTime: Date.now(),
			isStarted: false,
		},
		players: new Map(),
	};

	games.set(lobbyId, game);
	return game;
};
