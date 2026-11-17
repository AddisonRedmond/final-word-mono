import { describe, expect, it, vi } from "vitest";

// battle-royale.ts pulls in the DB-backed stats module and the lobby emitter;
// neither is exercised by these pure queue rules, so stub them out.
vi.mock("../stats.js", () => ({
	persistBattleRoyaleStats: vi.fn(),
	persistEliminatedAsLoss: vi.fn(),
	stampWinnerPoints: vi.fn(),
}));
vi.mock("../lobby.js", () => ({ emitBattleRoyaleKeyframe: vi.fn() }));

import type {
	AttackEntry,
	PlayerDisplay,
	PlayerServerData,
} from "types/battle-royale.types.js";
import {
	canAbsorbAttack,
	deliverAttack,
	hasQueueRoom,
	queuedCount,
	stripRevealedLetter,
} from "./battle-royale.js";

const entry = (word: string, reveal: Record<number, string> = {}): AttackEntry => ({
	word,
	attackerName: "A",
	reveal,
});

const serverData = (
	pending: AttackEntry[] = [],
	cemented: AttackEntry[] = [],
): PlayerServerData => ({
	word: "CRANE",
	currentWordIsAttack: false,
	pending,
	cemented,
});

const display = (overrides: Partial<PlayerDisplay> = {}): PlayerDisplay =>
	({
		name: "P",
		isEliminated: false,
		life: Date.now() + 60_000,
		totalGuesses: 0,
		correctGuesses: 0,
		currentWordGuesses: 0,
		...overrides,
	}) as PlayerDisplay;

const full = (reveals: Record<number, string>[]) =>
	serverData(
		[],
		reveals.map((reveal, i) => entry(`WORD${i}`, reveal)),
	);

const totalRevealed = (data: PlayerServerData) =>
	[...data.pending, ...data.cemented].reduce(
		(sum, e) => sum + Object.keys(e.reveal ?? {}).length,
		0,
	);

describe("queue cap", () => {
	it("counts pending and cemented words together against a cap of 4", () => {
		const data = serverData([entry("AAAAA"), entry("BBBBB")], [entry("CCCCC")]);
		expect(queuedCount(data)).toBe(3);
		expect(hasQueueRoom(data)).toBe(true);

		data.pending.push(entry("DDDDD"));
		expect(queuedCount(data)).toBe(4);
		expect(hasQueueRoom(data)).toBe(false);
	});
});

describe("stripRevealedLetter", () => {
	it("removes exactly one revealed letter", () => {
		const data = full([{ 0: "W", 1: "O" }, {}, {}, {}]);
		expect(stripRevealedLetter(data)).toBe(true);
		expect(totalRevealed(data)).toBe(1);
	});

	it("can strip from a pending word too", () => {
		const data = serverData(
			[entry("PEND1", { 2: "N" })],
			[entry("CEM01"), entry("CEM02"), entry("CEM03")],
		);
		expect(stripRevealedLetter(data)).toBe(true);
		expect(data.pending[0]?.reveal).toEqual({});
	});

	it("returns false when no queued word has a revealed letter", () => {
		const data = full([{}, {}, {}, {}]);
		expect(stripRevealedLetter(data)).toBe(false);
		expect(canAbsorbAttack(data)).toBe(false);
	});
});

describe("deliverAttack", () => {
	const setup = (targetData: PlayerServerData, otherData: PlayerServerData) => {
		const players = new Map<string, PlayerDisplay>([
			["attacker", display({ name: "Attacker" })],
			["target", display({ name: "Target" })],
			["other", display({ name: "Other" })],
		]);
		const data: Record<string, PlayerServerData> = {
			attacker: serverData(),
			target: targetData,
			other: otherData,
		};
		const run = () =>
			deliverAttack({
				players,
				attackerId: "attacker",
				targetId: "target",
				getServerData: (id) => data[id],
				guessedWord: "SLATE",
				guessCount: 2,
				attackerName: "Attacker",
			});
		return { players, data, run };
	};

	it("queues the word when the target has room", () => {
		const { data, run } = setup(serverData(), serverData());
		expect(run()).toBe("target");
		expect(data.target?.pending).toHaveLength(1);
		expect(data.other?.pending).toHaveLength(0);
	});

	it("strips a letter from a full target instead of queuing", () => {
		const target = full([{ 0: "W" }, {}, {}, {}]);
		const { data, players, run } = setup(target, serverData());

		expect(run()).toBe("target");
		expect(queuedCount(target)).toBe(4);
		expect(totalRevealed(target)).toBe(0);
		expect(data.other?.pending).toHaveLength(0);
		expect(players.get("target")?.lastAttackerName).toBe("Attacker");
	});

	it("redirects to another opponent when the full target has nothing to strip", () => {
		const target = full([{}, {}, {}, {}]);
		const { data, run } = setup(target, serverData());

		expect(run()).toBe("other");
		expect(queuedCount(target)).toBe(4);
		expect(data.other?.pending).toHaveLength(1);
	});

	it("never redirects back to the attacker", () => {
		const { data, run } = setup(full([{}, {}, {}, {}]), full([{}, {}, {}, {}]));
		expect(run()).toBe("");
		expect(data.attacker?.pending).toHaveLength(0);
	});

	it("never lands on an eliminated opponent", () => {
		const { players, data, run } = setup(full([{}, {}, {}, {}]), serverData());
		const eliminated = players.get("other");
		if (eliminated) eliminated.isEliminated = true;

		expect(run()).toBe("");
		expect(data.other?.pending).toHaveLength(0);
	});
});
