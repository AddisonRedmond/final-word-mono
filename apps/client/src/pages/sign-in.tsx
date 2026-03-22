"use client";

import Tile from "@/components/tile";
import { handleGithubSignIn } from "@/firebase/client";
import type { NextPage } from "next/types";
import { useRouter } from "next/router";

const SignIn: NextPage = () => {
  const router = useRouter();

  const handleSignIn = async () => {
    const user = await handleGithubSignIn();
    if (user) {
      router.push("/");
    }
  };

  return (
    <div className="grid place-content-center h-screen">
      <Tile word={"LOGIN"} revealed={true} variant="correct" size="lg" />
      <button onClick={handleSignIn}>Sign in with GitHub</button>
    </div>
  );
};

export default SignIn;
