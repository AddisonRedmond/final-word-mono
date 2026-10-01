import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { Namespace } from "socket.io";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race (handler path): wrong-length/eliminated
// guesses are side-effect-free, and correct-length guesses are always graded
// (no server-side throttle).
//
// Verified END TO END through the wired `guess` handler (not just the pure
// `applyGuess` helper). We register the real handler on a fake Namespace,
// capture the fake socket's `guess` listener, seed the module-global
// `matches`/`serverOnlyData` maps with a real in-`round` match, then invoke the
// handler and assert:
//   - Wrong-length guesses (Req 4.6) are acknowledged as non-matches and leave
//     every guess count and the assigned word UNCHANGED.
//   - Eliminated players (Req 4.8) are ignored: no ack, no count change.
//   - Correct-length guesses are ALWAYS graded regardless of how soon they
//     arrive after a previous guess: each increments `roundGuesses` and
//     `totalGuesses` by one and is acked without `throttled: true`. There is no
//     rate gate (the throttle was removed), so back-to-back guesses at the same
//     instant are both graded.
//
// `handlers.ts` transitively imports `stats.ts` -> `db`, so `db` is mocked to a
// no-op chainable stub. Supabase env is set in case auth is transitively
// imported. The module-global maps live in `./state.js`; we import them and
// clean the test room out between runs.
//
// Validates: Requirements 4.6, 4.8

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

vi.mock("db", () => {
  const insert = () => ({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }),
  });
  return {
    db: { insert },
    raceStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

// Import AFTER env + mocks are registered. `config`/`matches`/`serverOnlyData`
// are the exact module globals the handler reads.
const { registerRaceHandlers } = await import("./handlers.js");
const { config, matches, serverOnlyData } = await import("./state.js");

const ROOM_ID = "handler-guess-test-room";

// A deterministic v4-shaped UUID from an integer seed so generated ids pass the
// UUID convention used elsewhere (real players vs bots).
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

/** A recorded emit call: [event, payload]. */
type EmitCall = [string, unknown];

/** Build a fake socket carrying socket.data and recording emits/joins. */
const makeSocket = (userId: string) => {
  const emits: EmitCall[] = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: `socket-${userId}`,
    data: { userId, name: "Player", roomId: ROOM_ID } as {
      userId?: string;
      name?: string;
      roomId?: string;
    },
    emits,
    on(event: string, fn: (...args: unknown[]) => void) {
      listeners.set(event, fn);
      return socket;
    },
    emit(event: string, payload: unknown) {
      emits.push([event, payload]);
      return true;
    },
    join() {},
    leave() {},
    /** Invoke the captured `guess` handler as the client would. */
    guess(payload: { word?: string; guess?: string }) {
      const fn = listeners.get("guess");
      if (!fn) {
        throw new Error("guess handler was never registered");
      }
      fn(payload);
    },
  };
  return socket;
};

/**
 * Register the handler on a fake namespace and return the connected fake socket
 * with its captured listeners. `registerRaceHandlers` calls
 * `nsp.on("connection", cb)`; we invoke `cb(socket)` to wire the per-socket
 * handlers (including `guess`).
 */
const connectSocket = (userId: string) => {
  const socket = makeSocket(userId);
  const nsp = {
    on(event: string, cb: (s: typeof socket) => void) {
      if (event === "connection") {
        cb(socket);
      }
      return nsp;
    },
  } as unknown as Namespace;
  registerRaceHandlers(nsp);
  return socket;
};

/** Seed a real in-`round` match + server-only record for one player. */
const seedRoom = (
  userId: string,
  player: RacePlayer,
  serverData: { word: string; lastAcceptedGuessAt: number },
) => {
  const match: RaceMatch = {
    room: {
      matchId: ROOM_ID,
      phase: "round",
      createdAt: 0,
      lobbyDeadline: 0,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players: new Map([[userId, player]]),
  };
  matches.set(ROOM_ID, match);
  serverOnlyData.set(ROOM_ID, {
    players: { [userId]: serverData },
    timers: {},
  });
  return match;
};

/** Base player with zeroed counters; caller overrides per case. */
const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
  name: "Player",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
  ...fields,
});

const round0 = config.rounds[0];
const WORD_LENGTH = round0?.wordLength ?? 4;

// Clean the test room out of the shared globals between runs so no state leaks
// across cases. Clear any coalesced-broadcast timer the accepted path armed.
const clearTestRoom = () => {
  const server = serverOnlyData.get(ROOM_ID);
  if (server?.timers.updateTicker) {
    clearTimeout(server.timers.updateTicker);
  }
  matches.delete(ROOM_ID);
  serverOnlyData.delete(ROOM_ID);
};

beforeEach(() => {
  clearTestRoom();
});

afterEach(() => {
  clearTestRoom();
  vi.useRealTimers();
});

// A guess string of a chosen length made of lowercase letters.
const wordOfLength = (len: number) =>
  fc
    .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: len,
      maxLength: len,
    })
    .map((chars) => chars.join(""));

// A guess string that is NOT the round word length (0..8, excluding the round
// length), so it exercises the wrong-length reject branch.
const wrongLengthWord = fc
  .integer({ min: 0, max: 8 })
  .filter((n) => n !== WORD_LENGTH)
  .chain((len) =>
    len === 0
      ? fc.constant("")
      : fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
          minLength: len,
          maxLength: len,
        }).map((chars) => chars.join("")),
  );

describe("Race guess handler: rejected/gated guesses are side-effect-free (Property 3, Req 4.6, 4.8, 7.4)", () => {
  it("wrong-length guess: acks non-match, leaves counts, word, and rate gate unchanged (Req 4.6)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        wrongLengthWord,
        fc.record({
          completedWords: fc.integer({ min: 0, max: 5 }),
          roundGuesses: fc.integer({ min: 0, max: 30 }),
          totalGuesses: fc.integer({ min: 0, max: 100 }),
          correctGuesses: fc.integer({ min: 0, max: 100 }),
          // NOT qualified: a qualified player is gated out entirely (no ack),
          // which is covered by its own case below. The wrong-length ack path
          // only applies while the player is still actively racing.
          qualified: fc.constant(false),
          lastAcceptedGuessAt: fc.integer({ min: 0, max: 1_000_000 }),
          word: wordOfLength(WORD_LENGTH),
        }),
        (seed, guess, f) => {
          clearTestRoom();
          const userId = uuidFromSeed(seed);
          const player = makePlayer({
            completedWords: f.completedWords,
            roundGuesses: f.roundGuesses,
            totalGuesses: f.totalGuesses,
            correctGuesses: f.correctGuesses,
            qualified: f.qualified,
          });
          const serverData = {
            word: f.word,
            lastAcceptedGuessAt: f.lastAcceptedGuessAt,
          };
          seedRoom(userId, player, serverData);

          const socket = connectSocket(userId);
          socket.guess({ word: guess });

          // Counts + word + rate gate all unchanged.
          expect(player.completedWords).toBe(f.completedWords);
          expect(player.roundGuesses).toBe(f.roundGuesses);
          expect(player.totalGuesses).toBe(f.totalGuesses);
          expect(player.correctGuesses).toBe(f.correctGuesses);
          expect(player.qualified).toBe(f.qualified);
          expect(serverData.word).toBe(f.word);
          expect(serverData.lastAcceptedGuessAt).toBe(f.lastAcceptedGuessAt);

          // A single guess:ack non-match was emitted.
          const acks = socket.emits.filter(([e]) => e === "guess:ack");
          expect(acks).toHaveLength(1);
          const ackPayload = acks[0]?.[1] as {
            isMatch: boolean;
            throttled: boolean;
          };
          expect(ackPayload.isMatch).toBe(false);
          expect(ackPayload.throttled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("eliminated player: guess ignored entirely, no counts change and no ack (Req 4.8)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        wordOfLength(WORD_LENGTH),
        fc.record({
          completedWords: fc.integer({ min: 0, max: 5 }),
          roundGuesses: fc.integer({ min: 0, max: 30 }),
          totalGuesses: fc.integer({ min: 0, max: 100 }),
          correctGuesses: fc.integer({ min: 0, max: 100 }),
          lastAcceptedGuessAt: fc.integer({ min: 0, max: 1_000_000 }),
          word: wordOfLength(WORD_LENGTH),
        }),
        (seed, guess, f) => {
          clearTestRoom();
          const userId = uuidFromSeed(seed);
          const player = makePlayer({
            isEliminated: true,
            completedWords: f.completedWords,
            roundGuesses: f.roundGuesses,
            totalGuesses: f.totalGuesses,
            correctGuesses: f.correctGuesses,
          });
          const serverData = {
            word: f.word,
            lastAcceptedGuessAt: f.lastAcceptedGuessAt,
          };
          seedRoom(userId, player, serverData);

          const socket = connectSocket(userId);
          socket.guess({ word: guess });

          // Nothing changed on the player or the server-only record.
          expect(player.completedWords).toBe(f.completedWords);
          expect(player.roundGuesses).toBe(f.roundGuesses);
          expect(player.totalGuesses).toBe(f.totalGuesses);
          expect(player.correctGuesses).toBe(f.correctGuesses);
          expect(serverData.word).toBe(f.word);
          expect(serverData.lastAcceptedGuessAt).toBe(f.lastAcceptedGuessAt);

          // Eliminated players are ignored before any ack is emitted.
          expect(socket.emits.filter(([e]) => e === "guess:ack")).toHaveLength(
            0,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("qualified player: guess ignored entirely, no counts change and no ack", () => {
    // Once qualified this round the player is safe and waiting — the server
    // gates their guesses out before any grading or ack, even a correct-length
    // one.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        wordOfLength(WORD_LENGTH),
        fc.record({
          completedWords: fc.integer({ min: 0, max: 5 }),
          roundGuesses: fc.integer({ min: 0, max: 30 }),
          totalGuesses: fc.integer({ min: 0, max: 100 }),
          correctGuesses: fc.integer({ min: 0, max: 100 }),
          lastAcceptedGuessAt: fc.integer({ min: 0, max: 1_000_000 }),
          word: wordOfLength(WORD_LENGTH),
        }),
        (seed, guess, f) => {
          clearTestRoom();
          const userId = uuidFromSeed(seed);
          const player = makePlayer({
            qualified: true,
            completedWords: f.completedWords,
            roundGuesses: f.roundGuesses,
            totalGuesses: f.totalGuesses,
            correctGuesses: f.correctGuesses,
          });
          const serverData = {
            word: f.word,
            lastAcceptedGuessAt: f.lastAcceptedGuessAt,
          };
          seedRoom(userId, player, serverData);

          const socket = connectSocket(userId);
          socket.guess({ word: guess });

          // Nothing changed on the player or the server-only record.
          expect(player.completedWords).toBe(f.completedWords);
          expect(player.roundGuesses).toBe(f.roundGuesses);
          expect(player.totalGuesses).toBe(f.totalGuesses);
          expect(player.correctGuesses).toBe(f.correctGuesses);
          expect(player.qualified).toBe(true);
          expect(serverData.word).toBe(f.word);
          expect(serverData.lastAcceptedGuessAt).toBe(f.lastAcceptedGuessAt);

          // Qualified players are gated before any ack is emitted.
          expect(socket.emits.filter(([e]) => e === "guess:ack")).toHaveLength(
            0,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("correct-length guess is always graded with no throttle: back-to-back guesses at the same instant both increment counts and are acked non-throttled", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        wordOfLength(WORD_LENGTH),
        fc.record({
          now: fc.integer({ min: 1_000_000, max: 5_000_000 }),
          completedWords: fc.integer({ min: 0, max: 5 }),
          roundGuesses: fc.integer({ min: 0, max: 30 }),
          totalGuesses: fc.integer({ min: 0, max: 100 }),
          correctGuesses: fc.integer({ min: 0, max: 100 }),
          word: wordOfLength(WORD_LENGTH),
        }),
        (seed, guessBase, f) => {
          clearTestRoom();
          const userId = uuidFromSeed(seed);
          const player = makePlayer({
            completedWords: f.completedWords,
            roundGuesses: f.roundGuesses,
            totalGuesses: f.totalGuesses,
            correctGuesses: f.correctGuesses,
          });
          // Use a correct-length guess that does NOT match the assigned word so
          // counts stay predictable (no word reassignment / final-round win):
          // rotate the first letter until the guess differs from the word.
          const guess =
            guessBase === f.word
              ? `${guessBase[0] === "a" ? "b" : "a"}${guessBase.slice(1)}`
              : guessBase;
          const serverData = {
            word: f.word,
            lastAcceptedGuessAt: 0,
          };
          seedRoom(userId, player, serverData);

          // Freeze time: both guesses arrive at the exact same instant. With a
          // rate gate the second would be throttled; without one, both grade.
          vi.useFakeTimers();
          vi.setSystemTime(f.now);

          const socket = connectSocket(userId);

          // First correct-length guess is graded: counts each +1, single ack,
          // not throttled.
          socket.guess({ word: guess });
          expect(player.roundGuesses).toBe(f.roundGuesses + 1);
          expect(player.totalGuesses).toBe(f.totalGuesses + 1);
          const firstAcks = socket.emits.filter(([e]) => e === "guess:ack");
          expect(firstAcks).toHaveLength(1);
          expect(
            (firstAcks[0]?.[1] as { throttled?: boolean }).throttled,
          ).not.toBe(true);

          // Second guess at the SAME instant is ALSO graded (no rate gate):
          // counts advance again and it is likewise acked non-throttled.
          socket.emits.length = 0;
          socket.guess({ word: guess });
          expect(player.roundGuesses).toBe(f.roundGuesses + 2);
          expect(player.totalGuesses).toBe(f.totalGuesses + 2);
          const secondAcks = socket.emits.filter(([e]) => e === "guess:ack");
          expect(secondAcks).toHaveLength(1);
          expect(
            (secondAcks[0]?.[1] as { throttled?: boolean }).throttled,
          ).not.toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
