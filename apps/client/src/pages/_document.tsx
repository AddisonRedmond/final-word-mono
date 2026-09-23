import { Html, Head, Main, NextScript } from "next/document";
import Script from "next/script";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <title>Final Word</title>
        <meta
          name="description"
          content="Final Word is a fast-paced multiplayer word game. Race against other players, solve the word, and be the last one standing."
        />
        <meta
          name="keywords"
          content="Final Word, multiplayer word game, word game, Wordle, word puzzle, online word game"
        />
        <meta name="robots" content="index, follow" />

        <meta
          property="og:title"
          content="Final Word — Multiplayer Word Game"
        />
        <meta
          property="og:description"
          content="Race against other players to solve the word. Think fast, guess smart, and be the last one standing."
        />
        <meta property="og:type" content="website" />

        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-scan/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
