import { ATTACK_WORD_BONUS_MS, getGuessBonusMs } from "@/shared/battle-royale";

type BonusPreviewProps = {
  currentWordGuesses?: number;
  hasQueuedAttack: boolean;
};

// Shows how much life the next correct guess will award, so it updates as
// the player makes more attempts on the current word (or has an attack word
// queued, which grants a flat bonus instead).
const BonusPreview: React.FC<BonusPreviewProps> = ({
  currentWordGuesses = 0,
  hasQueuedAttack,
}) => {
  const bonusMs = hasQueuedAttack
    ? ATTACK_WORD_BONUS_MS
    : getGuessBonusMs(currentWordGuesses);
  const bonusSeconds = Math.round(bonusMs / 1000);

  return (
    <p className="text-center text-xs font-semibold text-emerald-600">
      +{bonusSeconds}s on correct guess
    </p>
  );
};

export default BonusPreview;
