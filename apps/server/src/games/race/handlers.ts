import type { Namespace } from "socket.io";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import logger from "../../utils/logger.js";
import { GUEST_MODE_LIMIT_REASON } from "../guest-mode-gate.js";
import { canStartMatch, recordMatchStart } from "./daily-limit.js";
import {
  broadcastLobbyMembership,
  scheduleRaceUpdate,
  serializeRaceMatch,
} from "./lobby.js";
import {
  abandonMatch,
  beginRound,
  checkEarlyRoundEnd,
  cleanupMatch,
  findMatchForUser,
  getOrCreateLobby,
  handleFinalRoundWin,
  resolveShareCode,
  type RoundLifecycleDeps,
  scheduleLobbyStart,
  startMatch,
  type StartMatchDeps,
} from "./logic/race.js";
import {
  applyGuess,
  calculateKeyboardMatches,
  mergeKeyboardMatches,
} from "./logic/round.js";
import { persistLeaverAsLoss, persistRaceStats } from "./stats.js";
import { config, matches, serverOnlyBotData, serverOnlyData } from "./state.js";

// UUID shape for real (Supabase-authenticated) players. Bots are keyed
// `bot0`/`bot1`/…, so anything that is not a UUID is a bot — the same detection
// `stats.ts`/`race.ts` use to exclude bots. Used by the `leave` handler to
// decide whether any real human remains after a departure.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wires up all Race_Mode socket event handlers on the `/race` namespace.
 * Called once at startup by the Race `GameModule` after auth is installed.
 *
 * This file mirrors `battle-royale/handlers.ts`'s connection/`join` socket-
 * wiring STRUCTURE ONLY. Race is a solo race-to-qualify with independent
 * per-player words, so there is NO attack/targeting wiring here (no attack
 * picker, target routing, attack queues, or attack-word fields). Only the
 * connection + `join`/reconnect flow landed in task 13.1; `leave` and
 * `disconnect` are wired here (task 13.4). The `guess` handler is wired
 * separately (task 13.2). The round lifecycle (`round:transition`,
 * `eliminated`, `match:result`) is emitted by `endRound`/`finishMatch`, so this
 * file does NOT emit those — it only handles player departure.
 */
export const registerRaceHandlers = (nsp: Namespace) => {
  // Match-start dependency seam shared by both start paths (max-size on join
  // and the lobby countdown). The daily-limit checks come from the single
  // `daily-limit.ts` seam (dormant during beta) and `beginRound` is the real
  // round hand-off, so a started match advances into round 0 (Req 11.1, 11.2).
  const startDeps: StartMatchDeps = {
    // The per-player start seam is the dormant Daily_Game_Counter check (Req
    // 11.1, 11.2); it is distinct from the join-level guest one-game-per-mode
    // gate (R6.*), which runs in the `join` handler before placement. Here we
    // pin `isAnonymous = false` so the seam keeps its documented beta behavior
    // (always permit, no stats read) for every real player at start.
    canStartMatch: (userId: string) => canStartMatch(userId, false),
    recordMatchStart,
    beginRound,
  };

  // Lifecycle seam for a first-correct-guess Final_Round win (Req 6.1, 6.2).
  // The guess handler declares the winner via `handleFinalRoundWin`, which
  // finishes the match: it must persist stats and tear the room down using the
  // module's real defaults, so wire the real `persistRaceStats` and a
  // `cleanupMatch` bound to the module's global state maps (Req 6.6, 9.4).
  const lifecycleDeps: RoundLifecycleDeps = {
    serverOnlyData,
    persistRaceStats,
    cleanupMatch: (matchId: string) =>
      cleanupMatch(matchId, matches, serverOnlyData, serverOnlyBotData),
  };

  nsp.on("connection", (socket) => {
    const { userId, name } = socket.data;
    logger.info({ socketId: socket.id, userId }, "Race socket connected");

    // --- disconnect --------------------------------------------------------
    // The socket dropped (transport closed, tab closed, network blip). RETAIN
    // the player and their match state so an accidental disconnect can
    // reconnect to the same match via `join` (Req 9.1) — do NOT remove the
    // player and do NOT persist stats. Explicit departure goes through `leave`
    // below. Mirrors Battle Royale's disconnect handler, which keeps state and
    // only schedules a fresh broadcast.
    socket.on("disconnect", () => {
      const { roomId, userId: uid, name: playerName } = socket.data;
      logger.info(
        { socketId: socket.id, roomId, userId: uid, name: playerName },
        "Race socket disconnected",
      );

      if (!roomId) {
        return;
      }

      const match = matches.get(roomId);
      if (!match || !match.players.has(uid)) {
        logger.warn(
          { roomId, userId: uid },
          "Disconnected race socket was not present in match state",
        );
        return;
      }

      // Keep the player + their server-only data intact for reconnect; just let
      // the rest of the room see a refreshed snapshot.
      scheduleRaceUpdate(nsp, match);
    });

    // --- leave -------------------------------------------------------------
    // Explicit departure. If the match is IN PROGRESS (phase round /
    // intermission / final — i.e. started and not finished) the leaver is
    // persisted as a LOSS BEFORE removal so the alive-count placement reflects
    // the field at the moment of leaving (Req 8.6, 9.3). Leaving a not-yet-
    // started lobby is free — no stats (Req 8.7). After removal, if the room is
    // empty it is torn down (Req 9.4); otherwise the remaining players get an
    // updated snapshot. Supports an optional ack like Battle Royale.
    socket.on("leave", (ack?: (response: { ok: boolean }) => void) => {
      const { roomId, userId: uid, name: playerName } = socket.data;

      if (!roomId) {
        logger.warn(
          { socketId: socket.id, userId: uid },
          "Race leave ignored: socket is not in a match",
        );
        ack?.({ ok: false });
        return;
      }

      const match = matches.get(roomId);
      if (!match) {
        logger.warn(
          { roomId, userId: uid },
          "Race leave ignored: match state was not found",
        );
        ack?.({ ok: false });
        return;
      }

      // In progress = started (round/intermission/final) but not finished. A
      // lobby leaver is free; a finished match records nothing further here.
      const inProgress =
        match.room.phase !== "lobby" && match.room.phase !== "finished";

      // Record the loss BEFORE removing the player so they are still counted in
      // the alive field for placement (Req 8.6). Fire-and-forget — persistence
      // owns its own try/catch and never throws into the leave path (Req 8.8).
      if (inProgress) {
        void persistLeaverAsLoss(match, uid);
      }

      // Remove the player from display state and their server-only secret.
      match.players.delete(uid);
      const roomServerData = serverOnlyData.get(roomId);
      if (roomServerData) {
        delete roomServerData.players[uid];
      }

      socket.data.roomId = undefined;
      socket.leave(roomId);

      // Whether any real human remains in the room at all (bots are keyed
      // `bot0`/`bot1`/…, so anything that is not a UUID is a bot).
      const hasRealPlayer = Array.from(match.players.keys()).some((id) =>
        UUID_RE.test(id),
      );

      // Tear the room down when no real human remains in the room — either the
      // room is empty, or only bots are left (the last human, spectator or not,
      // just left). Every human's stats were already recorded at their outcome
      // (eliminated players at round end; this leaver via `persistLeaverAsLoss`
      // above), so abandonMatch is pure teardown: no bot winner, no broadcast,
      // nothing left to persist. Otherwise (a human — playing OR spectating —
      // remains) the match keeps running and the rest see the updated state.
      if (match.players.size === 0) {
        cleanupMatch(roomId, matches, serverOnlyData, serverOnlyBotData);
      } else if (!hasRealPlayer) {
        logger.info(
          { roomId, remainingBots: match.players.size },
          "Race lobby cleaned up: last human left, only bots remain",
        );
        abandonMatch(match, lifecycleDeps);
      } else {
        scheduleRaceUpdate(nsp, match);
      }

      logger.info(
        {
          roomId,
          userId: uid,
          name: playerName,
          remainingPlayers: match.players.size,
        },
        "Player left race match",
      );
      ack?.({ ok: true });
    });

    // --- guess -------------------------------------------------------------
    // A Survivor submits a guess for their currently assigned word. Mirrors
    // Battle Royale's `guess` handler STRUCTURE ONLY — Race is a solo race-to-
    // qualify with independent per-player words, so there is NO attack/target
    // routing, no attack queue, and no attack-word bonuses. The flow is:
    //   1. Guard: match exists, player present + not eliminated, room is in the
    //      `round` phase (the only guessing phase; the Final_Round is also
    //      phase `round` at the last round index), and the player has an
    //      assigned server-only word.
    //   2. Correct-length guard (Req 4.6): a wrong-length guess is rejected
    //      WITHOUT touching guess counts and acknowledged as a non-match.
    //   3. Grade + apply qualification purely via `applyGuess` (Req 4.3–4.5),
    //      writing the returned fields back onto the display player and the new
    //      assigned word back into the server-only record.
    //   4. Acknowledge with per-letter feedback (Req 10.6).
    //   5. Final_Round first-correct-guess win (Req 6.1, 6.2): a correct guess
    //      on the last round declares this guesser the winner and finishes.
    //   6. Schedule a coalesced progress broadcast (Req 4.7).
    socket.on("guess", (payload: { word?: string; guess?: string }) => {
      const { roomId, userId: uid } = socket.data;

      if (!roomId || !uid) {
        return;
      }

      const guess = payload?.word ?? payload?.guess ?? "";

      const match = matches.get(roomId);
      const roomServerOnlyData = serverOnlyData.get(roomId);
      const player = match?.players.get(uid);
      const serverData = roomServerOnlyData?.players[uid];

      // The Final_Round is also phase `round`, at the last configured round
      // index — `round` is the only guessing phase.
      if (
        !match ||
        !roomServerOnlyData ||
        !player ||
        !serverData ||
        match.room.phase !== "round" ||
        player.isEliminated ||
        // Once qualified this round, the player is safe and waiting — no more
        // guesses are accepted until the next round begins (client disables the
        // board too; this is the authoritative server-side gate).
        player.qualified
      ) {
        logger.warn(
          {
            roomId,
            userId: uid,
            phase: match?.room.phase,
            hasPlayer: Boolean(player),
            hasServerData: Boolean(serverData),
            qualified: player?.qualified,
          },
          "Race guess ignored: incomplete, out-of-phase, or already qualified",
        );
        return;
      }

      const roundIndex = match.room.currentRoundIndex;
      const round = config.rounds[roundIndex];
      if (!round) {
        logger.warn(
          { roomId, userId: uid, roundIndex },
          "Race guess ignored: round index out of range",
        );
        return;
      }

      // Wrong-length guess: reject WITHOUT incrementing any counts (Req 4.6).
      // Acknowledge as a non-match so the client can clear its pending input,
      // but do not count it and do not consume the rate gate.
      if (guess.length !== round.wordLength) {
        socket.emit("guess:ack", {
          isMatch: false,
          perLetter: [],
          throttled: false,
        });
        return;
      }

      const now = Date.now();

      // The word this guess is graded against (before applyGuess may reassign a
      // fresh word on a correct guess). The keyboard hints are computed against
      // THIS word so the duplicate-letter rule uses the right target.
      const guessedWord = serverData.word;

      // Grade + apply qualification purely (Req 4.3–4.5). `applyGuess` reads the
      // player's per-round state plus the server-only assigned word and returns
      // the fields to update without mutating anything in place.
      const result = applyGuess(
        {
          completedWords: player.completedWords,
          qualified: player.qualified,
          qualifiedAt: player.qualifiedAt,
          roundGuesses: player.roundGuesses,
          totalGuesses: player.totalGuesses,
          correctGuesses: player.correctGuesses,
          correctLetters: player.correctLetters,
          isEliminated: player.isEliminated,
          word: serverData.word,
        },
        guess,
        round.qualifyingCount,
        round.wordLength,
        now,
      );

      // Accumulate keyboard hints for the current word, applying the
      // duplicate-letter rule (a letter stays yellow while it has an unrevealed
      // occurrence — e.g. the second P in APPLE). This mirrors Battle Royale so
      // the keyboard never shows a duplicate letter as fully solved while one of
      // its copies is still unfound.
      const rawMatches = calculateKeyboardMatches(guessedWord, guess);
      const mergedMatches = mergeKeyboardMatches(
        guessedWord,
        {
          revealedLetters: serverData.revealedLetters ?? {},
          partialMatches: serverData.partialMatches ?? [],
          noMatch: serverData.noMatch ?? [],
        },
        rawMatches,
      );
      serverData.revealedLetters = mergedMatches.revealedLetters;
      serverData.partialMatches = mergedMatches.partialMatches;
      serverData.noMatch = mergedMatches.noMatch;

      // Merge the returned fields back onto the display player and store the
      // (possibly new) assigned word server-side.
      player.completedWords = result.completedWords;
      player.qualified = result.qualified;
      player.qualifiedAt = result.qualifiedAt;
      player.roundGuesses = result.roundGuesses;
      player.totalGuesses = result.totalGuesses;
      player.correctGuesses = result.correctGuesses;
      player.correctLetters = result.correctLetters;
      player.lastFeedback = result.feedback;
      serverData.word = result.word;

      logger.info(serverData.word);

      // A correct guess draws a fresh word (word changed): reset the accumulated
      // keyboard hints so the next word starts with a clean keyboard.
      if (result.word !== guessedWord) {
        serverData.revealedLetters = {};
        serverData.partialMatches = [];
        serverData.noMatch = [];
      }

      // Acknowledge with per-letter feedback (Req 10.6) plus the accumulated
      // keyboard hints so the client can colour keys with the duplicate-letter
      // rule applied (identical to Battle Royale).
      socket.emit("guess:ack", {
        isMatch: result.isMatch,
        perLetter: result.feedback ?? [],
        revealedLetters: serverData.revealedLetters,
        partialMatches: serverData.partialMatches,
        noMatch: serverData.noMatch,
      });

      // Final_Round first-correct-guess win (Req 6.1, 6.2): a correct guess on
      // the LAST configured round declares this guesser the winner and finishes
      // the match immediately. `finishMatch` is idempotent, so a later correct
      // guess after the first is a no-op.
      const isFinalRound = roundIndex === config.rounds.length - 1;
      if (isFinalRound && result.isMatch) {
        handleFinalRoundWin(match, nsp, config, uid, lifecycleDeps);
        return;
      }

      // Broadcast progress, coalesced (Req 4.7).
      scheduleRaceUpdate(nsp, match);

      // If this guess just filled the last advancing spot (enough survivors are
      // now qualified), end the round early instead of waiting for the timer.
      checkEarlyRoundEnd(match, nsp, config, lifecycleDeps);
    });

    socket.on("join", async (payload?: { code?: string }) => {
      const joinCode = payload?.code?.trim();
      logger.info(
        { socketId: socket.id, userId, name, joinCode: joinCode || undefined },
        "Player joining race",
      );

      // --- reconnect handling ------------------------------------------------
      // If this user is already tracked in a match, decide between reconnecting
      // them to it (in progress, not eliminated) or routing them to a fresh
      // lobby (already eliminated) — mirrors Battle Royale's reconnect branch.
      const existingMatch = findMatchForUser(matches, userId);
      const existingPlayer = existingMatch?.players.get(userId);

      if (existingMatch && existingPlayer) {
        const inProgress =
          existingMatch.room.phase === "round" ||
          existingMatch.room.phase === "intermission";

        // Reconnect: match still running and the player is not eliminated —
        // rejoin the same match and send the current snapshot (Req 9.2).
        if (inProgress && !existingPlayer.isEliminated) {
          const matchId = existingMatch.room.matchId;
          socket.data.roomId = matchId;
          socket.join(matchId);
          socket.emit("join:ack", serializeRaceMatch(existingMatch));
          logger.info(
            { matchId, userId, playerCount: existingMatch.players.size },
            "Player reconnected to race match",
          );
          return;
        }

        // Already eliminated from that match: drop them from the old match so
        // they can be routed into a fresh lobby below (Req 9.5). Bots and
        // server-only records for the old room are left untouched here; the old
        // match's own lifecycle/cleanup owns tearing it down.
        if (existingPlayer.isEliminated) {
          const oldMatchId = existingMatch.room.matchId;
          existingMatch.players.delete(userId);
          const oldRoomServerData = serverOnlyData.get(oldMatchId);
          if (oldRoomServerData) {
            delete oldRoomServerData.players[userId];
          }
          logger.info(
            { matchId: oldMatchId, userId },
            "Removed eliminated player from old race match, routing to fresh lobby",
          );
          // fall through to fresh-lobby placement below
        }
      }

      // --- match-start gate --------------------------------------------------
      // Consult the daily-limit seam before placing the player (single gated
      // call for all match-start gating, R9.4). Registered users pass straight
      // through during beta (Req 11.2); a guest is held to one game per mode
      // (R6.1–R6.4) via `canStartMatch(userId, socket.data.isAnonymous)`. On a
      // block the player is NOT placed in any lobby — a guest block maps to the
      // `guest-mode-limit` reason so the client can show the sign-up prompt
      // (R6.3, R6.5); a (future) daily-limit block keeps the `daily-limit`
      // reason (Req 11.3).
      const permitted = await canStartMatch(userId, socket.data.isAnonymous);
      if (!permitted) {
        socket.emit("join:error", {
          reason: socket.data.isAnonymous
            ? GUEST_MODE_LIMIT_REASON
            : "daily-limit",
        });
        logger.info(
          { userId, isAnonymous: socket.data.isAnonymous },
          "Race join rejected: match-start gate blocked",
        );
        return;
      }

      // --- join-by-code (v1 play-with-friends) -------------------------------
      // With a share code, try to join THAT specific lobby instead of the
      // open-lobby scan. It must still be in the `lobby` phase and have a free
      // slot. On any miss (code unknown, match started, lobby full) fall back to
      // normal matchmaking so the player still gets into a race, and emit a
      // one-off `join:notice` so the client can explain the fallback.
      let match: RaceMatch;
      let joinedViaCode = false;

      if (joinCode) {
        const codedMatch = resolveShareCode(matches, joinCode);
        const joinable =
          codedMatch &&
          codedMatch.room.phase === "lobby" &&
          codedMatch.players.size < config.maxLobbySize;

        if (joinable && codedMatch) {
          match = codedMatch;
          joinedViaCode = true;
        } else {
          match = getOrCreateLobby(matches, config);
          socket.emit("join:notice", { reason: "room-unavailable" });
          logger.info(
            { userId, joinCode, matchFound: Boolean(codedMatch) },
            "Race join-by-code fell back to matchmaking: lobby missing/started/full",
          );
        }
      } else {
        match = getOrCreateLobby(matches, config);
      }

      const matchId = match.room.matchId;

      // Ensure the room's server-only record exists (per-player secrets + the
      // room's timers). Created lazily on the first joiner into a lobby.
      let roomServerData = serverOnlyData.get(matchId);
      if (!roomServerData) {
        roomServerData = { players: {}, timers: {} };
        serverOnlyData.set(matchId, roomServerData);
      }

      // Ensure the room's bot simulation record exists so bot-fill on start
      // (countdown-zero-below-minimum) has a record to populate.
      let roomBotData = serverOnlyBotData.get(matchId);
      if (!roomBotData) {
        roomBotData = {};
        serverOnlyBotData.set(matchId, roomBotData);
      }

      // Add the joining player's display state (zeroed per-round + per-match
      // fields) and their server-only secret (assigned on round begin).
      const player: RacePlayer = {
        name,
        isBot: false,
        isEliminated: false,
        isAnonymous: socket.data.isAnonymous, // R4.5 / R4.6
        completedWords: 0,
        qualified: false,
        roundGuesses: 0,
        totalGuesses: 0,
        correctGuesses: 0,
        correctLetters: 0,
      };
      match.players.set(userId, player);
      roomServerData.players[userId] = { word: "", lastAcceptedGuessAt: 0 };

      socket.data.roomId = matchId;
      socket.join(matchId);

      // Acknowledge this joiner with the current snapshot (Req 10.1), then
      // broadcast the updated lobby membership to everyone in the lobby (Req 3.6).
      socket.emit("join:ack", serializeRaceMatch(match));
      broadcastLobbyMembership(nsp, match);

      logger.info(
        { matchId, userId, playerCount: match.players.size },
        "Player added to race lobby",
      );

      // v1 play-with-friends — a friend joined this lobby via a share code.
      // Refresh the countdown so their arrival isn't a race against the
      // original deadline: clear the armed countdown and bump the deadline a
      // full window out, then let scheduleLobbyStart below re-arm it (its guard
      // only skips when a countdown is still set, which we've just cleared).
      // Safe at v1 scale — with ~0 strangers in the lobby, delaying the start
      // inconveniences nobody. The max-size branch below still starts instantly.
      if (
        joinedViaCode &&
        match.room.phase === "lobby" &&
        roomServerData.timers.lobbyCountdown
      ) {
        clearTimeout(roomServerData.timers.lobbyCountdown);
        roomServerData.timers.lobbyCountdown = undefined;
        match.room.lobbyDeadline = Date.now() + config.lobbyCountdownMs;
        logger.info(
          { matchId, userId, newDeadline: match.room.lobbyDeadline },
          "Refreshed race lobby countdown: friend joined via share code",
        );
      }

      // Start conditions: reaching the max lobby size starts immediately
      // (Req 3.3); otherwise arm the lobby countdown so the match starts when
      // it reaches zero at/above the minimum, or after bot-fill below it
      // (Req 3.4, 3.5).
      if (match.players.size >= config.maxLobbySize) {
        await startMatch(
          match,
          nsp,
          config,
          startDeps,
          roomServerData,
          roomBotData,
        );
      } else {
        scheduleLobbyStart(
          match,
          nsp,
          config,
          startDeps,
          roomServerData,
          roomBotData,
        );
      }
    });
  });
};
