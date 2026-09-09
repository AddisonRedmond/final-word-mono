import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/state/auth-store";
import { AnimatePresence, motion } from "motion/react";

const Navbar = () => {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const profileName = useAuthStore((state) => state.profileName);
  const profileEmail = useAuthStore((state) => state.profileEmail);
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const signOut = useAuthStore((state) => state.signOut);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setMenuOpen(false);
    try {
      await signOut();
    } finally {
      router.push("/sign-in");
    }
  };

  const initials = profileName
    ? profileName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <div className="w-full h-14 p-4 flex justify-between items-center">
      {/* Logo */}
      <div className="flex gap-x-1">
        <span className="size-8 p-1 rounded-md bg-green-400 grid place-content-center font-semibold">
          F
        </span>
        <span className="size-8 p-1 rounded-md bg-yellow-400 grid place-content-center font-semibold">
          W
        </span>
      </div>

      {/* Nav links + profile */}
      <div className="flex items-center gap-x-3">
        <Link
          href="/friends"
          className={`text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${
            router.pathname === "/friends"
              ? "border-green-400 bg-green-50 text-green-700"
              : "border-gray-200 hover:bg-gray-100 text-gray-700"
          }`}
        >
          Friends
        </Link>

        {/* Profile badge + dropdown */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="size-8 rounded-md bg-amber-400 grid place-content-center text-xs font-bold text-white hover:bg-amber-300 active:scale-95 transition-all select-none"
            aria-label="Open profile menu"
            aria-expanded={menuOpen}
          >
            {initials}
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 mt-2 w-52 rounded-lg border border-gray-200/80 bg-white/90 backdrop-blur-lg shadow-xl z-50 overflow-hidden font-mono"
              >
                {/* User info */}
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {profileName ?? "Player"}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {profileEmail ?? "No email"}
                  </p>
                </div>

                {/* Actions */}
                <div className="py-1">
                  <button
                    type="button"
                    disabled={isSigningOut}
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSigningOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default Navbar;
