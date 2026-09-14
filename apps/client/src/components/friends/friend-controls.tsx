import type { Friend } from "./types";

interface FriendControlsProps {
  friend: Friend;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCancel?: (id: string) => void;
}

export const FriendControls = ({
  friend,
  onAccept,
  onDecline,
  onRemove,
  onCancel,
}: FriendControlsProps) => {
  return (
    <>
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
    </>
  );
};