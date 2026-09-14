import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Button from "../button";
import { FriendRow } from "../friends/friend-row";
import type { Friend } from "../friends/types";

interface NewDuelProps {
  friends: Friend[];
}

const MAX_PLAYERS = 5;

const NewDuel = ({ friends }: NewDuelProps) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [invitedFriends, setInvitedFriends] = useState<Friend[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredFriends = friends.filter((friend) => {
    const query = searchQuery.trim().toLowerCase();
    return (
      !query ||
      friend.name.toLowerCase().includes(query) ||
      friend.email.toLowerCase().includes(query)
    );
  });

  const handleSearchToggle = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery("");
      return;
    }

    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const addFriend = (friend: Friend) => {
    setInvitedFriends((current) =>
      current.length >= MAX_PLAYERS ||
      current.some((invited) => invited.id === friend.id)
        ? current
        : [...current, friend],
    );
  };

  const removeFriend = (friendId: string) => {
    setInvitedFriends((current) =>
      current.filter((friend) => friend.id !== friendId),
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 12 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">New Duel</h2>
        <div className="flex items-center gap-1.5">
          <motion.div
            initial={false}
            animate={{
              width: searchOpen ? 180 : 0,
              opacity: searchOpen ? 1 : 0,
            }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                }
              }}
              placeholder="search friends..."
              aria-label="Search friends"
              className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 bg-white/70 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400/60 focus:border-green-400 transition"
            />
          </motion.div>
          <Button
            onClick={handleSearchToggle}
            variant={searchOpen ? "selected" : "outline"}
            aria-label={searchOpen ? "Close friend search" : "Search friends"}
          >
            {searchOpen ? "X" : "Search"}
          </Button>
        </div>
      </div>
      <p className="mt-4 text-sm text-gray-600">
        Create a new duel to challenge a friend.
      </p>
      <AnimatePresence initial={false}>
        {invitedFriends.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 16 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              Invited players ({invitedFriends.length}/{MAX_PLAYERS})
            </p>
            <div className="flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {invitedFriends.map((friend) => (
                  <motion.div
                    key={friend.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1 rounded-full border border-green-200 bg-green-50 py-1 pl-2.5 pr-1 text-xs text-green-700"
                  >
                    <span className="max-w-32 truncate">{friend.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFriend(friend.id)}
                      aria-label={`Remove ${friend.name} from invite list`}
                      className="grid size-5 place-content-center rounded-full text-green-700 hover:bg-green-100"
                    >
                      X
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {invitedFriends.length >= MAX_PLAYERS && (
              <p className="mt-2 text-[11px] text-amber-600">
                You can invite up to {MAX_PLAYERS} players.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-4 max-h-64 overflow-y-auto pr-1">
        {filteredFriends.length > 0 ? (
          filteredFriends.map((friend) => (
            <FriendRow key={friend.id} friend={friend}>
              <Button
                type="button"
                variant="solid"
                onClick={() => addFriend(friend)}
                disabled={invitedFriends.some(
                  (invited) => invited.id === friend.id,
                ) || invitedFriends.length >= MAX_PLAYERS}
                aria-label={`Add ${friend.name} to invite list`}
                className="size-7 px-0 py-0 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </Button>
            </FriendRow>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-gray-500">
            {friends.length > 0
              ? "No friends match your search."
              : "No friends yet."}
          </p>
        )}
      </div>
    </motion.div>
  );
};

export default NewDuel;
