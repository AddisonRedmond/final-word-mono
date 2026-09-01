"use client";

import { memo, useEffect, useRef } from "react";

type OpponentTimerProps = {
  duration: number;
  expiryTimestamp: number;
  initials: string;
};

type Timer = {
  bar: HTMLDivElement;
  duration: number;
  expiryTimestamp: number;
};

const timers = new Map<HTMLDivElement, Timer>();

let animationFrameId: number | null = null;

const updateTimers = () => {
  const now = Date.now();

  for (const timer of timers.values()) {
    const remaining = Math.max(0, timer.expiryTimestamp - now);

    const progress = Math.max(0, Math.min(1, remaining / timer.duration));

    timer.bar.style.width = `${progress * 100}%`;
  }

  if (timers.size > 0) {
    animationFrameId = requestAnimationFrame(updateTimers);
  } else {
    animationFrameId = null;
  }
};

const startTimerLoop = () => {
  if (animationFrameId !== null) return;

  animationFrameId = requestAnimationFrame(updateTimers);
};

const OpponentTimer = memo(
  ({ duration, expiryTimestamp, initials }: OpponentTimerProps) => {
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const bar = barRef.current;

      if (!bar) return;

      const timer: Timer = { bar, duration, expiryTimestamp };

      timers.set(bar, timer);

      startTimerLoop();

      return () => {
        timers.delete(bar);

        if (timers.size === 0 && animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      };
    }, [duration, expiryTimestamp]);

    return (
      <div className="flex w-full items-center gap-x-1">
        <span className="text-[9px] font-semibold leading-none">
          {initials}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200">
          <div
            ref={barRef}
            className="h-full rounded-full bg-zinc-700"
            style={{ width: "100%" }}
          />
        </div>
      </div>
    );
  },
);

OpponentTimer.displayName = "OpponentTimer";

export default OpponentTimer;
