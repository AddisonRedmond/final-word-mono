import type { AppType } from "next/app";
import { Geist } from "next/font/google";
import { api } from "@/utils/api";
import "@/styles/globals.css";
import Background from "@/components/background/background";
import { useAuthStore } from "@/state/useAuthStore";
import { useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "@/firebase/client";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser({ ...firebaseUser, customClaims: {} });
      } else {
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, [setUser]);

  return (
    <div className={geist.className}>
      <Background />
      <Component {...pageProps} />
    </div>
  );
};

export default api.withTRPC(MyApp);
