"use client";

import { memo, type RefObject, useEffect, useRef } from "react";
import { getServerNow } from "@/state/server-clock-store";

type OpponentTimerProps = {
  duration: number;
  expiryTimestamp: number;
  /**
   * The card's initials chip, rendered by the card (it sits above the current
   * word, away from this bar). The bar's rAF loop tints it with the same
   * low/critical colour, so the two always agree without re-rendering React.
   */
  chipRef?: RefObject<HTMLElement | null>;
};

type Timer = {
  bar: HTMLDivElement;
  chip?: HTMLElement;
  duration: number;
  expiryTimestamp: number;
  /** Last colour level applied, so the style is only touched when it changes. */
  level?: "ok" | "low" | "critical";
};

// Bar colour as life drains: lime (default class) -> sun -> hot.
const LOW_THRESHOLD = 0.33;
const CRITICAL_THRESHOLD = 0.15;

const timers = new Map<HTMLDivElement, Timer>();

let animationFrameId: number | null = null;

const updateTimers = () => {
  // expiryTimestamp is a server-clock value, so compare against server-now.
  const now = getServerNow();

  for (const timer of timers.values()) {
    const remaining = Math.max(0, timer.expiryTimestamp - now);

    const progress = Math.max(0, Math.min(1, remaining / timer.duration));

    timer.bar.style.width = `${progress * 100}%`;

    const level =
      progress <= CRITICAL_THRESHOLD
        ? "critical"
        : progress <= LOW_THRESHOLD
          ? "low"
          : "ok";
    if (level !== timer.level) {
      timer.level = level;
      const warn =
        level === "critical"
          ? "var(--color-hot)"
          : level === "low"
            ? "var(--color-sun)"
            : "";
      timer.bar.style.backgroundColor = warn;
      // The initials chip warms with the bar, so a low card reads at a glance.
      if (timer.chip) {
        timer.chip.style.backgroundColor = warn;
        timer.chip.style.color = warn ? "var(--color-ink)" : "";
      }
    }
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
  ({ duration, expiryTimestamp, chipRef }: OpponentTimerProps) => {
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const bar = barRef.current;

      if (!bar) return;

      const timer: Timer = {
        bar,
        chip: chipRef?.current ?? undefined,
        duration,
        expiryTimestamp,
      };

      timers.set(bar, timer);

      startTimerLoop();

      return () => {
        timers.delete(bar);

        if (timers.size === 0 && animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      };
    }, [duration, expiryTimestamp, chipRef]);

    // The life bar on its own: the card uses it as the divider between the
    // word being guessed and the queued attack words. Fixed 4px tall; the
    // card-height math in utils/opponents.ts assumes it.
    return (
      <div
        aria-hidden="true"
        className="h-1 w-full shrink-0 overflow-hidden rounded-full bg-white/10"
      >
        <div
          ref={barRef}
          className="h-full rounded-full bg-lime"
          style={{ width: "100%" }}
        />
      </div>
    );
  },
);

OpponentTimer.displayName = "OpponentTimer";

export default OpponentTimer;
