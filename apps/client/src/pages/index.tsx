import { useState } from "react";
import Head from "next/head";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import GameCard from "@/components/game-card";
import BattleRoyale from "@/components/game/battle-royale";

export default function Home() {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return <BattleRoyale onLeave={() => setPlaying(false)} />;
  }

  return (
    <>
      <Head>
        <title>Final Word</title>
        <meta content="Final Word — multiplayer word game" name="description" />
        <link href="/favicon.ico" rel="icon" />
      </Head>
      <main className="flex flex-col h-screen">
        <Navbar />
        <div className="flex flex-col grow items-center justify-center gap-y-5">
          <div className="flex flex-col items-center gap-y-2">
            <Tile revealed={true} size="lg" word="FINAL" variant="correct" />
            <Tile revealed={true} word="WORD" size="md" variant="present" />
          </div>
          <div>
            <GameCard
              title="Battle Royale"
              desc="100 players. One word. Last solver standing wins."
              badge="Live"
              badgeVariant="green"
              onPlay={() => setPlaying(true)}
              tiles={[
                { word: "B", variant: "correct" },
                { word: "A", variant: "present" },
                { word: "T", variant: "absent" },
                { word: "T", variant: "correct" },
                { word: "L", variant: "correct" },
                { word: "E", variant: "present" },
              ]}
            />
          </div>
        </div>
      </main>
    </>
  );
}
