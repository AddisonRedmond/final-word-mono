"use client";

import { motion, AnimatePresence } from "motion/react";
import type { PlayerDisplay } from "@/types/battle-royale.types";

type EliminatedProps = {
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

const Eliminated = ({
  userData,
  gameStartTimestamp,
  handleLeave,
}: EliminatedProps) => {
  const survivalTime = formatDuration(userData.life - gameStartTimestamp);

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

        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <motion.div
            className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-red-500/70 bg-zinc-950/90 text-white shadow-2xl"
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
            <div className="border-b border-white/15 bg-red-500 px-6 py-3 text-center text-sm font-black tracking-[0.2em] text-zinc-950">
              ELIMINATED
            </div>
            <div className="px-6 py-7 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-400">
                Better luck next time
              </p>
              <h2 className="mt-2 wrap-break-word text-4xl font-black tracking-wide text-red-400">
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
                className="mt-7 w-full rounded-md bg-red-500 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-zinc-950 transition-colors hover:bg-red-400"
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

export default Eliminated;
