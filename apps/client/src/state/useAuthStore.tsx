import { create } from "zustand";
import type { UserInfo } from "firebase/auth";
import { type Claims } from "next-firebase-auth-edge/auth/claims";

export interface User extends UserInfo {
  emailVerified: boolean;
  customClaims: Claims;
}

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));

// Drop-in replacement for the old useAuth hook
export const useAuth = () => useAuthStore((state) => state.user);
