import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SectionHeading } from "./section-heading";
import type { Friend } from "./types";

interface AddFriendFormProps {
  existingFriends: Friend[];
  onAdd: (friendEmail: string) => Promise<void> | void;
}

export const AddFriendForm = ({
  existingFriends,
  onAdd,
}: AddFriendFormProps) => {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError(null);
    setSuccessMessage(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setEmailError("Please enter an email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("That doesn't look like a valid email.");
      return;
    }
    if (existingFriends.some((f) => f.email.toLowerCase() === trimmed)) {
      setEmailError("You already have a connection with that email.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onAdd(trimmed);
      setEmail("");
      setSuccessMessage(`Friend request sent to ${trimmed}`);
    } catch (err: unknown) {
      setEmailError(
        err instanceof Error ? err.message : "Failed to send friend request.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-5 border-b border-gray-200/60">
      <SectionHeading label="Add a friend" variant="green" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setSuccessMessage(null);
            }}
            placeholder="friend@example.com"
            className="flex-1 min-w-0 text-sm px-3 py-2 rounded-md border border-gray-200 bg-white/70 backdrop-blur-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400/60 focus:border-green-400 transition"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-md bg-green-400 hover:bg-green-300 text-white active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Sending…" : "Send"}
          </button>
        </div>
        <AnimatePresence mode="wait">
          {emailError && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[11px] text-red-500"
            >
              {emailError}
            </motion.p>
          )}
          {successMessage && (
            <motion.p
              key="success"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[11px] text-emerald-600"
            >
              {successMessage}
            </motion.p>
          )}
        </AnimatePresence>
      </form>
    </div>
  );
};
