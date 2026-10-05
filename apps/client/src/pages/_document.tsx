import { Html, Head, Main, NextScript } from "next/document";
import Script from "next/script";
export default function Document() {
  const isDevelopment = process.env.NODE_ENV === "development";
  return (
    <Html lang="en">
      <Head>
        {/* Title/description/OpenGraph live in _app (next/head) so pages can
            override them without duplication. Keep only static, non-overridden
            tags here. */}
        <meta
          name="keywords"
          content="Final Word, multiplayer word game, word game, Wordle, word puzzle, online word game, duel word game"
        />
        {isDevelopment && (
          <Script
            src="//unpkg.com/react-scan/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </Head>
      <body>
        <Main /> <NextScript />
        {isDevelopment && (
          <div className="fixed top-0 left-1/2 z-99999 -translate-x-1/2 rounded-b-md bg-yellow-500 px-3 py-1 font-mono text-[11px] font-bold tracking-wider text-black">
            DEV
          </div>
        )}
      </body>
    </Html>
  );
}
