import { describe, expect, it } from "vitest";
import type { RaceMatch, RacePlayer, RaceRoom } from "types/race.types.js";
import { serializeRaceMatch } from "./lobby.js";

// Feature: realtime-broadcast-scaling, Task 3.3 — trim shape tests.
//
// These assert the Trimmed_Snapshot produced by `serializeRaceMatch` contains
// EXACTLY the audited UI_Fields and omits every Non_UI_Field, for both the room
// and each player. "Exactly" is enforced by comparing the sorted keys of the
// projection against the expected keep-list arrays, so an accidental DROP of a
// kept field (rendered behaviour would regress) AND an accidental LEAK of a
// dropped field (server-only state on the wire) both fail. Fixtures carry every
// keep-list field (including the optional `?` ones) so presence is observable,
// plus every Non_UI_Field so the drop is observable.
//
// Keep/drop lists come from `.kiro/specs/realtime-broadcast-scaling/UI_FIELDS.md`
// and the `RaceRoomUIFields` / `RacePlayerUIFields` unions in
// `packages/types/src/race.types.ts`.
//
// Validates: Requirements 2.5

// The audited room keep-list (UI_FIELDS.md "Race / RaceRoom"). Drops
// `createdAt` (never read by any client component).
const EXPECTED_ROOM_KEYS = [
  "matchId",
  "shareCode",
  "phase",
  "currentRoundIndex",
  "roundEndsAt",
  "nextRoundStartsAt",
  "lobbyDeadline",
  "winnerId",
  "isDraw",
].sort();

// Non_UI_Fields that must never reach the wire for the room.
const DROPPED_ROOM_KEYS = ["createdAt"];

// The audited player keep-list (UI_FIELDS.md "Race / RacePlayer").
const EXPECTED_PLAYER_KEYS = [
  "name",
  "isEliminated",
  "isAnonymous",
  "completedWords",
  "qualified",
  "totalGuesses",
  "correctGuesses",
  "placement",
  "revealedWord",
  "hintRevealed",
  "lastFeedback",
].sort();

// Non_UI_Fields (server-only ranking/tie-break bookkeeping + `isBot`) that must
// never reach the wire for a player.
const DROPPED_PLAYER_KEYS = [
  "isBot",
  "qualifiedAt",
  "roundGuesses",
  "correctLetters",
  "correctPositionsFound",
  "eliminatedAt",
  "statsPersisted",
];

// A fully-populated authoritative player: EVERY keep-list field (incl. the
// optional ones, so their presence after projection is observable) AND every
// dropped Non_UI_Field.
const makeFullPlayer = (name: string): RacePlayer => ({
  // keep-list
  name,
  isEliminated: true,
  isAnonymous: false,
  completedWords: 3,
  qualified: true,
  totalGuesses: 12,
  correctGuesses: 4,
  placement: 2,
  revealedWord: "APPLE",
  hintRevealed: { 0: "A" },
  lastFeedback: [{ index: 0, letter: "A", state: "correct" }],
  // dropped Non_UI_Fields
  isBot: true,
  qualifiedAt: 1000,
  roundGuesses: 5,
  correctLetters: 7,
  correctPositionsFound: 2,
  eliminatedAt: 2000,
  statsPersisted: true,
});

// A fully-populated authoritative room: every keep-list field (incl. the
// optional ones) AND the dropped `createdAt`.
const makeFullRoom = (): RaceRoom => ({
  // keep-list
  matchId: "match-1",
  shareCode: "FROG-72",
  phase: "round",
  currentRoundIndex: 1,
  roundEndsAt: 5000,
  nextRoundStartsAt: 6000,
  lobbyDeadline: 7000,
  winnerId: "p1",
  isDraw: false,
  // dropped Non_UI_Field
  createdAt: 42,
});

const makeFullMatch = (): RaceMatch => ({
  room: makeFullRoom(),
  players: new Map<string, RacePlayer>([
    ["p1", makeFullPlayer("p1")],
    ["p2", makeFullPlayer("p2")],
  ]),
});

describe("serializeRaceMatch trim shape (Task 3.3)", () => {
  it("projects the room to EXACTLY the audited keep-list keys", () => {
    const match = makeFullMatch();
    const { room } = serializeRaceMatch(match);

    // Exactly these keys: both a dropped-kept field and a leaked-dropped field
    // fail here.
    expect(Object.keys(room).sort()).toEqual(EXPECTED_ROOM_KEYS);

    // Explicit kept-present / dropped-absent assertions for a readable failure.
    for (const key of EXPECTED_ROOM_KEYS) {
      expect(room).toHaveProperty(key);
    }
    for (const key of DROPPED_ROOM_KEYS) {
      expect(room).not.toHaveProperty(key);
    }
  });

  it("projects every player to EXACTLY the audited keep-list keys", () => {
    const match = makeFullMatch();
    const { players } = serializeRaceMatch(match);

    expect(Object.keys(players).sort()).toEqual(["p1", "p2"]);

    for (const id of Object.keys(players)) {
      const player = players[id];

      // Exactly the keep-list — kept present AND dropped absent.
      expect(Object.keys(player).sort()).toEqual(EXPECTED_PLAYER_KEYS);

      for (const key of EXPECTED_PLAYER_KEYS) {
        expect(player).toHaveProperty(key);
      }
      for (const key of DROPPED_PLAYER_KEYS) {
        expect(player).not.toHaveProperty(key);
      }
    }
  });

  it("preserves the VALUE of every kept field (rendered behavior preserved)", () => {
    const match = makeFullMatch();
    const projected = serializeRaceMatch(match);

    // Each kept room field carries its authoritative value through unchanged.
    for (const key of EXPECTED_ROOM_KEYS) {
      expect((projected.room as Record<string, unknown>)[key]).toEqual(
        (match.room as Record<string, unknown>)[key],
      );
    }

    // Each kept player field carries its authoritative value through unchanged.
    const authoritativeP1 = match.players.get("p1") as RacePlayer;
    for (const key of EXPECTED_PLAYER_KEYS) {
      expect((projected.players.p1 as Record<string, unknown>)[key]).toEqual(
        (authoritativeP1 as unknown as Record<string, unknown>)[key],
      );
    }
  });

  it("does not mutate the authoritative match", () => {
    const match = makeFullMatch();
    const before = structuredClone({
      room: match.room,
      players: Object.fromEntries(match.players),
    });

    serializeRaceMatch(match);

    // The live match keeps its Map shape and every field (incl. the dropped
    // Non_UI_Fields) exactly as before the projection.
    expect(match.players instanceof Map).toBe(true);
    expect(match.room).toEqual(before.room);
    expect(Object.fromEntries(match.players)).toEqual(before.players);
  });
});
