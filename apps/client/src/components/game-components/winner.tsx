"use client";

import { useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FireworksProps } from "@fireworks-js/react";
import type { PlayerDisplay } from "@/types/battle-royale.types";

type WinnerProps = {
  userData: PlayerDisplay;
  gameStartTimestamp: number;
  handleLeave: () => void;
};

const formatDuration = (duration: number) => {
  const totalSeconds = Math.min(
    10 * 60,
    Math.max(0, Math.floor(duration / 1000)),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const Winner = ({ userData, gameStartTimestamp, handleLeave }: WinnerProps) => {
  const [Fireworks, setFireworks] =
    useState<ComponentType<FireworksProps> | null>(null);
  const survivalTime = formatDuration(userData.life - gameStartTimestamp);

  useEffect(() => {
    let mounted = true;

    const loadFireworks = async () => {
      const { Fireworks } = await import("@fireworks-js/react");

      if (mounted) {
        setFireworks(() => Fireworks);
      }
    };

    loadFireworks();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 h-screen w-screen overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        <div className="absolute inset-0 h-full w-full">
          {Fireworks && (
            <Fireworks
              className="absolute inset-0 h-full w-full"
              options={{
                autoresize: true,
                opacity: 0.5,
                acceleration: 1.05,
                friction: 0.97,
                gravity: 1.5,
                particles: 50,
                traceLength: 3,
                traceSpeed: 10,
                explosion: 5,
                intensity: 30,
                flickering: 50,
                hue: {
                  min: 0,
                  max: 360,
                },
                delay: {
                  min: 30,
                  max: 60,
                },
                rocketsPoint: {
                  min: 25,
                  max: 75,
                },
              }}
            />
          )}
        </div>

        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <motion.div
            className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-yellow-200/70 bg-zinc-950/90 text-white shadow-2xl"
            initial={{
              scale: 0.8,
              opacity: 0,
            }}
            animate={{
              scale: 1,
              opacity: 1,
            }}
            transition={{
              delay: 0.15,
              duration: 0.5,
              type: "spring",
              stiffness: 180,
              damping: 15,
            }}
          >
            <div className="border-b border-white/15 bg-yellow-300 px-6 py-3 text-center text-sm font-black tracking-[0.2em] text-zinc-950">
              VICTORY
            </div>
            <div className="px-6 py-7 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-400">
                You had the FINAL WORD
              </p>
              <h2 className="mt-2 wrap-break-word text-4xl font-black tracking-wide text-yellow-300">
                {userData.name}
              </h2>
              <div className="mt-7 grid grid-cols-3 divide-x divide-white/15 border-y border-white/15 py-4">
                <div className="px-2">
                  <p className="text-xl font-bold tabular-nums">
                    {survivalTime}
                  </p>
                  <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-400">
                    Survived
                  </p>
                </div>
                <div className="px-2">
                  <p className="text-xl font-bold tabular-nums">
                    {userData.totalGuesses}
                  </p>
                  <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-400">
                    Guesses
                  </p>
                </div>
                <div className="px-2">
                  <p className="text-xl font-bold tabular-nums text-emerald-300">
                    {userData.correctGuesses}
                  </p>
                  <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-400">
                    Correct
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLeave}
                className="mt-7 w-full rounded-md bg-yellow-300 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-zinc-950 transition-colors hover:bg-yellow-200"
              >
                Leave
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default Winner;
