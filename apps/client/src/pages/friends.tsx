"use client";

import Head from "next/head";
import Navbar from "@/components/navigation/navbar";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { type Friend, type FilterTab } from "@/components/friends/types";
import {
  SectionHeading,
  EmptyState,
} from "@/components/friends/section-heading";
import { FriendRow } from "@/components/friends/friend-row";
import { AddFriendForm } from "@/components/friends/add-friend-form";
import { FriendsTabBar } from "@/components/friends/friends-tab-bar";
import Tile from "@/components/tile";
import { api } from "@/utils/api";

const MOCK_FRIENDS: Friend[] = [
  { id: "1", name: "Alice", email: "alice@example.com", status: "accepted" },
  { id: "2", name: "Bob", email: "bob@example.com", status: "accepted" },
  {
    id: "3",
    name: "Charlie",
    email: "charlie@example.com",
    status: "pending_incoming",
  },
  {
    id: "4",
    name: "Diana",
    email: "diana@example.com",
    status: "pending_outgoing",
  },
];

const Friends: React.FC = () => {
  const friendsTest = api.friends.list.useQuery();
  const [friends, setFriends] = useState<Friend[]>(MOCK_FRIENDS);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const accepted = friends.filter((f) => f.status === "accepted");
  const incoming = friends.filter((f) => f.status === "pending_incoming");
  const outgoing = friends.filter((f) => f.status === "pending_outgoing");
  const pendingCount = incoming.length + outgoing.length;

  const showFriends = activeTab === "all" || activeTab === "friends";
  const showPending = activeTab === "all" || activeTab === "pending";

  const filterByEmail = (list: Friend[]) =>
    searchQuery.trim()
      ? list.filter((f) =>
          f.email.toLowerCase().includes(searchQuery.trim().toLowerCase()),
        )
      : list;

  const filteredAccepted = filterByEmail(accepted);
  const filteredIncoming = filterByEmail(incoming);
  const filteredOutgoing = filterByEmail(outgoing);

  const handleAddFriend = (friend: Friend) =>
    setFriends((prev) => [...prev, friend]);

  const handleAccept = (id: string) =>
    setFriends((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "accepted" } : f)),
    );

  const handleDecline = (id: string) =>
    setFriends((prev) => prev.filter((f) => f.id !== id));

  const handleRemove = (id: string) =>
    setFriends((prev) => prev.filter((f) => f.id !== id));

  const handleCancel = (id: string) =>
    setFriends((prev) => prev.filter((f) => f.id !== id));

  return (
    <>
      <Head>
        <title>Friends · Final Word</title>
      </Head>
      <main className="flex flex-col h-screen">
        <Navbar />

        <div className="flex min-h-0 flex-col grow items-center justify-start pt-10 px-4 pb-6 gap-y-5">
          {/* Page title */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="flex gap-1"
          >
            {"FRIENDS".split("").map((letter, i) => {
              const variants = ["correct", "present", "absent"] as const;
              const variant = variants[i % variants.length]!;

              return (
                <Tile
                  size="sm"
                  key={i}
                  revealed={true}
                  variant={variant}
                  word={letter}
                />
              );
            })}
          </motion.div>

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="w-full max-w-md bg-stone-500/10 backdrop-blur-lg rounded-lg shadow-xl font-mono flex flex-col min-h-0 overflow-hidden"
          >
            <FriendsTabBar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              pendingCount={pendingCount}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              onSearchOpen={() => setSearchOpen(true)}
              onSearchClose={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }}
              onSearchChange={setSearchQuery}
            />

            <AddFriendForm existingFriends={friends} onAdd={handleAddFriend} />

            {/* Scrollable sections */}
            <div className="flex flex-col min-h-0 overflow-y-auto">
              {/* Incoming requests */}
              <AnimatePresence>
                {showPending && filteredIncoming.length > 0 && (
                  <motion.div
                    key="incoming"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-5 pt-4 pb-2 border-b border-gray-200/60"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <SectionHeading
                        label="Incoming requests"
                        variant="amber"
                      />
                      <span className="size-4 rounded-full bg-amber-400 grid place-content-center text-[9px] font-bold text-white -mt-3">
                        {incoming.length}
                      </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto pr-1">
                      <AnimatePresence>
                        {filteredIncoming.map((f) => (
                          <FriendRow
                            key={f.id}
                            friend={f}
                            onAccept={handleAccept}
                            onDecline={handleDecline}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Outgoing requests */}
              <AnimatePresence>
                {showPending && filteredOutgoing.length > 0 && (
                  <motion.div
                    key="outgoing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-5 pt-4 pb-2 border-b border-gray-200/60"
                  >
                    <SectionHeading label="Sent requests" variant="blue" />
                    <div className="max-h-48 overflow-y-auto pr-1">
                      <AnimatePresence>
                        {filteredOutgoing.map((f) => (
                          <FriendRow
                            key={f.id}
                            friend={f}
                            onCancel={handleCancel}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Pending empty state */}
              <AnimatePresence>
                {activeTab === "pending" &&
                  incoming.length === 0 &&
                  outgoing.length === 0 && (
                    <motion.div
                      key="pending-empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="px-5 pt-4 pb-5"
                    >
                      <EmptyState message="No pending requests." />
                    </motion.div>
                  )}
              </AnimatePresence>

              {/* Friends list */}
              <AnimatePresence>
                {showFriends && (
                  <motion.div
                    key="friends-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-5 pt-4 pb-5"
                  >
                    <SectionHeading
                      label={`Friends${accepted.length > 0 ? ` · ${accepted.length}` : ""}`}
                      variant="green"
                    />
                    <div className="max-h-48 overflow-y-auto pr-1">
                      <AnimatePresence>
                        {filteredAccepted.length > 0 ? (
                          filteredAccepted.map((f) => (
                            <FriendRow
                              key={f.id}
                              friend={f}
                              onRemove={handleRemove}
                            />
                          ))
                        ) : (
                          <EmptyState message="No friends yet — send a request above." />
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </main>
    </>
  );
};

export default Friends;
