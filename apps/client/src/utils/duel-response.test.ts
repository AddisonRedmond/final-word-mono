import { describe, expect, it } from "vitest";
import type { duelParticipants, duels } from "@/db/schema";
import { resolveGuesses } from "@/server/duel-guesses";
import { buildDuelResponse, redactParticipantGuesses } from "./duel-response";
import { planExpiredDuel } from "./duel";

type Participant = typeof duelParticipants.$inferSelect;
type Duel = typeof duels.$inferSelect;

const row = (over: Partial<Participant>): Participant => ({
	duelId: "d1",
	userId: "u",
	startTime: new Date(1),
	endTime: null,
	totalGuesses: 0,
	success: false,
	// Simulate the deprecated column still holding data: it must never leak.
	guesses: ["LEGACY"],
	accepted: true,
	forfeited: false,
	completed_game_acknowledged: false,
	...over,
});

const GUESSES = { me: ["CRANE", "SLATE"], them: ["PLUMB", "WORLD"] };

describe("redactParticipantGuesses", () => {
	it("hides an opponent's guesses while the viewer is still playing", () => {
		const out = redactParticipantGuesses(
			[row({ userId: "me" }), row({ userId: "them", endTime: new Date(5) })],
			GUESSES,
			"me",
		);
		expect(out.find((p) => p.userId === "me")?.guesses).toEqual(GUESSES.me);
		expect(out.find((p) => p.userId === "them")?.guesses).toEqual([]);
	});

	it.each([
		["solved", { endTime: new Date(9), success: true }],
		["ran out of guesses", { endTime: new Date(9), success: false }],
		["forfeited", { endTime: new Date(9), forfeited: true }],
	])("reveals opponents' guesses once the viewer has %s", (_label, over) => {
		const out = redactParticipantGuesses(
			[row({ userId: "me", ...over }), row({ userId: "them" })],
			GUESSES,
			"me",
		);
		expect(out.find((p) => p.userId === "them")?.guesses).toEqual(GUESSES.them);
	});

	it("does not reveal to a viewer who declined (no endTime)", () => {
		const out = redactParticipantGuesses(
			[row({ userId: "me", accepted: false }), row({ userId: "them" })],
			GUESSES,
			"me",
		);
		expect(out.find((p) => p.userId === "them")?.guesses).toEqual([]);
	});

	it("never passes through the deprecated column's contents", () => {
		const out = redactParticipantGuesses(
			[row({ userId: "me" }), row({ userId: "them" })],
			{},
			"me",
		);
		for (const p of out) {
			expect(p.guesses).not.toContain("LEGACY");
		}
	});
});

describe("buildDuelResponse", () => {
	const duel = {
		id: "d1",
		initiatedBy: "me",
		createdAt: new Date(0),
		completed: false,
		winner: null,
		participants: ["me", "them"],
	} as Duel;

	it("grades only the viewer's own guesses and omits opponents' words", () => {
		const res = buildDuelResponse(
			duel,
			"PLUMB",
			[row({ userId: "me" }), row({ userId: "them", endTime: new Date(5), success: true })],
			"me",
			GUESSES,
		);
		expect(res.matchResults).toHaveLength(GUESSES.me.length);
		const serialized = JSON.stringify(res);
		// The opponent's winning guess (== the secret) must not appear anywhere.
		expect(serialized).not.toContain("WORLD");
		expect(res.secretWord).toBeUndefined();
	});
});

describe("resolveGuesses", () => {
	it("prefers the longer (more recent) list across the rollout", () => {
		expect(resolveGuesses(["A"], ["A", "B"])).toEqual(["A", "B"]);
		expect(resolveGuesses(["A", "B"], ["A"])).toEqual(["A", "B"]);
		expect(resolveGuesses([], [])).toEqual([]);
	});
});

describe("planExpiredDuel guess counting", () => {
	it("treats a player with no counted guesses as a forfeit, not a loss", () => {
		const rows = [
			row({ userId: "a", startTime: null, totalGuesses: 0, guesses: [] }),
			row({ userId: "b", startTime: new Date(1), totalGuesses: 2, guesses: [] }),
		];
		expect(planExpiredDuel(["a", "b"], rows).timedOut).toEqual([
			{ userId: "a", forfeited: true },
			{ userId: "b", forfeited: false },
		]);
	});
});
