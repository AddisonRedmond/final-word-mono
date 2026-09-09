import { motion } from "motion/react";
import type { Friend } from "./types";

export interface FriendRowProps {
  friend: Friend;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCancel?: (id: string) => void;
}

export const FriendRow = ({
  friend,
  onAccept,
  onDecline,
  onRemove,
  onCancel,
}: FriendRowProps) => {
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
      <div className="flex gap-1.5 shrink-0">
        {friend.status === "accepted" && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(friend.id)}
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
          >
            Remove
          </button>
        )}
        {friend.status === "pending_incoming" && (
          <>
            {onAccept && (
              <button
                type="button"
                onClick={() => onAccept(friend.id)}
                className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded bg-green-400 text-white hover:bg-green-300 transition-colors"
              >
                Accept
              </button>
            )}
            {onDecline && (
              <button
                type="button"
                onClick={() => onDecline(friend.id)}
                className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
              >
                Decline
              </button>
            )}
          </>
        )}
        {friend.status === "pending_outgoing" && onCancel && (
          <button
            type="button"
            onClick={() => onCancel(friend.id)}
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </motion.div>
  );
};
