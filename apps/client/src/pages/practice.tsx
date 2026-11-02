import type { FireworksProps } from "@fireworks-js/react";
import { motion } from "motion/react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import GameCenterPanel from "@/components/game-components/game-center-panel";
import LobbyView from "@/components/games/race/lobby-view";
import type { RaceOpponent } from "@/components/games/race/race-opponents";
import RaceOpponents from "@/components/games/race/race-opponents";
import RoundBoard from "@/components/games/race/round-board";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
  type PracticeOutcome,
  usePracticeRace,
} from "@/hooks/usePracticeRace";
import { track } from "@/utils/posthog";
import { SITE_NAME } from "@/utils/site";

const PLAYER_ID = "you";
const WORDS_TO_QUALIFY = 3;

/**
 * Public, no-account PRACTICE page — a client-side taste of Race for cold ad
 * traffic. Deliberately NOT behind the auth proxy (not listed in
 * `src/proxy.ts`'s matcher), so a visitor who clicks an ad can play instantly
 * without signing in, then is nudged to sign in to play real opponents.
 *
 * It reuses the real Race view components (`RoundBoard`, `RaceOpponents`,
 * `GameCenterPanel`) driven by the fully client-side `usePracticeRace` engine —
 * no socket, no server, no DB. The only visible tells are the robot opponent
 * icons (every opponent is a bot) and the sign-in call to action on finish.
 */
const Practice: React.FC = () => {
  const router = useRouter();
  // Practice reuses the Race board, which is desktop/tablet-only (the flanking
  // opponent columns + keyboard don't fit a phone). Ads currently target
  // tablet/desktop, so gate practice to those sizes and show a "larger screen"
  // notice on mobile until a mobile layout is built. Hooks still run
  // unconditionally (rules of hooks); only the RENDER branches on size.
  const { isDesktop, hydrated } = useIsDesktop();
  const { match, lastAck, result, outcome, sendGuess, restart, endNow } =
    usePracticeRace();

  // Lazy-load the same fireworks library the real Winner overlay uses, only
  // when the player actually wins — keeps it out of the initial bundle for a
  // page whose whole point is a fast first paint for ad traffic.
  const [Fireworks, setFireworks] =
    useState<ComponentType<FireworksProps> | null>(null);
  useEffect(() => {
    if (outcome !== "won") {
      return;
    }
    let mounted = true;
    void import("@fireworks-js/react").then(({ Fireworks }) => {
      if (mounted) {
        setFireworks(() => Fireworks);
      }
    });
    return () => {
      mounted = false;
    };
  }, [outcome]);

  // Analytics: page viewed + game started (fired once on mount), and completed
  // (fired once when a result lands). These answer whether the no-account taste
  // actually converts cold traffic toward sign-in.
  useEffect(() => {
    track("practice_viewed");
    track("practice_started");
  }, []);

  const completedTracked = useRef(false);
  useEffect(() => {
    if (result && !completedTracked.current) {
      completedTracked.current = true;
      const youWon = result.winnerId === PLAYER_ID;
      track("practice_completed", { won: youWon });
    }
  }, [result]);

  // Split the non-self roster into two flanking columns, matching Race.
  const { evenOpponents, oddOpponents } = useMemo(() => {
    const even: RaceOpponent[] = [];
    const odd: RaceOpponent[] = [];
    Object.entries(match.players).forEach(([id, player], index) => {
      if (id === PLAYER_ID) {
        return;
      }
      if (index % 2 === 0) {
        even.push({ ...player, id });
      } else {
        odd.push({ ...player, id });
      }
    });
    return { evenOpponents: even, oddOpponents: odd };
  }, [match.players]);

  const handleSignInClick = () => {
    track("practice_signin_clicked");
    void router.push("/sign-in");
  };

  // On mobile (below the desktop breakpoint) practice isn't playable yet, so
  // show a friendly notice with a sign-in fallback instead of a broken board —
  // this also catches someone opening the `/practice` URL directly on a phone.
  // `!hydrated` is the neutral loading state (avoids a flash before the real
  // viewport width is known).
  if (hydrated && !isDesktop) {
    return (
      <>
        <Head>
          <title>{`Practice — ${SITE_NAME}`}</title>
        </Head>
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="text-5xl" aria-hidden="true">
            💻
          </p>
          <h1 className="font-black text-2xl text-stone-800">
            Practice needs a bigger screen
          </h1>
          <p className="text-sm text-stone-600">
            The practice race is built for tablet and desktop right now. Open
            Final Word on a larger screen to try it — or sign in to play duels,
            which work great on mobile.
          </p>
          <Link
            className="w-full rounded-lg bg-emerald-500 px-6 py-3 font-bold text-sm text-white uppercase tracking-wider transition-colors hover:bg-emerald-400"
            href="/sign-in"
          >
            Sign in to play
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{`Practice — ${SITE_NAME}`}</title>
        <meta
          content="Try Final Word free — no account needed. Race to guess five-letter words against a field of bots, then sign in to play real opponents."
          name="description"
        />
      </Head>

      <motion.main
        animate={{ scale: 1, opacity: 1 }}
        className="flex min-h-dvh w-full flex-col"
        initial={{ scale: 0.98, opacity: 0 }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-bold text-stone-700 text-sm uppercase tracking-widest">
            Practice Race
          </p>
          <Link
            className="rounded-md bg-stone-800 px-3 py-1.5 font-semibold text-white text-xs transition-colors hover:bg-stone-700"
            href="/sign-in"
            onClick={() => track("practice_signin_clicked")}
          >
            Sign in
          </Link>
        </div>

        <div className="flex min-h-0 w-full grow py-5">
          <RaceOpponents
            opponents={evenOpponents}
            qualifyingCount={WORDS_TO_QUALIFY}
            showBotIcon
          />

          <GameCenterPanel>
            {result && outcome ? (
              <PracticeFinish
                outcome={outcome}
                Fireworks={Fireworks}
                onSignIn={handleSignInClick}
                onPlayAgain={restart}
              />
            ) : match.room.phase === "lobby" ? (
              // Pre-start countdown so the visitor sees "Game Starting" before
              // play begins, instead of being dropped straight into a live game.
              <LobbyView
                match={match}
                onLeave={endNow}
                userId={PLAYER_ID}
                wordLengthOverride={5}
              />
            ) : (
              <RoundBoard
                lastAck={lastAck}
                match={match}
                onGuess={sendGuess}
                onLeave={endNow}
                qualifyingCountOverride={WORDS_TO_QUALIFY}
                userId={PLAYER_ID}
                wordLengthOverride={5}
              />
            )}
          </GameCenterPanel>

          <RaceOpponents
            opponents={oddOpponents}
            qualifyingCount={WORDS_TO_QUALIFY}
            showBotIcon
          />
        </div>
      </motion.main>
    </>
  );
};

export default Practice;

/** Copy per finish outcome. A forfeit (left early) gets a sad-but-encouraging
 *  message; a loss is neutral-encouraging; a win celebrates (fireworks added by
 *  the caller). */
const FINISH_COPY: Record<
  PracticeOutcome,
  { emoji: string; title: string; body: string }
> = {
  won: {
    emoji: "🎉",
    title: "You won!",
    body: "You beat the whole field. Real players are tougher. Sign in to race them and climb the leaderboard!",
  },
  lost: {
    emoji: "🏁",
    title: "So close!",
    body: "The field edged you out this time. Sign in to race real players you'll get the hang of it fast!",
  },
  forfeit: {
    emoji: "😔",
    title: "Leaving so soon?",
    body: "No worries give it another go and real opponents make it even better!",
  },
};

type PracticeFinishProps = {
  outcome: PracticeOutcome;
  Fireworks: ComponentType<FireworksProps> | null;
  onSignIn: () => void;
  onPlayAgain: () => void;
};

/**
 * The practice end screen. Shows outcome-appropriate copy and, on a real win,
 * the same fireworks animation the live game uses — loaded lazily by the parent
 * and passed in here.
 */
const PracticeFinish: React.FC<PracticeFinishProps> = ({
  outcome,
  Fireworks,
  onSignIn,
  onPlayAgain,
}) => {
  const copy = FINISH_COPY[outcome];

  return (
    <div className="relative flex flex-col items-center gap-4 px-4 py-6 text-center">
      {/* Fireworks only on a genuine win, matching the live Winner overlay. */}
      {outcome === "won" && Fireworks && (
        <div className="pointer-events-none fixed inset-0 z-0">
          <Fireworks
            className="h-full w-full"
            options={{
              autoresize: true,
              opacity: 0.5,
              acceleration: 1.05,
              friction: 0.97,
              gravity: 1.5,
              particles: 50,
              traceLength: 3,
              traceSpeed: 10,
              explosion: 5,
              intensity: 30,
              flickering: 50,
              hue: { min: 0, max: 360 },
              delay: { min: 30, max: 60 },
              rocketsPoint: { min: 25, max: 75 },
            }}
          />
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-4">
        <p className="text-5xl" aria-hidden="true">
          {copy.emoji}
        </p>
        <p className="font-black text-2xl text-stone-800">{copy.title}</p>
        <p className="max-w-xs text-sm text-stone-600">{copy.body}</p>
        <button
          className="w-full max-w-xs rounded-lg bg-emerald-500 px-6 py-3 font-bold text-sm text-white uppercase tracking-wider transition-colors hover:bg-emerald-400"
          onClick={onSignIn}
          type="button"
        >
          Sign in to play real opponents
        </button>
        <button
          className="text-sm text-stone-500 underline-offset-2 hover:underline"
          onClick={onPlayAgain}
          type="button"
        >
          Play practice again
        </button>
      </div>
    </div>
  );
};
