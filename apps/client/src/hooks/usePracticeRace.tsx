import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIVE_LETTER_GUESS_WORDS } from "@/shared/words";
import type {
  ClientRaceMatch,
  ClientRacePlayer,
  LetterFeedback,
} from "@/types/race.types";
import type { GuessAck, MatchResult } from "@/hooks/useRaceSocket";

/**
 * Fully CLIENT-SIDE Race practice engine.
 *
 * Produces the SAME result shape as `useRaceSocket` (a `ClientRaceMatch`
 * snapshot, a `guess:ack`, a final `MatchResult`, plus `sendGuess`/`leave`) so
 * the existing Race view components (`RoundBoard`, `RaceOpponents`,
 * `ResultView`, …) render it with no changes. The difference is there is NO
 * socket, NO auth, and NO server — bots advance on a local timer and the
 * player's guesses are graded in the browser. This is the no-account "try it"
 * experience for cold ad traffic (public `/practice` page).
 *
 * Scope: a single round, race to solve `WORDS_TO_QUALIFY` five-letter words
 * against a field of local bots. Deliberately simpler than the real Race (no
 * multi-round lifecycle, no difficulty archetypes) — it's a taste, not a
 * faithful replica.
 */

const PLAYER_ID = "you";
const WORD_LENGTH = 5;
const WORDS_TO_QUALIFY = 3;
const BOT_COUNT = 10;
const ROUND_MS = 90_000;
const BOT_TICK_MS = 500;
// Pre-start countdown so a cold visitor isn't dropped straight into a live game
// wondering whether to start typing — mirrors the real game's lobby countdown.
const LOBBY_MS = 5_000;

// Pre-generated human-ish bot names so the field doesn't read as "bot0…". Kept
// short; they're only shown as a robot-badge tooltip in practice.
const BOT_NAMES = [
  "Ava",
  "Leo",
  "Mia",
  "Max",
  "Zoe",
  "Finn",
  "Ivy",
  "Jax",
  "Nora",
  "Eli",
  "Remy",
  "Cleo",
];

type PracticeBot = {
  id: string;
  name: string;
  completedWords: number;
  qualified: boolean;
  isEliminated: boolean;
  // Absolute time (ms) the bot next completes a word. Randomized per bot so the
  // field finishes at a spread of paces — some clearly faster than the player,
  // some slower — making the race feel real without a difficulty system.
  nextCompleteAt: number;
  // Per-word pace window for this bot (min/max ms between word completions).
  paceMin: number;
  paceMax: number;
};

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomSecret = (): string => {
  const list = FIVE_LETTER_GUESS_WORDS;
  return (
    list[Math.floor(Math.random() * list.length)]?.toUpperCase() ?? "WORDS"
  );
};

/**
 * Two-pass Wordle grading (handles duplicate letters correctly), producing the
 * per-letter feedback plus accumulated keyboard hints the `RoundBoard` expects
 * on a `guess:ack`. Mirrors the duel grader's algorithm, kept local so practice
 * has no server dependency.
 */
const gradeGuess = (
  guess: string,
  target: string,
): { isMatch: boolean; perLetter: LetterFeedback[] } => {
  const g = guess.toUpperCase();
  const t = target.toUpperCase();
  const perLetter: LetterFeedback[] = new Array(g.length);
  const remaining: Record<string, number> = {};
  for (const ch of t) {
    remaining[ch] = (remaining[ch] ?? 0) + 1;
  }
  // Pass 1 — exact matches.
  for (let i = 0; i < g.length; i++) {
    const ch = g[i] as string;
    if (ch === t[i]) {
      perLetter[i] = { index: i, letter: ch, state: "correct" };
      remaining[ch] = (remaining[ch] ?? 0) - 1;
    }
  }
  // Pass 2 — present / absent for the rest.
  for (let i = 0; i < g.length; i++) {
    if (perLetter[i]) {
      continue;
    }
    const ch = g[i] as string;
    if ((remaining[ch] ?? 0) > 0) {
      perLetter[i] = { index: i, letter: ch, state: "present" };
      remaining[ch] = (remaining[ch] ?? 0) - 1;
    } else {
      perLetter[i] = { index: i, letter: ch, state: "absent" };
    }
  }
  return { isMatch: g === t, perLetter };
};

/** Accumulate keyboard hints for the current word from a graded guess. */
const mergeHints = (
  prev: { revealedLetters: Record<number, string>; partialMatches: string[]; noMatch: string[] },
  perLetter: LetterFeedback[],
) => {
  const revealedLetters = { ...prev.revealedLetters };
  const partial = new Set(prev.partialMatches);
  const no = new Set(prev.noMatch);
  for (const entry of perLetter) {
    if (entry.state === "correct") {
      revealedLetters[entry.index] = entry.letter;
    } else if (entry.state === "present") {
      partial.add(entry.letter);
    } else {
      no.add(entry.letter);
    }
  }
  return {
    revealedLetters,
    partialMatches: [...partial],
    noMatch: [...no],
  };
};

/**
 * How a finished practice game ended, so the overlay can show the right thing:
 *   - "won"     → the player reached the qualify count first (fireworks).
 *   - "lost"    → a bot got there first, or the round timed out.
 *   - "forfeit" → the player left via the Leave button (encouraging message).
 */
export type PracticeOutcome = "won" | "lost" | "forfeit";

export type UsePracticeRaceResult = {
  match: ClientRaceMatch;
  lastAck: GuessAck | undefined;
  result: MatchResult | undefined;
  /** Set once the game ends; drives which finish overlay is shown. */
  outcome: PracticeOutcome | undefined;
  sendGuess: (guess: string) => void;
  /** Restart a fresh practice game (new words, new bots). */
  restart: () => void;
  /**
   * End the practice game now (e.g. the Leave button) and surface the finish
   * overlay, rather than navigating away. Keeps a cold visitor on the page with
   * a clear next step (play again / sign in) instead of a jarring redirect.
   */
  endNow: () => void;
};

const makeBots = (now: number): PracticeBot[] =>
  Array.from({ length: BOT_COUNT }, (_, i) => {
    // Practice bots are intentionally EASY so a first-time visitor can win and
    // feel good (practice is a conversion hook, not a real match). Each bot
    // takes ~13–30s per word, so clearing 3 words takes a bot ~40–90s — slow
    // enough that a player who's typing along reliably beats the field. The
    // real Race bots are tuned separately in the server and are far sharper.
    const paceMin = randInt(13_000, 22_000);
    const paceMax = paceMin + randInt(6_000, 12_000);
    return {
      id: `bot${i}`,
      name: BOT_NAMES[i] ?? `Bot ${i + 1}`,
      completedWords: 0,
      qualified: false,
      isEliminated: false,
      paceMin,
      paceMax,
      nextCompleteAt: now + randInt(paceMin, paceMax),
    };
  });

export const usePracticeRace = (): UsePracticeRaceResult => {
  // Player state.
  const [playerCompleted, setPlayerCompleted] = useState(0);
  const [playerQualified, setPlayerQualified] = useState(false);
  const [lastAck, setLastAck] = useState<GuessAck>();
  const [result, setResult] = useState<MatchResult>();
  const [outcome, setOutcome] = useState<PracticeOutcome>();

  // The player's current secret + accumulated hints for it.
  const secretRef = useRef<string>(randomSecret());
  const hintsRef = useRef({
    revealedLetters: {} as Record<number, string>,
    partialMatches: [] as string[],
    noMatch: [] as string[],
  });

  // Phase + timing. The game opens in a short `lobby` countdown (so the visitor
  // isn't dropped straight into live play), then flips to `round`. Bots are
  // paced from ROUND START, not mount, so nothing moves during the countdown.
  const [phase, setPhase] = useState<"lobby" | "round">("lobby");
  const [lobbyDeadline, setLobbyDeadline] = useState<number>(
    () => Date.now() + LOBBY_MS,
  );
  const [roundEndsAt, setRoundEndsAt] = useState<number>(
    () => Date.now() + LOBBY_MS + ROUND_MS,
  );
  const [bots, setBots] = useState<PracticeBot[]>(() =>
    makeBots(Date.now() + LOBBY_MS),
  );
  const finishedRef = useRef(false);

  const restart = useCallback(() => {
    const now = Date.now();
    const roundStart = now + LOBBY_MS;
    secretRef.current = randomSecret();
    hintsRef.current = { revealedLetters: {}, partialMatches: [], noMatch: [] };
    finishedRef.current = false;
    setPhase("lobby");
    setLobbyDeadline(roundStart);
    setPlayerCompleted(0);
    setPlayerQualified(false);
    setLastAck(undefined);
    setResult(undefined);
    setOutcome(undefined);
    setRoundEndsAt(roundStart + ROUND_MS);
    setBots(makeBots(roundStart));
  }, []);

  // Flip lobby → round when the countdown elapses. Re-armed on restart via the
  // `lobbyDeadline` dependency.
  useEffect(() => {
    setPhase("lobby");
    const delay = Math.max(0, lobbyDeadline - Date.now());
    const timer = setTimeout(() => setPhase("round"), delay);
    return () => clearTimeout(timer);
  }, [lobbyDeadline]);

  // Finish the game: rank the field (bots + player) by completed words, record
  // the outcome, and emit a MatchResult. `reason` distinguishes a real win
  // (player qualified first) from a loss (bot/timeout) and a forfeit (left).
  const finish = useCallback(
    (snapshotBots: PracticeBot[], reason: PracticeOutcome) => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;

      const playerWon = reason === "won";
      const ranked = [
        {
          id: PLAYER_ID,
          completed: playerWon ? WORDS_TO_QUALIFY : playerCompleted,
        },
        ...snapshotBots.map((b) => ({ id: b.id, completed: b.completedWords })),
      ].sort((a, b) => b.completed - a.completed);

      const placements = ranked.map((entry, index) => ({
        playerId: entry.id,
        placement: index + 1,
      }));
      const winnerId = placements[0]?.playerId;
      setOutcome(reason);
      setResult({ winnerId, placements });
    },
    [playerCompleted],
  );

  // End the game on demand (Leave button) — a forfeit. Finalize against the
  // current bot field so the finish overlay shows, rather than navigating away.
  const endNow = useCallback(() => {
    setBots((current) => {
      finish(current, "forfeit");
      return current;
    });
  }, [finish]);

  // Bot ticker: advance each bot's word progress on its own pace. First bot (or
  // the player) to WORDS_TO_QUALIFY ends the race. Also ends on round timeout.
  // Only runs during the `round` phase — bots stay still during the countdown.
  useEffect(() => {
    if (result || phase !== "round") {
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();

      if (now >= roundEndsAt && !finishedRef.current) {
        setBots((current) => {
          finish(current, "lost");
          return current;
        });
        return;
      }

      setBots((current) => {
        let changed = false;
        const next = current.map((bot) => {
          if (bot.qualified || now < bot.nextCompleteAt) {
            return bot;
          }
          changed = true;
          const completedWords = bot.completedWords + 1;
          const qualified = completedWords >= WORDS_TO_QUALIFY;
          return {
            ...bot,
            completedWords,
            qualified,
            nextCompleteAt: now + randInt(bot.paceMin, bot.paceMax),
          };
        });
        if (!changed) {
          return current;
        }
        // A bot hit the qualify count first → it wins, race over.
        const botWinner = next.find((b) => b.qualified);
        if (botWinner && !finishedRef.current) {
          finish(next, "lost");
        }
        return next;
      });
    }, BOT_TICK_MS);

    return () => clearInterval(interval);
  }, [result, phase, roundEndsAt, finish]);

  const sendGuess = useCallback(
    (guess: string) => {
      // Ignore guesses before the round actually starts or after it ends.
      if (finishedRef.current || phase !== "round") {
        return;
      }
      const { isMatch, perLetter } = gradeGuess(guess, secretRef.current);

      if (isMatch) {
        // Correct: advance, draw a fresh word, reset this word's hints.
        const completed = playerCompleted + 1;
        secretRef.current = randomSecret();
        hintsRef.current = {
          revealedLetters: {},
          partialMatches: [],
          noMatch: [],
        };
        setLastAck({
          isMatch: true,
          perLetter,
          revealedLetters: {},
          partialMatches: [],
          noMatch: [],
        });
        setPlayerCompleted(completed);
        if (completed >= WORDS_TO_QUALIFY) {
          setPlayerQualified(true);
          // Player wins by reaching the qualify count first.
          setBots((current) => {
            finish(current, "won");
            return current;
          });
        }
        return;
      }

      // Wrong: accumulate keyboard hints for the current word.
      hintsRef.current = mergeHints(hintsRef.current, perLetter);
      setLastAck({
        isMatch: false,
        perLetter,
        revealedLetters: hintsRef.current.revealedLetters,
        partialMatches: hintsRef.current.partialMatches,
        noMatch: hintsRef.current.noMatch,
      });
    },
    [playerCompleted, phase, finish],
  );

  // Assemble the ClientRaceMatch snapshot the view components consume.
  const match = useMemo<ClientRaceMatch>(() => {
    const players: Record<string, ClientRacePlayer> = {
      [PLAYER_ID]: {
        name: "You",
        isEliminated: false,
        completedWords: playerCompleted,
        qualified: playerQualified,
        totalGuesses: 0,
        correctGuesses: playerCompleted,
      },
    };
    for (const bot of bots) {
      players[bot.id] = {
        name: bot.name,
        isEliminated: bot.isEliminated,
        completedWords: bot.completedWords,
        qualified: bot.qualified,
        totalGuesses: 0,
        correctGuesses: bot.completedWords,
      };
    }

    return {
      room: {
        matchId: "practice",
        phase: result ? "finished" : phase,
        currentRoundIndex: 0,
        roundEndsAt,
        lobbyDeadline,
        winnerId: result?.winnerId,
        isDraw: false,
      },
      players,
    };
  }, [
    bots,
    playerCompleted,
    playerQualified,
    phase,
    roundEndsAt,
    lobbyDeadline,
    result,
  ]);

  return { match, lastAck, result, outcome, sendGuess, restart, endNow };
};
