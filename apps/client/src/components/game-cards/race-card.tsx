import GameCard from "../game-card";
import RaceRules from "../game-components/race-rules";

type RaceCardProps = {
  handlePlay: () => void;
};

const PlayButton: React.FC<{ onPlay: () => void }> = ({ onPlay }) => {
  return (
    <button
      className="cursor-pointer flex w-full items-center justify-center gap-2 rounded-md bg-green-400 py-2 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-green-300 active:scale-95"
      onClick={onPlay}
    >
      <svg
        className="h-3 w-3"
        fill="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      Play
    </button>
  );
};

const RaceCard: React.FC<RaceCardProps> = ({ handlePlay }) => {
  return (
    <GameCard
      badge="New"
      badgeVariant="yellow"
      desc="Survive each round. Last solver standing wins."
      tiles={[
        { word: "R", variant: "correct" },
        { word: "A", variant: "present" },
        { word: "C", variant: "absent" },
        { word: "E", variant: "correct" },
        { word: "R", variant: "present" },
      ]}
      title="Elimination Race"
    >
      <PlayButton onPlay={handlePlay} />
      <RaceRules />
    </GameCard>
  );
};
export default RaceCard;
