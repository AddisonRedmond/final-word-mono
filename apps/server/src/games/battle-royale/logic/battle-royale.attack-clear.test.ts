import { describe, expect, it, vi } from "vitest";
import type {
	PlayerDisplay,
	PlayerServerData,
} from "types/battle-royale.types.js";

// `battle-royale.ts` transitively imports `db` (via stats); the code under test
// doesn't touch it, but the import graph does — mock it to a no-op surface.
vi.mock("db", () => ({ db: {} }));

const { applyCorrectGuessReward } = await import("./battle-royale.js");

// Feature: realtime attack mechanics (ATTACK_MECHANICS.md §5.2a).
//
// Regression: only solving your CURRENT REAL (non-attack) word defends against
// incoming attacks — a fast real-word solve clears PENDING (uncemented) attack
// words earliest-first. Surviving an ATTACK word must NOT mitigate incoming
// pending attacks (the bug: `clearPendingBySolve` ran unconditionally, so
// solving an attacked-in word was wiping the pending wave too).
//
// `applyCorrectGuessReward` reads `serverData.currentWordIsAttack` for the word
// JUST solved, then pulls the next word, so these tests set that flag to model
// "the word the defender just solved."

const USER = "u1";

const makePlayer = (over: Partial<PlayerDisplay> = {}): PlayerDisplay => ({
	name: USER,
	isEliminated: false,
	life: Date.now() + 30_000,
	totalGuesses: 0,
	correctGuesses: 0,
	currentWordGuesses: 1,
	...over,
});

// Three pending attack words under a live batch grace window.
const makeServerData = (
	over: Partial<PlayerServerData> = {},
): PlayerServerData => ({
	word: "APPLE",
	currentWordIsAttack: false,
	pending: [
		{ word: "WORD1", attackerName: "a" },
		{ word: "WORD2", attackerName: "b" },
		{ word: "WORD3", attackerName: "c" },
	],
	cemented: [],
	cementAt: Date.now() + 10_000,
	...over,
});

describe("applyCorrectGuessReward — pending clear is real-word only (§5.2a)", () => {
	it("solving an ATTACK word does NOT clear any pending attacks (the bug)", () => {
		const player = makePlayer({ currentWordGuesses: 1 }); // fast solve
		const serverData = makeServerData({ currentWordIsAttack: true });
		const roomServerOnlyData: Record<string, PlayerServerData> = {
			[USER]: serverData,
		};
		const pendingBefore = serverData.pending.length;

		applyCorrectGuessReward({
			player,
			userId: USER,
			roomServerOnlyData,
		});

		// A 1-guess solve would normally clear ALL pending — but this was an
		// attack word, so the pending wave is untouched.
		expect(serverData.pending).toHaveLength(pendingBefore);
		expect(serverData.pending.map((p) => p.word)).toEqual([
			"WORD1",
			"WORD2",
			"WORD3",
		]);
	});

	it("solving a REAL word fast (<=2 guesses) clears the whole pending wave", () => {
		const player = makePlayer({ currentWordGuesses: 2 });
		const serverData = makeServerData({ currentWordIsAttack: false });
		const roomServerOnlyData: Record<string, PlayerServerData> = {
			[USER]: serverData,
		};

		applyCorrectGuessReward({
			player,
			userId: USER,
			roomServerOnlyData,
		});

		expect(serverData.pending).toHaveLength(0);
		expect(serverData.cementAt).toBeUndefined();
	});

	it("solving a REAL word in 3-4 guesses clears the two earliest pending", () => {
		const player = makePlayer({ currentWordGuesses: 3 });
		const serverData = makeServerData({ currentWordIsAttack: false });
		const roomServerOnlyData: Record<string, PlayerServerData> = {
			[USER]: serverData,
		};

		applyCorrectGuessReward({
			player,
			userId: USER,
			roomServerOnlyData,
		});

		// Earliest-first: WORD1 + WORD2 removed, WORD3 remains.
		expect(serverData.pending.map((p) => p.word)).toEqual(["WORD3"]);
	});

	it("an attack word also does not award the life bonus (unchanged rule)", () => {
		const before = Date.now() + 30_000;
		const player = makePlayer({ currentWordGuesses: 1, life: before });
		const serverData = makeServerData({ currentWordIsAttack: true });
		const roomServerOnlyData: Record<string, PlayerServerData> = {
			[USER]: serverData,
		};

		applyCorrectGuessReward({
			player,
			userId: USER,
			roomServerOnlyData,
		});

		// No life bonus for an attack-word solve: life is not extended beyond its
		// prior value by a guess bonus.
		expect(player.life).toBeLessThanOrEqual(before + 5);
	});
});
