import { useRouter } from "next/router";
import GameCard from "./game-card";
import Link from "next/link";

const PlayButton = () => (
  <Link href="/duels">
    <button className="flex items-center gap-2 w-full justify-center bg-green-400 hover:bg-green-300 active:scale-95 transition-all rounded-md py-2 text-white text-xs font-bold uppercase tracking-widest">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-3 h-3"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      Play
    </button>
  </Link>
);
const DuelCard: React.FC = () => {
  const router = useRouter();

  return (
    <GameCard
      desc="Up to 5 opponents. Fewest guesses wins"
      title="Head to head"
      badge="1v1+"
      badgeVariant="gray"
      tiles={[
        { word: "D", variant: "correct" },
        { word: "U", variant: "present" },
        { word: "E", variant: "absent" },
        { word: "L", variant: "correct" },
      ]}
    >
      <PlayButton />
    </GameCard>
  );
};

export default DuelCard;
