"use client";

import Tile from "@/components/tile";
import { createClient } from "@/utils/supabase/client";
import type { NextPage } from "next/types";

const SignIn: NextPage = () => {
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
    <div className="grid place-content-center h-screen gap-8">
      <Tile word={"LOGIN"} revealed={true} variant="correct" size="lg" />
      <div className="flex flex-col gap-3">
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
      </div>
    </div>
  );
};

export default SignIn;
