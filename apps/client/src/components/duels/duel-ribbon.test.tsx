import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Duel, DuelParticipant } from "@/db/schema";
import DuelRibbon from "./duel-ribbon";

const duel = {
	id: "d1",
	initiatedBy: "opponent",
	createdAt: new Date("2025-01-01"),
	completed: false,
	winner: null,
	participants: ["me", "opponent"],
} as unknown as Omit<Duel, "word">;

const participant = (
	userId: string,
	overrides: Partial<DuelParticipant> = {},
): DuelParticipant =>
	({
		duelId: "d1",
		userId,
		startTime: null,
		endTime: null,
		totalGuesses: 0,
		success: false,
		guesses: [],
		accepted: true,
		forfeited: false,
		completed_game_acknowledged: false,
		...overrides,
	}) as DuelParticipant;

const renderRibbon = (
	props: Partial<React.ComponentProps<typeof DuelRibbon>> = {},
) =>
	render(
		<DuelRibbon
			currentUserId="me"
			duel={duel}
			friends={[]}
			handleArchive={vi.fn()}
			handleDeclineDuel={vi.fn()}
			handleForfeit={vi.fn()}
			participants={[]}
			startOrResumeDuel={vi.fn()}
			{...props}
		/>,
	);

describe("DuelRibbon while participants load", () => {
	afterEach(cleanup);

	it("shows no actions until participants have loaded", () => {
		renderRibbon({ participantsLoaded: false });

		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByLabelText("Loading duel actions")).toBeDefined();
	});

	it("does not offer Decline or Start for an invite before participants load", () => {
		renderRibbon({ participantsLoaded: false });

		expect(screen.queryByText("Decline")).toBeNull();
		expect(screen.queryByText("Start")).toBeNull();
	});

	it("shows the real actions once participants have loaded", () => {
		renderRibbon({
			participantsLoaded: true,
			participants: [
				participant("me", { endTime: new Date(), success: true }),
				participant("opponent"),
			],
		});

		expect(screen.getByText("View progress")).toBeDefined();
		expect(screen.queryByText("Forfeit")).toBeNull();
		expect(screen.queryByLabelText("Loading duel actions")).toBeNull();
	});
});
