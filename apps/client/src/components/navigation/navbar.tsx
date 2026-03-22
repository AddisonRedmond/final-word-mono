import { handleSignOut } from "@/firebase/client";
import { useAuth } from "@/state/useAuthStore";
import Image from "next/image";
import { useRouter } from "next/router";

const PlayersOnline = () => (
  <div className="flex items-center gap-x-1.5 text-sm">
    <span className="size-2 rounded-full bg-green-400 animate-pulse" />
    <span>1,342 online</span>
  </div>
);

const UserProfile = () => {
  const user = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center gap-x-2">
      {user.photoURL ? (
        <Image
          src={user.photoURL}
          alt={user.displayName ?? "User avatar"}
          className="size-8 rounded-full object-cover"
          referrerPolicy="no-referrer"
          unoptimized
          width={32}
          height={32}
        />
      ) : (
        <div className="size-8 rounded-full bg-gray-400 grid place-content-center text-white text-sm font-semibold">
          {user.displayName?.[0]?.toUpperCase() ?? "?"}{" "}
        </div>
      )}{" "}
    </div>
  );
};

const Navbar = () => {
  const router = useRouter();

  const hijackSignOut = async () => {
    await handleSignOut();
    router.push("/sign-in");
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
        <button
          onClick={()=> hijackSignOut()}
          className="text-sm font-medium px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
        >
          Sign Out
        </button>
        <UserProfile />
      </div>
    </div>
  );
};

export default Navbar;
