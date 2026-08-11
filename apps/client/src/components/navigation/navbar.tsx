import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

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
  const [supabase] = useState(() => createClient());
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);

  useEffect(() => {
    const syncUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setProfileName(user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? null);
      setProfileEmail(user?.email ?? null);
    };

    void syncUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setProfileName(user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? null);
      setProfileEmail(user?.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
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
