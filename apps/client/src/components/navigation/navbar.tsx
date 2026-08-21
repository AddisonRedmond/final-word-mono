import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/auth-store";

const PlayersOnline = () => (
  <div className="flex items-center gap-x-1.5 text-sm">
    <span className="size-2 rounded-full bg-green-400 animate-pulse" />
    <span>1,342 online</span>
  </div>
);

interface ProfileProps {
  name: string | null;
  email: string | null;
}

const Profile = ({ name, email }: ProfileProps) => {
  return (
    <div className="text-right leading-tight">
      <p className="text-sm font-semibold text-gray-900">{name ?? "Player"}</p>
      <p className="text-xs text-gray-500">{email ?? "No email"}</p>
    </div>
  );
};

const Navbar = () => {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const profileName = useAuthStore((state) => state.profileName);
  const profileEmail = useAuthStore((state) => state.profileEmail);
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const signOut = useAuthStore((state) => state.signOut);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      router.push("/sign-in");
    }
  };
  return (
    <div className="w-full h-14 p-4 flex justify-between">
      <div className="flex gap-x-1">
        <span className="size-8 p-1 rounded-md bg-green-400 grid place-content-center font-semibold">
          F
        </span>
        <span className="size-8 p-1 rounded-md bg-yellow-400 grid place-content-center font-semibold">
          W
        </span>
      </div>
      <div className="flex items-center gap-x-4">
        <button className="text-sm font-medium px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors">
          🏆 Leaderboard
        </button>
        <PlayersOnline />
        <Profile email={profileEmail} name={profileName} />
        <button
          type="button"
          disabled={isSigningOut}
          onClick={handleSignOut}
          className="text-sm font-medium px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
        >
          {isSigningOut ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </div>
  );
};

export default Navbar;
