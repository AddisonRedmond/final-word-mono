import type { PlayerDisplay } from "@/types/game";

type PlayerStats = { playerdata: PlayerDisplay };

const Eliminated: React.FC<PlayerStats> = ({ playerdata }) => {
  // show total guesses, total time, placment,

  return (
    <div>
      <p>You've been eliminated!</p>
    </div>
  );
};

export default Eliminated;
