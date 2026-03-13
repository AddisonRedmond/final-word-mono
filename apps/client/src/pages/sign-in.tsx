import Tile from "@/components/tile";
import type { NextPage } from "next/types";

const SignIn: NextPage = () => {
  return (
    <div className="grid place-content-center h-screen">
      <Tile word={"LOGIN"} revealed={true} variant="correct" size="lg" />
    </div>
  );
};

export default SignIn;
