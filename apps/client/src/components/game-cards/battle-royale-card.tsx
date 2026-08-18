import GameCard from "../game-card";


type BattleRoyalCardProps = {
  handlePlay: () =>void
}
const BattleRoyalCard:React.FC<BattleRoyalCardProps> = ({handlePlay}) => {
  return (
    <GameCard
      title="Battle Royale"
      desc="100 players. One word. Last solver standing wins."
      badge="Live"
      badgeVariant="green"
      onPlay={handlePlay}
      tiles={[
        { word: "B", variant: "correct" },
        { word: "A", variant: "present" },
        { word: "T", variant: "absent" },
        { word: "T", variant: "correct" },
        { word: "L", variant: "correct" },
        { word: "E", variant: "present" },
      ]}
    />
  );
};
 export default BattleRoyalCard