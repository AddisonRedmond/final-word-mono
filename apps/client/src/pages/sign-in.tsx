"use client";

import Head from "next/head";
import GuestPlayButton from "@/components/guest/guest-play-button";
import Tile from "@/components/tile";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { createClient } from "@/utils/supabase/client";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/utils/site";
import type { NextPage } from "next/types";

const PAGE_TITLE = "Final Word — Multiplayer Word Game | Duels, Battle Royale & Race";

// Short, accurate blurbs for each mode. These double as real on-page content a
// search crawler can read to understand what the app is (the only reliably
// crawlable page, since every other route redirects to sign-in).
const GAME_MODES = [
  {
    name: "Duel",
    blurb:
      "Challenge a friend to a head-to-head match. Guess the hidden five-letter word in the fewest tries to win — play at your own pace and review every result.",
  },
  {
    name: "Battle Royale",
    blurb:
      "Join a live lobby and race the whole field. Keep solving words to survive while others are knocked out, and be the last player standing.",
  },
  {
    name: "Race",
    blurb:
      "A fast, round-based sprint. Clear each round's words before the clock runs out and climb the standings against other players in real time.",
  },
] as const;

const SignIn: NextPage = () => {
  // Guest play is desktop-only (see the guest section below). Gate on
  // `hydrated` so the server-rendered markup (desktop) doesn't flash the guest
  // button onto a phone before the viewport is known.
  const { isDesktop, hydrated } = useIsDesktop();

  const handleOAuthSignIn = async (provider: "github" | "google") => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  };

  return (
    <>
      <Head>
        <title>{PAGE_TITLE}</title>
        <meta content={SITE_DESCRIPTION} name="description" />
        {/* This is the only page a logged-out crawler can actually reach (the
            root redirects unauthenticated visitors here), so it is its own
            canonical — pointing canonical at "/" would create a redirect loop
            for crawlers. */}
        <link href={`${SITE_URL}/sign-in`} rel="canonical" />
        <meta content={PAGE_TITLE} property="og:title" />
        <meta content={SITE_DESCRIPTION} property="og:description" />
        <meta content="website" property="og:type" />
        <meta content={`${SITE_URL}/sign-in`} property="og:url" />
        <meta content={SITE_NAME} property="og:site_name" />
        <meta content="summary_large_image" name="twitter:card" />
        <meta content={PAGE_TITLE} name="twitter:title" />
        <meta content={SITE_DESCRIPTION} name="twitter:description" />
      </Head>

      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-8 px-4 py-12">
        {/* The LOGIN tiles are sized for desktop (lg); scale them down on small
            screens so the 5-tile word never overflows a phone. CSS scale
            defaults to a center origin, so they shrink in place. */}
        <div className="scale-[0.68] sm:scale-100">
          <Tile word={"LOGIN"} revealed={true} variant="correct" size="lg" />
        </div>

        {/* Real, crawlable copy describing the game. The single <h1> and the
            tagline give search engines (and screen-reader users) a clear,
            accurate statement of what Final Word is — this is the only page a
            logged-out crawler can reach. */}
        <header className="max-w-md text-center">
          <h1 className="font-bold text-2xl text-stone-800 sm:text-3xl">
            Final Word — Multiplayer Word Game
          </h1>
          <p className="mt-2 text-sm text-stone-600 sm:text-base">
            Guess the hidden five-letter word before your rivals do. Duel a
            friend head-to-head, or jump into live Battle Royale and Race modes.
            Sign in to play.
          </p>
        </header>

      <div className="flex w-full max-w-xs flex-col gap-3 sm:max-w-sm">
        <button
          type="button"
          onClick={() => handleOAuthSignIn("github")}
          className="flex items-center justify-center gap-3 rounded-lg border border-white/60 bg-zinc-900/95 px-6 py-3 font-semibold text-white shadow-lg shadow-black/40 backdrop-blur-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-95"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={() => handleOAuthSignIn("google")}
          className="flex items-center justify-center gap-3 rounded-lg border border-white/60 bg-white px-6 py-3 font-semibold text-zinc-900 shadow-lg shadow-black/40 backdrop-blur-sm transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-95"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.645h6.458c-.278 1.5-1.126 2.77-2.4 3.62v3.007h3.885c2.273-2.093 3.577-5.176 3.577-8.817z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.956-1.075 7.943-2.91l-3.885-3.007c-1.076.722-2.452 1.15-4.058 1.15-3.122 0-5.766-2.108-6.71-4.943H1.28v3.104C3.256 21.31 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.29 14.29A7.19 7.19 0 0 1 4.909 12c0-.795.137-1.567.382-2.29V6.606H1.28A11.99 11.99 0 0 0 0 12c0 1.936.464 3.768 1.28 5.394l4.01-3.104z"
            />
            <path
              fill="#EA4335"
              d="M12 4.767c1.763 0 3.346.606 4.59 1.796l3.445-3.445C17.951 1.19 15.236 0 12 0 7.31 0 3.256 2.69 1.28 6.606l4.01 3.104C6.234 6.875 8.878 4.767 12 4.767z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Feature: anonymous-sign-in — "Play as guest" entry point with an
            inline Cloudflare Turnstile captcha. The button stays disabled until
            the captcha is solved; the token is verified server-side before a
            guest account is minted. */}
        {/* Guest play is desktop-only: a mobile guest can't reach any playable
            mode (realtime modes are desktop-only and duels are hidden for
            guests), so they'd land on an empty menu. We skip rendering the
            whole guest path on mobile entirely — divider included — which also
            avoids loading the Turnstile captcha script on phones. */}
        {hydrated && isDesktop && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-white/20" />
              <span className="text-white/60 text-xs uppercase tracking-widest">
                or
              </span>
              <span className="h-px flex-1 bg-white/20" />
            </div>
            <GuestPlayButton />
          </div>
        )}
        </div>

        {/* Game-mode descriptions — accurate, indexable content so search
            engines understand Final Word is a word-guessing game (not the
            unrelated words from the animated background). */}
        <section className="w-full max-w-md" aria-labelledby="game-modes-heading">
          <h2
            className="text-center font-semibold text-stone-500 text-xs uppercase tracking-widest"
            id="game-modes-heading"
          >
            Ways to play
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {GAME_MODES.map((mode) => (
              <li
                key={mode.name}
                className="rounded-lg border border-stone-200 bg-white/80 p-4 text-left shadow-sm backdrop-blur-sm"
              >
                <h3 className="font-bold text-sm text-stone-800">
                  {mode.name}
                </h3>
                <p className="mt-1 text-sm text-stone-600">{mode.blurb}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
};

export default SignIn;
