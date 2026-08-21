import { useEffect } from "react";
import { useTimer } from "react-timer-hook";

type HealthProps = {
  expiryTimestamp?: number;
};

const MAX_HEALTH_SECONDS = 3 * 60;

const Health: React.FC<HealthProps> = ({ expiryTimestamp }) => {
  const hasExpiryTimestamp =
    typeof expiryTimestamp === "number" && Number.isFinite(expiryTimestamp);
  const { totalSeconds, restart } = useTimer({
    autoStart: hasExpiryTimestamp,
    expiryTimestamp: new Date(hasExpiryTimestamp ? expiryTimestamp : Date.now()),
  });

  useEffect(() => {
    if (!hasExpiryTimestamp) {
      return;
    }

    restart(new Date(expiryTimestamp), true);
  }, [expiryTimestamp, hasExpiryTimestamp, restart]);

  const remainingSeconds = Math.max(totalSeconds, 0);
  const healthPercent = Math.min(
    (remainingSeconds / MAX_HEALTH_SECONDS) * 100,
    100,
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div className="w-full" aria-label="Player health timer">
      <div className="mb-1 text-center text-xs font-semibold tabular-nums">
        {hasExpiryTimestamp
          ? `${minutes}:${seconds.toString().padStart(2, "0")}`
          : "Waiting"}
      </div>
      <div className="w-full rounded-full bg-zinc-200/70 p-0.5">
        <div
          className="h-2 rounded-full bg-emerald-400  duration-1000 ease-linear"
          style={{ width: `${hasExpiryTimestamp ? healthPercent : 0}%` }}
        />
      </div>
    </div>
  );
};

export default Health;
