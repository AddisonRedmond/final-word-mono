import { useRef } from "react";
import { motion } from "motion/react";
import Button from "../button";
import { TABS, type FilterTab } from "./types";

interface FriendsTabBarProps {
  activeTab: FilterTab;
  onTabChange: (tab: FilterTab) => void;
  pendingCount: number;
  searchOpen: boolean;
  searchQuery: string;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSearchChange: (value: string) => void;
}

export const FriendsTabBar = ({
  activeTab,
  onTabChange,
  pendingCount,
  searchOpen,
  searchQuery,
  onSearchOpen,
  onSearchClose,
  onSearchChange,
}: FriendsTabBarProps) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchToggle = () => {
    if (searchOpen) {
      onSearchClose();
    } else {
      onSearchOpen();
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="flex items-center gap-1.5 p-3 border-b border-gray-200/60">
      {TABS.map(({ key, label }) => {
        const isActive = activeTab === key;
        const showBadge = key === "pending" && pendingCount > 0;
        return (
          <Button
            key={key}
            onClick={() => onTabChange(key)}
            variant={isActive ? "solid" : "outline"}
          >
            {label}
            {showBadge && (
              <span className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-amber-400 grid place-content-center text-[9px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </Button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="flex items-center gap-1.5">
        <motion.div
          initial={false}
          animate={{ width: searchOpen ? 140 : 0, opacity: searchOpen ? 1 : 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="overflow-hidden"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onSearchClose()}
            placeholder="search by email…"
            className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 bg-white/70 backdrop-blur-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400/60 focus:border-green-400 transition"
          />
        </motion.div>

        <Button
          onClick={handleSearchToggle}
          variant={searchOpen ? "selected" : "outline"}
          aria-label={searchOpen ? "Close search" : "Open search"}
        >
          {searchOpen ? "✕" : "Search"}
        </Button>
      </div>
    </div>
  );
};
