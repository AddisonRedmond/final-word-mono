import { motion } from "motion/react";

interface TileProps {
  word: string;
  revealed?: boolean;
  guess?: string | string[];
  variant?: "default" | "correct" | "present" | "absent";
  size?: "sm" | "md" | "lg";
}

const Tile: React.FC<TileProps> = ({
  word,
  revealed = false,
  guess,
  variant = "default",
  size = "md",
}) => {
  const guesses = Array.isArray(guess)
    ? guess
    : word.split("").map(() => guess || "");

  // Map variant to classes
  const variantClasses = {
    default: "bg-amber-50 text-stone-800 border border-amber-200/60",
    correct: "bg-emerald-500 text-white border border-emerald-600",
    present: "bg-amber-400 text-white border border-amber-500",
    absent: "bg-stone-400 text-white border border-stone-500",
  };

  // Map size to classes
  const sizeClasses = {
    sm: "h-10 w-10 text-lg",
    md: "h-14 w-14 text-2xl",
    lg: "h-20 w-20 text-4xl",
  };

  return (
    <div className="flex gap-2">
      {word.split("").map((letter, index) => {
        const isFlipped =
          revealed || guesses[index]?.toUpperCase() === letter.toUpperCase();

        return (
          <div key={index} className=" perspective-[1000px]">
            <motion.div
              initial={revealed ? { rotateY: 180 } : undefined}
              animate={{ rotateY: isFlipped ? 0 : 180 }}
              transition={{
                duration: 0.45,
                ease: "easeInOut",
                delay: revealed ? index * 0.08 : 0,
              }}
              className="relative w-full h-full"
              style={{ transformStyle: "preserve-3d" }}
            >
              {/* FRONT: revealed letter */}
              <div
                className={`relative flex items-center justify-center rounded-lg font-bold uppercase select-none transition-all duration-200
                  shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.1)]
                  hover:scale-105 hover:shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.15),0_4px_12px_rgba(0,0,0,0.15)]
                  ${variantClasses[variant]} ${sizeClasses[size]}`}
              >
                <p className="text-xl font-semibold text-white tracking-wider">
                  {letter}
                </p>
              </div>

              {/* BACK: blank */}
              <div className="absolute inset-0 grid place-content-center rounded-md bg-gray-100 border border-gray-300 transform-[rotateY(180deg)] backface-hidden"></div>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
};

export default Tile;
