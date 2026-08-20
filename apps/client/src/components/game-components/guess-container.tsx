import { AnimatePresence, motion } from "motion/react";
import { Glass, RoundedRect, Shader } from "shaders/react";

type TileVariant = "default" | "correct" | "present" | "absent";

const variantClasses: Record<TileVariant, string> = {
  default: "bg-amber-50 text-stone-800 border border-amber-200/60",
  correct: "bg-emerald-500 text-white border border-emerald-600",
  present: "bg-amber-400 text-white border border-amber-500",
  absent: "bg-stone-400 text-white border border-stone-500",
};

const HopperQueue = () => {
  return <div></div>;
};

const GuessLetter: React.FC<{
  letter?: string;
  variant?: TileVariant;
}> = ({ letter, variant = "default" }) => {
  return (
    <div
      className={`grid size-14 place-content-center rounded-md ${variantClasses[variant]}`}
    >
      <AnimatePresence>
        {letter && (
          <motion.p
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
          >
            {letter}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};

const GuessContainer = () => {
  return (
    <div>
      {/* maybe apply glass shader to this */}
      <div className="relative isolate overflow-hidden rounded-md">
        <Shader
          colorSpace="srgb"
          toneMapping="neutral"
          className="absolute inset-0 z-0 size-full"
        >
          <Glass
            refraction={0.8}
            edgeSoftness={0.2}
            thickness={0.25}
            aberration={0.2}
            fresnel={0.15}
            highlight={0.1}
          >
            <RoundedRect center={{ x: 0.5, y: 0.5 }} />
          </Glass>
        </Shader>

        <div className="relative z-10 flex items-center justify-evenly gap-x-1 border border-white/20 bg-white/10 p-2 text-xl font-bold backdrop-blur-sm">
          <GuessLetter letter="T" variant="default" />
          <GuessLetter />
          <GuessLetter />
          <GuessLetter />
          <GuessLetter />
        </div>
      </div>
    </div>
  );
};

export default GuessContainer;
