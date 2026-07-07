"use client";

import Tile from "@/components/tile";
import type { NextPage } from "next/types";
import { useRouter } from "next/router";

const SignIn: NextPage = () => {
  const router = useRouter();

  return (
    <div className="grid place-content-center h-screen">
      <Tile word={"LOGIN"} revealed={true} variant="correct" size="lg" />
    </div>
  );
};

export default SignIn;
