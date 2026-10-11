import { getGuessBonusMs } from "@/shared/battle-royale";
import { Timer } from "lucide-react";

type BonusPreviewProps = {
  currentWordGuesses?: number;
  /**
   * Whether the word the player is CURRENTLY guessing arrived as an attack word
   * (mirrors the server's `currentWordIsAttack`). Attack words grant NO life on
   * solve, so the preview shows +0s for them. A normal word shows the
   * guess-count-scaled bonus.
   */
  currentWordIsAttack?: boolean;
};

// Shows how much life the next correct guess will award, so it updates as the
// player makes more attempts on the current word. Solving an attack word grants
// no life (the server skips the bonus for attack words), so the preview reads
// +0s while the current word is an attack.
const BonusPreview: React.FC<BonusPreviewProps> = ({
  currentWordGuesses = 0,
  currentWordIsAttack = false,
}) => {
  const bonusMs = currentWordIsAttack ? 0 : getGuessBonusMs(currentWordGuesses);
  const bonusSeconds = Math.round(bonusMs / 1000);

  return (
    <p className="flex items-center text-center text-xs font-semibold text-emerald-600">
      <Timer />+{bonusSeconds}s
    </p>
  );
};

export default BonusPreview;
