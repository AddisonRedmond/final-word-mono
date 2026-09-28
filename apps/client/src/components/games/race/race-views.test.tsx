import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
	EliminatedEvent,
	MatchResult,
	RoundTransition as RoundTransitionPayload,
} from "@/hooks/useRaceSocket";
import type {
	ClientRaceMatch,
	LetterFeedback,
	RacePhase,
	RacePlayer,
} from "@/types/race.types";
import EliminationView from "./elimination-view";
import LobbyView from "./lobby-view";
import ResultView from "./result-view";
import RoundBoard from "./round-board";
import RoundTransition from "./round-transition";

// -- Fixtures ---------------------------------------------------------------
//
// Minimal ClientRaceMatch builders. The views only read the fields they need,
// so we keep the fixtures small and override per test. `expiryTimestamp`s are
// pushed well into the future so CountDownTimer renders its active state (the
// server-clock-store defaults offsetMs to 0, so no store mock is required).

const FUTURE = () => Date.now() + 60_000;

function makePlayer(overrides: Partial<RacePlayer> = {}): RacePlayer {
	return {
		name: "Player",
		isBot: false,
		isEliminated: false,
		completedWords: 0,
		qualified: false,
		roundGuesses: 0,
		totalGuesses: 0,
		correctGuesses: 0,
		correctLetters: 0,
		...overrides,
	};
}

function makeMatch(
	phase: RacePhase,
	players: Record<string, RacePlayer>,
	roomOverrides: Partial<ClientRaceMatch["room"]> = {},
): ClientRaceMatch {
	return {
		room: {
			matchId: "match-1",
			phase,
			createdAt: 0,
			lobbyDeadline: FUTURE(),
			currentRoundIndex: 0,
			roundEndsAt: FUTURE(),
			isDraw: false,
			...roomOverrides,
		},
		players,
	};
}

// This project's vitest config does not enable `globals`, so testing-library's
// automatic per-test cleanup isn't auto-registered. Unmount explicitly between
// tests so rendered DOM (and the round-board's window keydown listener) doesn't
// leak across cases.
afterEach(() => {
	cleanup();
});

// -- LobbyView (Req 10.1) ---------------------------------------------------

describe("LobbyView (Req 10.1)", () => {
	it("renders the Game Starting countdown and a warm-up guess board instead of a roster list", () => {
		const match = makeMatch("lobby", {
			me: makePlayer({ name: "Alice" }),
			other: makePlayer({ name: "Bob" }),
			bot0: makePlayer({ name: "Botty", isBot: true }),
		});

		const { container } = render(
			<LobbyView match={match} onLeave={() => {}} userId="me" />,
		);

		// Battle-Royale-style pre-start: a "Game Starting" countdown...
		expect(screen.getByText("Game Starting")).toBeDefined();
		// ...and the shared guess tiles (round 0 uses 4-letter words).
		const tiles = Array.from(
			container.querySelectorAll<HTMLElement>(".size-14"),
		);
		expect(tiles).toHaveLength(4);

		// The old "Players in Lobby (N)" roster list is gone (opponents render as
		// flanking columns handled by the Race root instead).
		expect(screen.queryByText(/Players in Lobby/)).toBeNull();
		expect(screen.queryByText("Alice (you)")).toBeNull();
	});

	it("lets the player type warm-up letters but disables submitting (no Enter)", () => {
		const match = makeMatch("lobby", { me: makePlayer({ name: "Alice" }) });

		const { container } = render(
			<LobbyView match={match} onLeave={() => {}} userId="me" />,
		);

		// Typing a letter fills the first tile (warm-up allowed).
		fireEvent.keyDown(window, { key: "H" });
		const tiles = Array.from(
			container.querySelectorAll<HTMLElement>(".size-14"),
		);
		expect(tiles[0]?.textContent).toContain("H");

		// The Enter key is disabled in the lobby — no submit path exists.
		const enter = screen.getByRole("button", { name: "Enter" });
		expect(enter).toHaveProperty("disabled", true);
	});
});

// -- RoundBoard (Req 10.2, 10.6) --------------------------------------------

describe("RoundBoard (Req 10.2, 10.6)", () => {
	// Round 0 of the shipped RACE_CONFIG: 4-letter words, qualify with 3.
	const feedback: LetterFeedback[] = [
		{ index: 0, letter: "W", state: "correct" },
		{ index: 1, letter: "O", state: "present" },
		{ index: 2, letter: "R", state: "absent" },
		{ index: 3, letter: "D", state: "correct" },
	];

	it("renders the round number, word-length/qualifying text, progress and the timer", () => {
		const match = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 1 }) },
			{ currentRoundIndex: 0 },
		);

		render(
			<RoundBoard
				lastFeedback={undefined}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		// Round number is 1-based.
		expect(screen.getByText("Round 1")).toBeDefined();
		// Word length + qualifying count text from RACE_CONFIG round 0.
		expect(screen.getByText("4-letter words · qualify with 3")).toBeDefined();
		// Progress is now shown as segmented bars, labelled for accessibility.
		expect(screen.getByLabelText("Progress: 1 of 3 words")).toBeDefined();
		// Round timer renders — the shared Battle Royale MatchTimer with a Race
		// caption.
		expect(screen.getByText("Round Ends In")).toBeDefined();
	});

	it("renders one progress bar per qualifying word and fills one per completed word", () => {
		const match = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 1 }) },
			{ currentRoundIndex: 0 },
		);

		render(
			<RoundBoard
				lastFeedback={undefined}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		// Round 0 qualifies with 3 words, so there are three bar segments. Each
		// segment's inner fill carries the animated target width — a completed
		// word fills its bar to 100%, the rest stay at 0%.
		const bars = screen.getByLabelText("Progress: 1 of 3 words");
		const fills = Array.from(
			bars.querySelectorAll<HTMLElement>(".bg-emerald-400"),
		);
		expect(fills).toHaveLength(3);
		// First bar filled (completedWords === 1), the other two empty. The fill
		// state is exposed via data-filled (the width itself is animated, so its
		// inline style isn't settled synchronously in jsdom).
		expect(fills[0]?.dataset.filled).toBe("true");
		expect(fills[1]?.dataset.filled).toBe("false");
		expect(fills[2]?.dataset.filled).toBe("false");
	});

	it("surfaces per-letter feedback the Battle Royale way: correct letters as tile corner hints and coloured keyboard keys (Req 10.6)", () => {
		const match = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice" }) },
			{ currentRoundIndex: 0 },
		);

		const { container } = render(
			<RoundBoard
				lastFeedback={feedback}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		// The active guess row is the shared GuessTiles (`size-14`). With no
		// in-progress guess the tiles are empty, but the KNOWN-CORRECT letters are
		// pinned to their positions' top-right corners as match hints, matching
		// Battle Royale's `GuessContainer`. Round 0 words are 4 letters long.
		const tiles = Array.from(
			container.querySelectorAll<HTMLElement>(".size-14"),
		);
		expect(tiles).toHaveLength(4);
		// The two `correct` letters (W at index 0, D at index 3) show as corner
		// hints; `present`/`absent` letters do not.
		expect(tiles[0]?.textContent).toContain("W");
		expect(tiles[3]?.textContent).toContain("D");

		// The on-screen keyboard colours its keys from the same feedback: correct
		// keys green, present amber, absent stone.
		const key = (letter: string) =>
			screen.getByRole("button", { name: `Type ${letter}` });
		expect(key("W").className).toContain("bg-emerald-500"); // correct
		expect(key("O").className).toContain("bg-amber-400"); // present
		expect(key("R").className).toContain("bg-stone-400"); // absent
	});

	it("shows the qualified banner and clamps progress once qualified", () => {
		const match = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 3, qualified: true }) },
			{ currentRoundIndex: 0 },
		);

		render(
			<RoundBoard
				lastFeedback={undefined}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		expect(screen.getByText("Qualified!")).toBeDefined();
		// All three progress bars are filled once the qualifying count is met.
		expect(screen.getByLabelText("Progress: 3 of 3 words")).toBeDefined();
	});

	it("shows how many players have qualified out of the round's advancing spots", () => {
		// 10 alive players, two of them qualified. Round 0 eliminationPct 0.5 →
		// eliminate ceil(10 * 0.5) = 5, so 5 advancing spots.
		const players: Record<string, ReturnType<typeof makePlayer>> = {
			me: makePlayer({ name: "Alice", qualified: true }),
			p2: makePlayer({ name: "Bob", qualified: true }),
		};
		for (let i = 0; i < 8; i++) {
			players[`p${i + 3}`] = makePlayer({ name: `P${i}` });
		}

		const match = makeMatch("round", players, { currentRoundIndex: 0 });

		render(
			<RoundBoard
				lastFeedback={undefined}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		expect(screen.getByText("2 / 5 qualified")).toBeDefined();
	});

	it("persists keyboard hints across guesses of the same word and resets them on a correct guess", () => {
		const match = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice" }) },
			{ currentRoundIndex: 0 },
		);

		// Round 0 uses 4-letter words, so feedback is 4 entries (a full graded
		// guess). First guess "STUB": S=absent, T=present, U=absent, B=absent.
		const first: LetterFeedback[] = [
			{ index: 0, letter: "S", state: "absent" },
			{ index: 1, letter: "T", state: "present" },
			{ index: 2, letter: "U", state: "absent" },
			{ index: 3, letter: "B", state: "absent" },
		];
		const { rerender } = render(
			<RoundBoard
				lastFeedback={first}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		const key = (letter: string) =>
			screen.getByRole("button", { name: `Type ${letter}` });
		expect(key("S").className).toContain("bg-stone-400"); // absent
		expect(key("T").className).toContain("bg-amber-400"); // present

		// A SECOND guess of the same word grades A=correct (plus other letters).
		// The earlier S/T indications must PERSIST (not be overwritten).
		const second: LetterFeedback[] = [
			{ index: 0, letter: "A", state: "correct" },
			{ index: 1, letter: "T", state: "present" },
			{ index: 2, letter: "O", state: "absent" },
			{ index: 3, letter: "M", state: "absent" },
		];
		rerender(
			<RoundBoard
				lastFeedback={second}
				match={match}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		expect(key("A").className).toContain("bg-emerald-500"); // new correct
		expect(key("S").className).toContain("bg-stone-400"); // still absent
		expect(key("T").className).toContain("bg-amber-400"); // still present

		// A CORRECT guess advances completedWords → a new word → the accumulated
		// hints reset, so S/T/A go back to the default (uncoloured) state.
		const advanced = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 1 }) },
			{ currentRoundIndex: 0 },
		);
		rerender(
			<RoundBoard
				lastFeedback={undefined}
				match={advanced}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		expect(key("S").className).not.toContain("bg-stone-400");
		expect(key("T").className).not.toContain("bg-amber-400");
		expect(key("A").className).not.toContain("bg-emerald-500");
	});

	it("does not carry a previous round's feedback into a new round", () => {
		// Round 0 (4-letter words): grade a guess so the keyboard colours some
		// keys.
		const round0 = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice" }) },
			{ currentRoundIndex: 0 },
		);
		const round0Feedback: LetterFeedback[] = [
			{ index: 0, letter: "Q", state: "absent" },
			{ index: 1, letter: "R", state: "present" },
			{ index: 2, letter: "S", state: "absent" },
			{ index: 3, letter: "T", state: "correct" },
		];
		const { rerender } = render(
			<RoundBoard
				lastFeedback={round0Feedback}
				match={round0}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		const key = (letter: string) =>
			screen.getByRole("button", { name: `Type ${letter}` });
		expect(key("T").className).toContain("bg-emerald-500");
		expect(key("R").className).toContain("bg-amber-400");
		expect(key("Q").className).toContain("bg-stone-400");

		// Round 1 begins (5-letter words, completedWords reset to 0). The parent
		// hook still holds round 0's last ack, so `lastFeedback` is momentarily
		// the stale round-0 feedback when the round-1 board first renders. Its
		// length (4) no longer matches round 1's word length (5), so it must be
		// ignored: the keyboard starts the new round blank.
		const round1 = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 0 }) },
			{ currentRoundIndex: 1 },
		);
		rerender(
			<RoundBoard
				lastFeedback={round0Feedback}
				match={round1}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		expect(key("T").className).not.toContain("bg-emerald-500");
		expect(key("R").className).not.toContain("bg-amber-400");
		expect(key("Q").className).not.toContain("bg-stone-400");
	});

	it("clears the tile corner hints when a correct guess starts a new word, even if the winning all-correct ack is still the latest feedback", () => {
		// Reproduces the reported bug: on a correct guess the server sends the
		// all-`correct` ack for the SOLVED word and then a snapshot with the
		// advanced completedWords. `lastFeedback` still points at that winning ack
		// when the word changes, so the new word's tiles must NOT inherit the
		// solved word's corner hints.
		const word0 = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 0 }) },
			{ currentRoundIndex: 0 },
		);

		// The winning guess for the first word: every position correct (WORD).
		const winningAck: LetterFeedback[] = [
			{ index: 0, letter: "W", state: "correct" },
			{ index: 1, letter: "O", state: "correct" },
			{ index: 2, letter: "R", state: "correct" },
			{ index: 3, letter: "D", state: "correct" },
		];

		const { container, rerender } = render(
			<RoundBoard
				lastFeedback={winningAck}
				match={word0}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		const cornerHints = () =>
			Array.from(container.querySelectorAll<HTMLElement>(".size-14")).map(
				// The corner hint is the small absolute-positioned <p> in each tile.
				(tile) =>
					tile.querySelector<HTMLElement>("p.absolute")?.textContent ?? "",
			);

		// Before the word advances the solved word's letters show as corner hints.
		expect(cornerHints()).toEqual(["W", "O", "R", "D"]);

		// The snapshot advances completedWords (a new word) while `lastFeedback`
		// STILL holds the winning all-correct ack (same object reference).
		const word1 = makeMatch(
			"round",
			{ me: makePlayer({ name: "Alice", completedWords: 1 }) },
			{ currentRoundIndex: 0 },
		);
		rerender(
			<RoundBoard
				lastFeedback={winningAck}
				match={word1}
				onGuess={() => {}}
				onLeave={() => {}}
				userId="me"
			/>,
		);

		// The new word's tiles carry NO corner hints — the previous word's
		// revealed letters were reset.
		expect(cornerHints()).toEqual(["", "", "", ""]);
	});
});

// -- RoundTransition (Req 10.3) ---------------------------------------------

describe("RoundTransition (Req 10.3)", () => {
	it("congratulates the (advanced) player and counts down to the next round", () => {
		// Anyone who sees the intermission has advanced — an eliminated player is
		// routed to EliminationView by the root instead. So the view no longer
		// lists advanced/eliminated players; it just qualifies + counts down.
		const match = makeMatch(
			"intermission",
			{ me: makePlayer({ name: "Alice" }) },
			{ nextRoundStartsAt: FUTURE() },
		);

		const transition: RoundTransitionPayload = {
			roundIndex: 0,
			advanced: ["me"],
			eliminated: ["c"],
		};

		render(<RoundTransition match={match} transition={transition} />);

		// Qualification message + next-round prompt (round that ended was 0 →
		// next round is round 2, 1-based).
		expect(screen.getByText("You qualified!")).toBeDefined();
		expect(screen.getByText("Get ready for round 2")).toBeDefined();
		// The next-round countdown renders (shared MatchTimer with a Race label).
		expect(screen.getByText("Next round in")).toBeDefined();

		// The old advanced/eliminated player lists are gone.
		expect(screen.queryByText(/Advanced \(/)).toBeNull();
		expect(screen.queryByText(/Eliminated \(/)).toBeNull();
	});

	it("derives the next round number from the match when there is no transition payload", () => {
		const match = makeMatch(
			"intermission",
			{ me: makePlayer({ name: "Alice" }) },
			{ currentRoundIndex: 1, nextRoundStartsAt: FUTURE() },
		);

		render(<RoundTransition match={match} transition={undefined} />);

		expect(screen.getByText("You qualified!")).toBeDefined();
		// Falls back to currentRoundIndex + 1 (1 + 1 = round 2).
		expect(screen.getByText("Get ready for round 2")).toBeDefined();
	});
});

// -- EliminationView (Req 10.4) ---------------------------------------------

describe("EliminationView (Req 10.4)", () => {
	it("renders the placement as an ordinal", () => {
		const elimination: EliminatedEvent = { placement: 3 };
		const player = makePlayer({
			name: "Alice",
			totalGuesses: 7,
			correctGuesses: 2,
		});

		render(
			<EliminationView
				elimination={elimination}
				onLeave={() => {}}
				player={player}
			/>,
		);

		// Restyled to Battle Royale's card: uppercase header + name + stat grid.
		expect(screen.getByText("ELIMINATED")).toBeDefined();
		expect(screen.getByText("Alice")).toBeDefined();
		expect(screen.getByText("3rd")).toBeDefined();
		// Stat grid surfaces the player's aggregates.
		expect(screen.getByText("7")).toBeDefined();
		expect(screen.getByText("2")).toBeDefined();
	});

	it("shows the eliminated state without a placement when the payload is absent", () => {
		const player = makePlayer({ name: "Alice" });

		render(
			<EliminationView
				elimination={undefined}
				onLeave={() => {}}
				player={player}
			/>,
		);

		expect(screen.getByText("ELIMINATED")).toBeDefined();
		// No placement text is rendered without a payload or persisted placement.
		expect(screen.queryByText(/Final placement/)).toBeNull();
	});
});

// -- ResultView (Req 10.5) --------------------------------------------------

describe("ResultView (Req 10.5)", () => {
	it("announces victory and lists placements when this player wins", () => {
		const match = makeMatch(
			"finished",
			{
				me: makePlayer({ name: "Alice" }),
				b: makePlayer({ name: "Bob" }),
			},
			{ winnerId: "me" },
		);

		const result: MatchResult = {
			winnerId: "me",
			placements: [
				{ playerId: "me", placement: 1 },
				{ playerId: "b", placement: 2 },
			],
		};

		render(
			<ResultView
				match={match}
				onLeave={() => {}}
				result={result}
				userId="me"
			/>,
		);

		expect(screen.getByText("Victory")).toBeDefined();
		expect(screen.getByText("You had the FINAL WORD")).toBeDefined();
		// Placement ordering resolves ids to names.
		expect(screen.getByText("Alice (you)")).toBeDefined();
		expect(screen.getByText("Bob")).toBeDefined();
	});

	it("shows the winner name and own placement when this player loses", () => {
		const match = makeMatch(
			"finished",
			{
				me: makePlayer({ name: "Alice" }),
				w: makePlayer({ name: "Zoe" }),
			},
			{ winnerId: "w" },
		);

		const result: MatchResult = {
			winnerId: "w",
			placements: [
				{ playerId: "w", placement: 1 },
				{ playerId: "me", placement: 2 },
			],
		};

		render(
			<ResultView
				match={match}
				onLeave={() => {}}
				result={result}
				userId="me"
			/>,
		);

		// The "Winner" label headline shows above the resolved winner name. The
		// restyled card shows it both as the header band and the label line.
		expect(screen.getAllByText("Winner").length).toBeGreaterThan(0);
		// Winner id resolves to the winner's display name — it shows both in the
		// headline and as the top row of the placements list.
		expect(screen.getAllByText("Zoe").length).toBeGreaterThan(0);
		// This player did not win, so no victory headline.
		expect(screen.queryByText("You had the FINAL WORD")).toBeNull();
		// Own placement is 2nd in the ["w", "me"] ordering — surfaced both in the
		// "You finished" line and as the ordinal prefix of the ranking row.
		expect(screen.getAllByText("2nd").length).toBeGreaterThan(0);
	});

	it("renders a draw with no winner", () => {
		const match = makeMatch(
			"finished",
			{
				me: makePlayer({ name: "Alice" }),
				b: makePlayer({ name: "Bob" }),
			},
			{ isDraw: true },
		);

		const result: MatchResult = {
			placements: [
				{ playerId: "me", placement: 1 },
				{ playerId: "b", placement: 1 },
			],
		};

		render(
			<ResultView
				match={match}
				onLeave={() => {}}
				result={result}
				userId="me"
			/>,
		);

		expect(screen.getByText("Draw")).toBeDefined();
		// A draw does not announce a victory.
		expect(screen.queryByText("You had the FINAL WORD")).toBeNull();
		expect(screen.queryByText("Victory")).toBeNull();
	});
});
