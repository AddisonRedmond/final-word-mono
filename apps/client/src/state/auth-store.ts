import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

type AuthState = {
  user: User | null;
  profileName: string | null;
  profileEmail: string | null;
  isInitialized: boolean;
  initializeAuth: () => void;
  signOut: () => Promise<void>;
};

const supabase = createClient();

const getProfileName = (user: User | null) =>
  user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? null;

const setUser = (user: User | null) => {
  useAuthStore.setState({
    user,
    profileName: getProfileName(user),
    profileEmail: user?.email ?? null,
  });
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profileName: null,
  profileEmail: null,
  isInitialized: false,
  initializeAuth: () => {
    if (get().isInitialized) {
      return;
    }

    set({ isInitialized: true });

    void supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
  },
}));