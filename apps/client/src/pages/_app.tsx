import type { AppType } from "next/app";
import { Archivo_Black, Geist } from "next/font/google";
import Head from "next/head";
import Script from "next/script";
import { useEffect } from "react";
import { api } from "@/utils/api";
import "@/styles/globals.css";
import Background from "@/components/background/background";
import DuelNotifications from "@/components/duel-notifications";
import PwaInstall from "@/components/pwa-install";
import TabBar from "@/components/navigation/tab-bar";
import Toaster from "@/components/toaster";
import { useAuthStore } from "@/state/auth-store";
import { identifyUser, initAnalytics, resetAnalytics } from "@/utils/posthog";
import { SITE_DESCRIPTION, SITE_NAME } from "@/utils/site";

const geist = Geist({
  subsets: ["latin"],
});

// Chunky display face for tiles, headings and buttons ("Arena" theme).
const archivo = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
});

// Expose both families as :root variables (not just a wrapper className) so
// portaled UI mounted on <body> (modals, dialogs) gets them too.
const FONT_VARS = `:root{--font-geist-sans:${geist.style.fontFamily};--font-archivo-black:${archivo.style.fontFamily};}`;

const MyApp: AppType = ({ Component, pageProps }) => {
  const userId = useAuthStore((state) => state.user?.id);

  // Initialize PostHog once on the client (no-op without a key, so dev/preview
  // builds don't run analytics).
  useEffect(() => {
    initAnalytics();
  }, []);

  // Register the PWA service worker in production only. In dev it would serve
  // stale assets and fight with HMR.
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal: the app works fine without the service worker.
      });
    }
  }, []);

  // Tie events to the signed-in user once auth resolves, and clear the identity
  // on sign-out so a shared device doesn't attribute events to the wrong user.
  useEffect(() => {
    if (userId) {
      identifyUser(userId);
    } else {
      resetAnalytics();
    }
  }, [userId]);

  return (
    <div className={geist.className}>
      <Head>
        <style dangerouslySetInnerHTML={{ __html: FONT_VARS }} />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <title>{`${SITE_NAME} — Multiplayer Word Game`}</title>
        <meta content={SITE_DESCRIPTION} name="description" />
        <meta content="index, follow" name="robots" />
        <meta
          content={`${SITE_NAME} — Multiplayer Word Game`}
          property="og:title"
        />
        <meta content={SITE_DESCRIPTION} property="og:description" />
        <meta content="website" property="og:type" />
        <meta content={SITE_NAME} property="og:site_name" />
      </Head>

      {process.env.NODE_ENV === "production" && (
        <>
          <Script
            src="https://www.googletagmanager.com/gtag/js?id=AW-18507472920"
            strategy="afterInteractive"
          />
          <Script id="google-ads-tag" strategy="afterInteractive">
            {`
				window.dataLayer = window.dataLayer || [];
				function gtag(){window.dataLayer.push(arguments);}
				gtag('js', new Date());
				gtag('config', 'AW-18507472920');
			`}
          </Script>
        </>
      )}

      <Background />
      <Toaster />
      <DuelNotifications />
      <PwaInstall />
      <TabBar />
      <Component {...pageProps} />
    </div>
  );
};

export default api.withTRPC(MyApp);
