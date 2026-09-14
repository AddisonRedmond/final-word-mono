import { motion } from "motion/react";
import type React from "react";
import type { Friend } from "./types";

export interface FriendRowProps {
  friend: Friend;
  children?: React.ReactNode;
}

export const FriendRow = ({ friend, children }: FriendRowProps) => {
  const initials = friend.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-stone-500/10 transition-colors"
    >
      <div className="size-8 rounded-md bg-amber-400 grid place-content-center text-xs font-bold text-white shrink-0 select-none">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">
          {friend.name}
        </p>
        <p className="text-[11px] text-gray-500 truncate">{friend.email}</p>
      </div>
      {children && <div className="flex gap-1.5 shrink-0">{children}</div>}
    </motion.div>
  );
};
