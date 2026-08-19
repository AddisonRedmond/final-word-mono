import type {
	Game,
	ServerOnlyData,
	ServerOnlyRoomData,
} from "../../../packages/types/src/game.js";

export const startWaitTimer = (
	game: Game,
	games: Map<string, Game>,
	onStart: (game: Game) => void,
) => {
	return setTimeout(
		() => {
			const gameToStart = games.get(game.room.lobbyId);
			if (!gameToStart || gameToStart.room.isStarted) {
				return;
			}

			gameToStart.room.isStarted = true;
			onStart(gameToStart);
		},
		Math.max(game.room.startTime - Date.now(), 0),
	);
};

export const handleSetServerOnlyData = (
	serverOnlyData: ServerOnlyData,
	games: Map<string, Game>,
	roomId: string,
	game: Game,
	onStart: (game: Game) => void,
): ServerOnlyRoomData => {
	const existingServerOnlyData = serverOnlyData.get(roomId);
	if (existingServerOnlyData) {
		return existingServerOnlyData;
	}

	const roomServerOnlyData: ServerOnlyRoomData = {
		playerData: {},
		gameTimers: {
			startTimer: startWaitTimer(game, games, onStart),
		},
	};

	serverOnlyData.set(roomId, roomServerOnlyData);
	return roomServerOnlyData;
};
