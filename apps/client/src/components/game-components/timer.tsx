import { useEffect } from "react";
import { useTimer } from "react-timer-hook";
import { SlotTile } from "../tile";
import { useServerClockStore } from "@/state/server-clock-store";

type CountDownTimerProps = {
  expiryTimestamp?: number;
  timerTitle: string;
};

const ActiveCountDownTimer = ({
  expiryTimestamp,
  timerTitle,
}: { expiryTimestamp: number; timerTitle: string }) => {
  // Shift the server timestamp onto the client clock so react-timer-hook's
  // internal Date.now() comparison yields the correct remaining time.
  const offsetMs = useServerClockStore((state) => state.offsetMs);
  const clientExpiry = expiryTimestamp - offsetMs;

  const { totalSeconds, restart } = useTimer({
    autoStart: true,
    expiryTimestamp: new Date(clientExpiry),
  });

  useEffect(() => {
    restart(new Date(clientExpiry), true);
  }, [clientExpiry, restart]);

  return (
    <div className="flex flex-col gap-y-6 text-center font-semibold">
      <div className="flex flex-col items-center">
        <p className="text-lg">{timerTitle}</p>
        <SlotTile
          letters={`${Math.max(totalSeconds, 0).toString().padStart(2, "0")}`}
          tileClassName="aspect-square w-[7vh] bg-zinc-800 text-[6vh] text-white"
        />
      </div>
    </div>
  );
};

const CountDownTimer = ({
  expiryTimestamp,
  timerTitle,
}: CountDownTimerProps) => {
  if (
    typeof expiryTimestamp !== "number" ||
    !Number.isFinite(expiryTimestamp)
  ) {
    return <p>Waiting to start</p>;
  }

  return (
    <ActiveCountDownTimer
      expiryTimestamp={expiryTimestamp}
      timerTitle={timerTitle}
    />
  );
};

export default CountDownTimer;
