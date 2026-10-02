import GameCard from "../game-card";
import BattleRoyaleRules from "../game-components/battle-royale-rules";

type BattleRoyalCardProps = {
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

const BattleRoyalCard: React.FC<BattleRoyalCardProps> = ({ handlePlay }) => {
	return (
		<GameCard
			badge="Live"
			badgeVariant="green"
			desc="100 players. Last solver standing wins."
			tiles={[
				{ word: "B", variant: "correct" },
				{ word: "A", variant: "present" },
				{ word: "T", variant: "absent" },
				{ word: "T", variant: "correct" },
				{ word: "L", variant: "correct" },
				{ word: "E", variant: "present" },
			]}
			title="Battle Royale"
		>
			<PlayButton onPlay={handlePlay} />
			<BattleRoyaleRules />
		</GameCard>
	);
};
export default BattleRoyalCard;
