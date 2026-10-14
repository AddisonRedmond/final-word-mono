import { describe, expect, it } from "vitest";
import type { Game, PlayerDisplay, Room } from "types/battle-royale.types.js";
import { serializeGame } from "./lobby.js";

// Feature: realtime-broadcast-scaling, Task 3.3 — trim shape tests.
//
// These assert the Trimmed_Snapshot produced by `serializeGame` contains
// EXACTLY the audited UI_Fields and omits every Non_UI_Field, for both the room
// and each player. "Exactly" is enforced by comparing the sorted keys of the
// projection against the expected keep-list arrays, so an accidental DROP of a
// kept field (rendered behaviour would regress) AND an accidental LEAK of a
// dropped field (server-only state on the wire) both fail. Fixtures carry every
// keep-list field (including the optional `?` ones) so presence is observable,
// plus every Non_UI_Field so the drop is observable.
//
// Keep/drop lists come from `.kiro/specs/realtime-broadcast-scaling/UI_FIELDS.md`
// and the `RoomUIFields` / `PlayerDisplayUIFields` unions in
// `packages/types/src/battle-royale.types.ts`.
//
// Validates: Requirements 2.5

// The audited room keep-list (UI_FIELDS.md "Battle Royale / Room"). Drops
// `createdAt` (never read by any client component).
const EXPECTED_ROOM_KEYS = [
  "lobbyId",
  "shareCode",
  "startTime",
  "isStarted",
  "isFinished",
  "winnerId",
  "isDraw",
  "matchEndTime",
].sort();

// Non_UI_Fields that must never reach the wire for the room.
const DROPPED_ROOM_KEYS = ["createdAt"];

// The audited player keep-list (UI_FIELDS.md "Battle Royale / PlayerDisplay").
const EXPECTED_PLAYER_KEYS = [
  "name",
  "revealed_letters",
  "partialMatches",
  "noMatch",
  "display_queue",
  "isEliminated",
  "revealedWord",
  "points",
  "life",
  "totalGuesses",
  "correctGuesses",
  "currentWordGuesses",
  "lastAttackerName",
  "currentWordIsAttack",
  "currentWordAttackerName",
  "attackQueueView",
  "attackCementAt",
].sort();

// Non_UI_Fields that must never reach the wire for a player: `endTimeStamp`
// (survival time is derived from `life`) and `statsPersisted` (server-only).
const DROPPED_PLAYER_KEYS = ["endTimeStamp", "statsPersisted"];

// A fully-populated authoritative player: EVERY keep-list field (incl. the
// optional ones, so their presence after projection is observable) AND every
// dropped Non_UI_Field.
const makeFullPlayer = (name: string): PlayerDisplay => ({
  // keep-list
  name,
  revealed_letters: { 0: "A" },
  partialMatches: ["b"],
  noMatch: ["c"],
  display_queue: [{ 1: "D" }],
  // Not eliminated: this is the full-passthrough fixture, so every keep-list
  // field (incl. `revealed_letters`) must survive projection. The eliminated
  // case — where `revealed_letters` is intentionally dropped — is covered by
  // its own test below.
  isEliminated: false,
  revealedWord: "APPLE",
  points: 120,
  life: 2,
  totalGuesses: 9,
  correctGuesses: 3,
  currentWordGuesses: 1,
  lastAttackerName: "rival",
  currentWordIsAttack: true,
  currentWordAttackerName: "rival",
  attackQueueView: [{ attackerName: "rival", cemented: false }],
  attackCementAt: 8000,
  // dropped Non_UI_Fields
  endTimeStamp: 123,
  statsPersisted: true,
});

// A fully-populated authoritative room: every keep-list field (incl. the
// optional ones) AND the dropped `createdAt`.
const makeFullRoom = (): Room => ({
  // keep-list
  lobbyId: "lobby-1",
  shareCode: "FROG-72",
  startTime: 1000,
  isStarted: true,
  isFinished: false,
  winnerId: "p1",
  isDraw: false,
  matchEndTime: 9000,
  // dropped Non_UI_Field
  createdAt: 42,
});

const makeFullGame = (): Game => ({
  room: makeFullRoom(),
  players: new Map<string, PlayerDisplay>([
    ["p1", makeFullPlayer("p1")],
    ["p2", makeFullPlayer("p2")],
  ]),
});

describe("serializeGame trim shape (Task 3.3)", () => {
  it("projects the room to EXACTLY the audited keep-list keys", () => {
    const game = makeFullGame();
    const { room } = serializeGame(game);

    // Exactly these keys: both a dropped-kept field and a leaked-dropped field
    // fail here.
    expect(Object.keys(room).sort()).toEqual(EXPECTED_ROOM_KEYS);

    for (const key of EXPECTED_ROOM_KEYS) {
      expect(room).toHaveProperty(key);
    }
    for (const key of DROPPED_ROOM_KEYS) {
      expect(room).not.toHaveProperty(key);
    }
  });

  it("projects every player to EXACTLY the audited keep-list keys", () => {
    const game = makeFullGame();
    const { players } = serializeGame(game);

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
    const game = makeFullGame();
    const projected = serializeGame(game);

    for (const key of EXPECTED_ROOM_KEYS) {
      expect((projected.room as Record<string, unknown>)[key]).toEqual(
        (game.room as Record<string, unknown>)[key],
      );
    }

    const authoritativeP1 = game.players.get("p1") as PlayerDisplay;
    for (const key of EXPECTED_PLAYER_KEYS) {
      expect((projected.players.p1 as Record<string, unknown>)[key]).toEqual(
        (authoritativeP1 as unknown as Record<string, unknown>)[key],
      );
    }
  });

  it("drops revealed_letters for an eliminated player, keeping it for the living", () => {
    // On elimination the server fills `revealed_letters` with the whole solution
    // word; no client surface reads it for an eliminated slot, so the projection
    // drops it to keep dead slots light in every keyframe. A living player's map
    // is untouched.
    const game: Game = {
      room: makeFullRoom(),
      players: new Map<string, PlayerDisplay>([
        ["alive", makeFullPlayer("alive")],
        [
          "dead",
          { ...makeFullPlayer("dead"), isEliminated: true },
        ],
      ]),
    };

    const { players } = serializeGame(game);

    // Living player: the full revealed map survives.
    expect(players.alive?.revealed_letters).toEqual({ 0: "A" });
    // Eliminated player: revealed_letters is dropped (undefined), while the rest
    // of the keep-list is still projected.
    expect(players.dead?.revealed_letters).toBeUndefined();
    expect(players.dead?.isEliminated).toBe(true);
    expect(players.dead?.life).toBe(2);
    expect(players.dead?.name).toBe("dead");
  });

  it("does not mutate the authoritative game", () => {
    const game = makeFullGame();
    const before = structuredClone({
      room: game.room,
      players: Object.fromEntries(game.players),
    });

    serializeGame(game);

    // The live game keeps its Map shape and every field (incl. the dropped
    // Non_UI_Fields) exactly as before the projection.
    expect(game.players instanceof Map).toBe(true);
    expect(game.room).toEqual(before.room);
    expect(Object.fromEntries(game.players)).toEqual(before.players);
  });
});
