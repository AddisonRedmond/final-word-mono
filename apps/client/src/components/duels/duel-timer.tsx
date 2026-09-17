import { useStopwatch } from "react-timer-hook";
import { Timer } from "lucide-react";

interface DuelTimerProps {
  /** The timestamp when this participant started the duel */
  startTime: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

const DuelTimer: React.FC<DuelTimerProps> = ({ startTime }) => {
  // Calculate how many seconds have already elapsed so the stopwatch
  // starts from the correct offset rather than zero
  const offsetSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const offsetTimestamp = new Date();
  offsetTimestamp.setSeconds(offsetTimestamp.getSeconds() + offsetSeconds);

  const { seconds, minutes, hours } = useStopwatch({
    autoStart: true,
    offsetTimestamp,
  });

  return (
    <div
      className="flex items-center justify-center gap-1 rounded-md px-3 py-1.5 font-mono text-sm font-bold tabular-nums bg-white/10 "
      aria-label={`Elapsed time: ${hours ? `${hours} hours ` : ""}${minutes} minutes ${seconds} seconds`}
      aria-live="off"
    >
      <Timer className="size-3.5 shrink-0" aria-hidden="true" />
      {hours > 0 && <>{pad(hours)}:</>}
      {pad(minutes)}:{pad(seconds)}
    </div>
  );
};

export default DuelTimer;
