"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

type WinnerProps = {
  children?: ReactNode;
};

const Winner = ({ children }: WinnerProps) => {
  const [Fireworks, setFireworks] = useState<ComponentType<any> | null>(null);

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
        {/* Semi-transparent overlay */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {/* Fireworks */}
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

        {/* Winner content */}
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <motion.div
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
            {children}
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default Winner;
