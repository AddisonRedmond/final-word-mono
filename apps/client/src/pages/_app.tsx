import type { AppType } from "next/app";
import { Geist } from "next/font/google";
import Head from "next/head";
import Script from "next/script";
import { api } from "@/utils/api";
import "@/styles/globals.css";
import Background from "@/components/background/background";
import DuelNotifications from "@/components/duel-notifications";
import Toaster from "@/components/toaster";
import { SITE_DESCRIPTION, SITE_NAME } from "@/utils/site";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  return (
    <div className={geist.className}>
      <Head>
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
      <Component {...pageProps} />
    </div>
  );
};

export default api.withTRPC(MyApp);
