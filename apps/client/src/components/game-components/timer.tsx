import { useTimer } from "react-timer-hook";
import { SlotTile } from "../tile";

type CountDownTimerProps = {
  expiryTimestamp?: number;
  timerTitle: string;
};

const ActiveCountDownTimer = ({
  expiryTimestamp,
  timerTitle,
}: { expiryTimestamp: number; timerTitle: string }) => {
  const { totalSeconds } = useTimer({
    autoStart: true,
    expiryTimestamp: new Date(expiryTimestamp),
  });

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
