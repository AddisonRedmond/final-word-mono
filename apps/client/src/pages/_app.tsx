import type { AppType } from "next/app";
import { Geist } from "next/font/google";
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
			<Background />
			<Toaster />
			<DuelNotifications />
			<Component {...pageProps} />
		</div>
	);
};

export default api.withTRPC(MyApp);
