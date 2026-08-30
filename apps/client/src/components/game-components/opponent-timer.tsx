"use client";

import { memo, useEffect, useRef } from "react";

type CircularTimerProps = {
  duration: number;
  expiryTimestamp: number;
  initials: string;
};

type Timer = {
  circle: SVGCircleElement;
  duration: number;
  expiryTimestamp: number;
  circumference: number;
};

const timers = new Map<SVGCircleElement, Timer>();

let animationFrameId: number | null = null;

const updateTimers = () => {
  const now = Date.now();

  for (const timer of timers.values()) {
    const remaining = Math.max(0, timer.expiryTimestamp - now);

    const progress = Math.max(
      0,
      Math.min(1, remaining / timer.duration),
    );

    timer.circle.style.strokeDashoffset = String(
      timer.circumference * (1 - progress),
    );
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

const CircularTimer = memo(
  ({ duration, expiryTimestamp, initials }: CircularTimerProps) => {
    const progressRef = useRef<SVGCircleElement>(null);

    const radius = 45;
    const circumference = 2 * Math.PI * radius;

    useEffect(() => {
      const circle = progressRef.current;

      if (!circle) return;

      const timer: Timer = {
        circle,
        duration,
        expiryTimestamp,
        circumference,
      };

      timers.set(circle, timer);

      startTimerLoop();

      return () => {
        timers.delete(circle);

        if (timers.size === 0 && animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      };
    }, [circumference, duration, expiryTimestamp]);

    return (
      <div className="relative aspect-square w-full">
        <svg
          className="absolute inset-0 size-full -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-zinc-200"
          />

          <circle
            ref={progressRef}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            className="text-zinc-700"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold">{initials}</span>
        </div>
      </div>
    );
  },
);

CircularTimer.displayName = "CircularTimer";

export default CircularTimer;