import { ChartColumn, Home, LifeBuoy, Trophy, Users } from "lucide-react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SUPPORT_EMAIL } from "@/constants";
import { useAuthStore } from "@/state/auth-store";
import { useIsGuest } from "@/hooks/useIsGuest";
import { AnimatePresence, motion } from "motion/react";

const Navbar = () => {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Mobile hamburger menu (separate from the desktop profile dropdown so the
  // two never fight over a single open-state on different breakpoints).
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Guest gating (R7.4): hide the Friends link for anonymous sessions.
  const isGuest = useIsGuest();

  const profileName = useAuthStore((state) => state.profileName);
  const profileEmail = useAuthStore((state) => state.profileEmail);
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const signOut = useAuthStore((state) => state.signOut);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Close the open menu(s) when clicking outside of them.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close the mobile menu on navigation so it never lingers over a new page.
  // Guard `router.events` — it's always present with a real Next router, but a
  // defensive check keeps the component robust (and testable without a full
  // router harness).
  useEffect(() => {
    const events = router.events;
    if (!events) {
      return;
    }
    const handleRouteChange = () => setMobileMenuOpen(false);
    events.on("routeChangeComplete", handleRouteChange);
    return () => events.off("routeChangeComplete", handleRouteChange);
  }, [router.events]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setMenuOpen(false);
    setMobileMenuOpen(false);
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
    <div className="w-full h-14 p-4 flex justify-between items-center sticky top-0 z-30 bg-white/50">
      {/* Logo */}
      <div className="flex gap-x-1">
        <span className="size-8 p-1 rounded-md bg-green-400 grid place-content-center font-semibold">
          F
        </span>
        <span className="size-8 p-1 rounded-md bg-yellow-400 grid place-content-center font-semibold">
          W
        </span>
      </div>

      {/* Desktop nav links + profile (collapses into the hamburger below sm) */}
      <div className="hidden items-center gap-x-3 sm:flex">
        <Link
          href="/"
          className={`flex items-center gap-x-1.5 text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${
            router.pathname === "/"
              ? "border-green-400 bg-green-50 text-green-700"
              : "border-gray-200 hover:bg-gray-100 text-gray-700"
          }`}
        >
          <Home aria-hidden="true" size={16} />
          Home
        </Link>
        {/* Guest gating (R7.4): Friends link hidden for guests. */}
        {!isGuest && (
          <Link
            href="/friends"
            className={`flex items-center gap-x-1.5 text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${
              router.pathname === "/friends"
                ? "border-green-400 bg-green-50 text-green-700"
                : "border-gray-200 hover:bg-gray-100 text-gray-700"
            }`}
          >
            <Users aria-hidden="true" size={16} />
            Friends
          </Link>
        )}
        {/* Stats link hidden for guests (registered-only, like Friends). */}
        {!isGuest && (
          <Link
            href="/stats"
            className={`flex items-center gap-x-1.5 text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${
              router.pathname === "/stats"
                ? "border-green-400 bg-green-50 text-green-700"
                : "border-gray-200 hover:bg-gray-100 text-gray-700"
            }`}
          >
            <ChartColumn aria-hidden="true" size={16} />
            Stats
          </Link>
        )}
        {/* Leaderboard link visible to everyone (including guests). */}
        <Link
          href="/leaderboard"
          className={`flex items-center gap-x-1.5 text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${
            router.pathname === "/leaderboard"
              ? "border-green-400 bg-green-50 text-green-700"
              : "border-gray-200 hover:bg-gray-100 text-gray-700"
          }`}
        >
          <Trophy aria-hidden="true" size={16} />
          Leaderboard
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
                  {/* Roadmap — public "what's coming" page, available to
                      everyone (including guests). Lives in this dropdown on
                      desktop (mirrored in the mobile burger menu) to keep it
                      off the main nav bar row. */}
                  <Link
                    href="/roadmap"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full px-4 py-2 text-left text-gray-700 text-sm transition-colors hover:bg-gray-100"
                  >
                    Roadmap
                  </Link>
                  {/* Profile / manage subscription. Hidden for guests (billing
                      and profile management are registered-only). */}
                  {!isGuest && (
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="block w-full px-4 py-2 text-left text-gray-700 text-sm transition-colors hover:bg-gray-100"
                    >
                      Profile
                    </Link>
                  )}
                  {/* Contact support — a mailto escape hatch so no one ever
                      feels stuck without help. Shown to everyone, guests
                      included (unlike Profile, which is registered-only). */}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 w-full px-4 py-2 text-left text-gray-700 text-sm transition-colors hover:bg-gray-100"
                  >
                    <LifeBuoy aria-hidden="true" size={14} />
                    Contact support
                  </a>
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

      {/* Mobile hamburger (shown below sm; mirrors the F/W tile theme). The
          trigger is a letter-tile and each menu item leads with its own tile
          glyph so the nav keeps the word-game look on small screens. */}
      <div ref={mobileMenuRef} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((o) => !o)}
          className="grid size-9 place-content-center rounded-md bg-green-400 font-bold text-white transition-all select-none hover:bg-green-300 active:scale-95"
          aria-label="Open menu"
          aria-expanded={mobileMenuOpen}
        >
          {/* Three stacked tiles evoke both a hamburger icon and the game's
              tile rows. */}
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[3px] w-4 rounded-full bg-white" />
            <span className="block h-[3px] w-4 rounded-full bg-white" />
            <span className="block h-[3px] w-4 rounded-full bg-white" />
          </span>
        </button>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-gray-200/80 bg-white/90 font-mono shadow-xl backdrop-blur-lg"
            >
              {/* User info */}
              <div className="border-gray-100 border-b px-4 py-3">
                <p className="truncate font-semibold text-gray-800 text-sm">
                  {profileName ?? "Player"}
                </p>
                <p className="truncate text-[11px] text-gray-500">
                  {profileEmail ?? "No email"}
                </p>
              </div>

              {/* Links as tile rows */}
              <div className="py-1">
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                    router.pathname === "/"
                      ? "text-green-700"
                      : "text-gray-700"
                  }`}
                >
                  <span className="grid size-6 shrink-0 place-content-center rounded-md bg-green-400 font-bold text-[11px] text-white">
                    H
                  </span>
                  Home
                </Link>

                {/* Guest gating (R7.4): Friends link hidden for guests. */}
                {!isGuest && (
                  <Link
                    href="/friends"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                      router.pathname === "/friends"
                        ? "text-green-700"
                        : "text-gray-700"
                    }`}
                  >
                    <span className="grid size-6 shrink-0 place-content-center rounded-md bg-yellow-400 font-bold text-[11px] text-white">
                      F
                    </span>
                    Friends
                  </Link>
                )}

                {/* Stats tile hidden for guests (registered-only). */}
                {!isGuest && (
                  <Link
                    href="/stats"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                      router.pathname === "/stats"
                        ? "text-green-700"
                        : "text-gray-700"
                    }`}
                  >
                    <span className="grid size-6 shrink-0 place-content-center rounded-md bg-yellow-400 font-bold text-[11px] text-white">
                      S
                    </span>
                    Stats
                  </Link>
                )}

                {/* Leaderboard tile visible to everyone (including guests). */}
                <Link
                  href="/leaderboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                    router.pathname === "/leaderboard"
                      ? "text-green-700"
                      : "text-gray-700"
                  }`}
                >
                  <span className="grid size-6 shrink-0 place-content-center rounded-md bg-green-400 font-bold text-[11px] text-white">
                    L
                  </span>
                  Leaderboard
                </Link>

                {/* Roadmap tile visible to everyone (including guests) — the
                    public "what's coming" page. Kept in the burger menu for
                    now to avoid crowding the desktop nav bar. */}
                <Link
                  href="/roadmap"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                    router.pathname === "/roadmap"
                      ? "text-green-700"
                      : "text-gray-700"
                  }`}
                >
                  <span className="grid size-6 shrink-0 place-content-center rounded-md bg-yellow-400 font-bold text-[11px] text-white">
                    R
                  </span>
                  Roadmap
                </Link>

                {/* Profile / manage subscription. Hidden for guests. */}
                {!isGuest && (
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100 ${
                      router.pathname === "/profile"
                        ? "text-green-700"
                        : "text-gray-700"
                    }`}
                  >
                    <span className="grid size-6 shrink-0 place-content-center rounded-md bg-green-400 font-bold text-[11px] text-white">
                      P
                    </span>
                    Profile
                  </Link>
                )}

                {/* Contact support — mailto escape hatch, shown to everyone
                    (guests included) so no one feels stuck without help. */}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-gray-700 text-sm transition-colors hover:bg-gray-100"
                >
                  <span className="grid size-6 shrink-0 place-content-center rounded-md bg-amber-400 text-white">
                    <LifeBuoy aria-hidden="true" size={13} />
                  </span>
                  Contact support
                </a>
              </div>

              {/* Actions */}
              <div className="border-gray-100 border-t py-1">
                <button
                  type="button"
                  disabled={isSigningOut}
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-red-500 text-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid size-6 shrink-0 place-content-center rounded-md bg-red-400 font-bold text-[11px] text-white">
                    {initials}
                  </span>
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Navbar;
