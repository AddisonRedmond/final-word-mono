import GameCard from "../game-card";

type BattleRoyalCardProps = {
  handlePlay: () => void;
};

const PlayButton: React.FC<{ onPlay: () => void }> = ({ onPlay }) => {
  return (
    <button
      onClick={onPlay}
      className="flex items-center gap-2 w-full justify-center bg-green-400 hover:bg-green-300 active:scale-95 transition-all rounded-md py-2 text-white text-xs font-bold uppercase tracking-widest"
    >
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
  );
};

const BattleRoyalCard: React.FC<BattleRoyalCardProps> = ({ handlePlay }) => {
  return (
    <GameCard
      title="Battle Royale"
      desc="100 players. Last solver standing wins."
      badge="Live"
      badgeVariant="green"
      tiles={[
        { word: "B", variant: "correct" },
        { word: "A", variant: "present" },
        { word: "T", variant: "absent" },
        { word: "T", variant: "correct" },
        { word: "L", variant: "correct" },
        { word: "E", variant: "present" },
      ]}
    >
      <PlayButton onPlay={handlePlay} />
    </GameCard>
  );
};
export default BattleRoyalCard;
