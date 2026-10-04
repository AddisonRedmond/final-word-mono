import type { AppType } from "next/app";
import { Geist } from "next/font/google";
import Head from "next/head";
import { api } from "@/utils/api";
import "@/styles/globals.css";
import Background from "@/components/background/background";
import DuelNotifications from "@/components/duel-notifications";
import Toaster from "@/components/toaster";

const geist = Geist({
	subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
	return (
		<div className={geist.className}>
			<Head>
				{/* Device-width viewport so mobile browsers lay the UI out at the
				    physical screen width instead of a zoomed-out desktop canvas.
				    Lives in _app (not _document) per Next.js guidance. */}
				<meta
					content="width=device-width, initial-scale=1, viewport-fit=cover"
					name="viewport"
				/>
			</Head>
			<Background />
			<Toaster />
			<DuelNotifications />
			<Component {...pageProps} />
		</div>
	);
};

export default api.withTRPC(MyApp);
