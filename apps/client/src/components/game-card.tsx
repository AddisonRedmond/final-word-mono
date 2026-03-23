import Tile from "@/components/tile";

type GameCardProps = {
  desc: string;
  title: string;
  badge?: string;
  badgeVariant?: "green" | "yellow" | "gray";
  tiles?: {
    word: string;
    variant: "correct" | "present" | "absent" | "default";
  }[];
  onPlay?: () => void;
};

const GameCard: React.FC<GameCardProps> = ({
  desc,
  title,
  badge,
  badgeVariant = "green",
  tiles,
  onPlay,
}) => {
  const badgeColors = {
    green: "bg-green-400",
    yellow: "bg-yellow-400",
    gray: "bg-gray-400",
  };

  return (
    <div className="shadow-xl relative bg-stone-500/10 backdrop-blur-lg rounded-lg p-5 font-mono cursor-pointer transition-all hover:border-green-400 active:scale-[0.98]">
      {tiles && (
        <div className="flex gap-1.5 mb-3.5">
          {tiles.map((tile, i) => (
            <Tile
              key={i}
              word={tile.word}
              variant={tile.variant}
              revealed
              size="sm"
            />
          ))}
        </div>
      )}

      {badge && (
        <span
          className={`absolute -top-1 -right-1 ${badgeColors[badgeVariant]} text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-widest`}
        >
          {badge}
        </span>
      )}

      <h2 className="text-lg uppercase tracking-wide m-0 mb-1.5">{title}</h2>
      <p className="text-gray-400 text-[11px] leading-relaxed m-0 mb-4">
        {desc}
      </p>

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
    </div>
  );
};

export default GameCard;
