import GameCard from "../game-card";
import BattleRoyaleRules from "../game-components/battle-royale-rules";
import Key from "./key";

type BattleRoyalCardProps = {
	// Optional share code: Play starts a normal public game (no code); the Join
	// Game panel calls this WITH a code to land in a friend's room.
	handlePlay: (code?: string) => void;
};

const PlayButton: React.FC<{ onPlay: () => void }> = ({ onPlay }) => {
	return (
		<button
			className="keycap cursor-pointer flex w-full items-center justify-center gap-2 rounded-xl bg-lime py-2.5 font-display text-ink text-xs uppercase tracking-widest [--keycap-edge:var(--color-lime-edge)] hover:bg-green-300"
			// Wrap so the click event isn't forwarded as the `code` argument.
			onClick={() => onPlay()}
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
			accent="hot"
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
			rules={({ isOpen, setIsOpen }) => (
				<BattleRoyaleRules isOpen={isOpen} setIsOpen={setIsOpen} />
			)}
		>
			<PlayButton onPlay={handlePlay} />
			<Key onJoin={(code) => handlePlay(code)} />
		</GameCard>
	);
};
export default BattleRoyalCard;
