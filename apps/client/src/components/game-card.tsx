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
};

const GameCard: React.FC<GameCardProps> = ({
  desc,
  title,
  badge,
  badgeVariant = "green",
  tiles,
}) => {
  const badgeColors = {
    green: "bg-green-400",
    yellow: "bg-yellow-400",
    gray: "bg-gray-400",
  };

  return (
    <div className="relative bg-stone-500/10 backdrop-blur-lg rounded-lg p-5 font-mono cursor-pointer transition-all hover:border-green-400  active:scale-[0.98]">
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
          className={`absolute top-3 right-3 ${badgeColors[badgeVariant]} text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-widest`}
        >
          {badge}
        </span>
      )}

      <h2 className="text-white text-lg uppercase tracking-wide m-0 mb-1.5">
        {title}
      </h2>
      <p className="text-gray-400 text-[11px] leading-relaxed m-0">{desc}</p>
    </div>
  );
};

export default GameCard;
