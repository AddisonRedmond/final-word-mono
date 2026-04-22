type OpponentHeaderProps = {
  initials?: string;
  correctGuessCount?: number;
};

const OpponentHeader: React.FC<OpponentHeaderProps> = ({
  initials = "N/A",
  correctGuessCount,
}) => {
  return (
    <div className="flex w-full justify-between text-sm">
      <p className="font-bold">{initials}</p>
      <div className="grid size-5 place-items-center rounded-full bg-zinc-500 text-white">
        <p>{correctGuessCount}</p>
      </div>
    </div>
  );
};

export default OpponentHeader;