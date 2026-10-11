import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: anonymous-sign-in
//
// Integration test for the guest leaver -> next-start-blocked sequence (R6.6, R6.7).
//
// This wires three seams together against a single faithful mock of the `db`
// module (no live DB harness is configured for apps/server; `vitest run` uses
// mocked `db`, as every other server stats test does):
//
//   1. persistLeaverAsLoss (race/stats.ts)  -> writes the mode's stats row
//   2. guestModeGate (guest-mode-gate.ts)   -> reads that stats row
//   3. canStartMatch   (race/daily-limit.ts)-> delegates to guestModeGate for guests
//
// The mocked `db` is STATEFUL and keyed by userId: a leaver-loss upsert sets
// that user's `gamesPlayed` to >= 1 (the real SQL does `gamesPlayed + 1` on
// conflict and seeds `1` on insert), and the gate's `select` reflects the same
// row. So the flow is driven end-to-end:
//
//   (1) before play       -> no row  -> canStartMatch(uid, true) === true  (ALLOW)
//   (2) persistLeaverAsLoss(match, uid) during an in-progress match
//                           -> upsert sets gamesPlayed = 1
//   (3) after the leaver-loss -> row.gamesPlayed === 1 -> canStartMatch false (BLOCK)
//
// It also asserts the single-connection guard (socket/single-connection.ts)
// blocks a concurrent second game for the same user — the mid-game protection
// (R6.6) that prevents a guest from opening a second realtime game while the
// first is live.
//
// Validates: Requirements 6.6, 6.7

// --- Stateful db mock ------------------------------------------------------
//
// The write path now dual-writes: `race/stats.ts` fires the legacy
// `race_stats` upsert AND a `db.transaction` that calls `upsertModeStats` for
// the lifetime + seasonal `player_mode_stats` rows. The GATE now reads the
// unified `player_mode_stats` lifetime row (`mode = 'race'`, `scope =
// 'lifetime'`), so that is the row this test must drive end-to-end.
//
// We model one in-memory `player_mode_stats` table keyed by
// `${userId}|${mode}|${scope}` with a gamesPlayed counter. A faithful (mocked)
// `upsertModeStats` increments it the way the real SQL does (insert 1, or
// gamesPlayed + 1 on conflict). The gate's
// `select().from(playerModeStats).where(and(...)).limit(1)` reads the lifetime
// row back. The legacy `race_stats` insert is mocked as a harmless no-op since
// nothing reads it anymore.
type StatsRow = { gamesPlayed: number };
const statsTable = new Map<string, StatsRow>();

const pmsKey = (userId: string, mode: string, scope: string) =>
  `${userId}|${mode}|${scope}`;

vi.mock("db", () => {
  const playerModeStats = new Proxy({}, { get: (_t, key) => key });

  // Legacy race_stats write: accepted and ignored (no reader remains).
  const insert = () => ({
    values: () => ({
      onConflictDoUpdate: () => Promise.resolve(undefined),
    }),
  });

  // The gate read: select().from(playerModeStats).where(and(eq...)).limit(1).
  // Pull userId/mode/scope out of the composed and() and resolve the matching
  // lifetime row.
  const select = () => ({
    from: () => ({
      where: (clause: { and?: Array<{ col: unknown; value: string }> }) => {
        const get = (name: string) =>
          clause.and?.find((c) => c.col === name)?.value;
        const userId = get("user_id") ?? get("userId");
        const mode = get("mode");
        const scope = get("scope");
        return {
          limit: () => {
            const row =
              userId && mode && scope
                ? statsTable.get(pmsKey(userId, mode, scope))
                : undefined;
            return Promise.resolve(
              row ? [{ gamesPlayed: row.gamesPlayed }] : [],
            );
          },
        };
      },
    }),
  });

  // The unified write path. `race/stats.ts` runs this inside db.transaction for
  // both lifetime and seasonal scopes; we increment the keyed counter exactly
  // like the real onConflictDoUpdate (insert 1, else +1).
  const upsertModeStats = (
    _tx: unknown,
    {
      userId,
      mode,
      scope,
    }: { userId: string; mode: string; scope: string },
  ) => {
    const key = pmsKey(userId, mode, scope);
    const existing = statsTable.get(key);
    statsTable.set(key, { gamesPlayed: existing ? existing.gamesPlayed + 1 : 1 });
    return Promise.resolve(undefined);
  };

  const db = {
    insert,
    select,
    // dualWriteModeStats wraps both upserts in a transaction; run the callback
    // with a dummy tx so the real upsertModeStats calls fire.
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };

  return {
    db,
    playerModeStats,
    LIFETIME_SCOPE: "lifetime",
    // seasonKey is called by race/stats.ts for the seasonal dual-write row.
    seasonKey: () => "2026-01",
    matchPoints: () => 0,
    upsertModeStats,
    // The champion-flag write is irrelevant to this guest-gate test; no-op it so
    // the real writeModeStats transaction completes without needing tx.update.
    setWonLastRealtimeGame: () => Promise.resolve(undefined),
    and: (...clauses: Array<{ col: unknown; value: unknown }>) => ({
      and: clauses,
    }),
    eq: (col: unknown, value: string) => ({ col, value }),
  };
});

// The registered-user branch of `canStartMatch` now routes into the shared
// realtime daily limit (free 3/UTC-day, premium unlimited). This test is about
// the GUEST one-game-per-mode gate, so stub the realtime limit to always permit
// — isolating the guest gate (and keeping the "registered users are never
// blocked by a prior leaver-loss" assertion a pure guest-gate check).
vi.mock("./realtime-daily-limit.js", () => ({
  canStartRealtimeGame: vi.fn(async () => true),
  recordRealtimeGameStart: vi.fn(async () => undefined),
}));

// Import AFTER the mock is registered.
const { persistLeaverAsLoss } = await import("./race/stats.js");
const { canStartMatch } = await import("./race/daily-limit.js");
const { installSingleConnection, ALREADY_CONNECTED_MESSAGE } = await import(
  "../socket/single-connection.js"
);

// A deterministic v4-shaped UUID from an integer seed so generated ids pass the
// code's `isRealPlayer` UUID check.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makePlayer = (): RacePlayer => ({
  name: "guest",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
});

const makeInProgressMatch = (userId: string): RaceMatch => ({
  room: {
    matchId: "m1",
    phase: "round", // in-progress (not "lobby"), so a leave records a loss
    createdAt: 0,
    lobbyDeadline: 0,
    currentRoundIndex: 0,
    isDraw: false,
  },
  players: new Map<string, RacePlayer>([[userId, makePlayer()]]),
});

describe("Guest leaver -> next-start-blocked (Requirements 6.6, 6.7)", () => {
  beforeEach(() => {
    statsTable.clear();
  });

  it("blocks the guest's next start in that mode after a leaver-loss writes gamesPlayed >= 1 (R6.7)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100_000 }),
        async (seed) => {
          statsTable.clear();
          const userId = uuidFromSeed(seed);

          // The lifetime player_mode_stats row the Race gate reads.
          const lifetimeKey = pmsKey(userId, "race", "lifetime");

          // (1) Before play: no stats row -> a guest start is ALLOWED.
          const beforeAllowed = await canStartMatch(userId, true);
          expect(beforeAllowed).toBe(true);
          expect(statsTable.has(lifetimeKey)).toBe(false);

          // (2) Guest plays and leaves/disconnects mid-game: the leaver-loss
          // write lands into the mode's lifetime row (gamesPlayed becomes 1).
          const match = makeInProgressMatch(userId);
          await persistLeaverAsLoss(match, userId);

          expect(
            statsTable.get(lifetimeKey)?.gamesPlayed,
          ).toBeGreaterThanOrEqual(1);

          // (3) A subsequent start in that mode is now REJECTED by the seam.
          const afterAllowed = await canStartMatch(userId, true);
          expect(afterAllowed).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a registered user is never blocked by a prior leaver-loss (gate bypass, R6.8 sanity)", async () => {
    const userId = uuidFromSeed(42);
    const match = makeInProgressMatch(userId);
    await persistLeaverAsLoss(match, userId);
    expect(
      statsTable.get(pmsKey(userId, "race", "lifetime"))?.gamesPlayed,
    ).toBeGreaterThanOrEqual(1);

    // Even with gamesPlayed >= 1, a registered user (isAnonymous=false) is
    // permitted — the leaver-loss gate only governs guests.
    expect(await canStartMatch(userId, false)).toBe(true);
  });

  it("the single-connection guard blocks a concurrent second game for the same guest (R6.6)", () => {
    // Model the io.use middleware the guard installs: capture it, then drive it
    // with two sockets for the SAME user. The second must be rejected while the
    // first is live; after the first disconnects, a reconnect is permitted.
    type MiddlewareSocket = { id: string; data: { userId?: string } };
    type Middleware = (
      socket: MiddlewareSocket,
      next: (err?: Error) => void,
    ) => void;

    let middleware: Middleware | undefined;
    let connectionHandler: ((socket: MiddlewareSocket) => void) | undefined;

    const fakeIo = {
      use: (mw: Middleware) => {
        middleware = mw;
      },
      on: (event: string, handler: (socket: MiddlewareSocket) => void) => {
        if (event === "connection") connectionHandler = handler;
      },
    };

    // biome-ignore lint/suspicious/noExplicitAny: minimal Server shim for the guard
    installSingleConnection(fakeIo as any);
    expect(middleware).toBeDefined();
    expect(connectionHandler).toBeDefined();

    const userId = uuidFromSeed(7);

    // Track disconnect listeners so we can later simulate the first socket
    // closing (freeing the slot).
    const disconnectListeners = new Map<string, () => void>();
    const connect = (socket: MiddlewareSocket) =>
      connectionHandler?.({
        ...socket,
        // biome-ignore lint/suspicious/noExplicitAny: socket.on shim
        on: ((event: string, cb: () => void) => {
          if (event === "disconnect") disconnectListeners.set(socket.id, cb);
        }) as any,
      } as MiddlewareSocket);

    // First socket for the guest: admitted.
    const first: MiddlewareSocket = { id: "sock-1", data: { userId } };
    let firstErr: Error | undefined;
    middleware?.(first, (err) => {
      firstErr = err;
    });
    expect(firstErr).toBeUndefined();
    connect(first);

    // Second concurrent socket for the SAME guest: rejected (one game at a time).
    const second: MiddlewareSocket = { id: "sock-2", data: { userId } };
    let secondErr: Error | undefined;
    middleware?.(second, (err) => {
      secondErr = err;
    });
    expect(secondErr).toBeDefined();
    expect(secondErr?.message).toBe(ALREADY_CONNECTED_MESSAGE);

    // When the first socket disconnects, the slot frees and a reconnect works.
    disconnectListeners.get("sock-1")?.();
    const third: MiddlewareSocket = { id: "sock-3", data: { userId } };
    let thirdErr: Error | undefined;
    middleware?.(third, (err) => {
      thirdErr = err;
    });
    expect(thirdErr).toBeUndefined();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
