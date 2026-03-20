import type { AppType } from "next/app";
import { Geist } from "next/font/google";
import { api } from "@/utils/api";
import "@/styles/globals.css";
import Background from "@/components/background/background";
import { AuthProvider } from "@/contexts/auth";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  return (
    <div className={geist.className}>
      <Background />
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    </div>
  );
};

export default api.withTRPC(MyApp);
