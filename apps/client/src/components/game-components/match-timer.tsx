import { useEffect } from "react";
import { useTimer } from "react-timer-hook";

type MatchTimerProps = {
  expiryTimestamp?: number;
};

const MatchTimer: React.FC<MatchTimerProps> = ({ expiryTimestamp }) => {
  const hasExpiryTimestamp =
    typeof expiryTimestamp === "number" && Number.isFinite(expiryTimestamp);

  const { totalSeconds, restart } = useTimer({
    autoStart: hasExpiryTimestamp,
    expiryTimestamp: new Date(
      hasExpiryTimestamp ? expiryTimestamp : Date.now(),
    ),
  });

  useEffect(() => {
    if (!hasExpiryTimestamp) {
      return;
    }

    restart(new Date(expiryTimestamp), true);
  }, [expiryTimestamp, hasExpiryTimestamp, restart]);

  if (!hasExpiryTimestamp) {
    return null;
  }

  const remainingSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div
      className="text-center text-xs font-semibold tabular-nums"
      aria-label="Match timer"
    >
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">
        Match Ends In
      </p>
      <p>
        {minutes}:{seconds.toString().padStart(2, "0")}
      </p>
    </div>
  );
};

export default MatchTimer;
