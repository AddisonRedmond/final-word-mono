// Feature: anonymous-sign-in
// One-time "guest welcome carousel seen" flag. A named seam under state/ so the
// whole guest feature stays greppable and removable in one pass (R9).
//
// The welcome carousel (what a full account offers over a guest one) should show
// only the FIRST time a guest signs in, not on every home-screen mount. That
// requires a flag that survives reloads, so this store is backed by
// localStorage via zustand's `persist` middleware (the rest of the app uses
// plain in-memory zustand stores, but a true "first ever" flag needs
// persistence).
import { create } from "zustand";
import { persist } from "zustand/middleware";

type GuestWelcomeState = {
	/** True once the guest welcome carousel has been shown and dismissed. */
	hasSeenWelcome: boolean;
	/** Mark the carousel as seen so it never auto-opens again. */
	markWelcomeSeen: () => void;
};

export const useGuestWelcomeStore = create<GuestWelcomeState>()(
	persist(
		(set) => ({
			hasSeenWelcome: false,
			markWelcomeSeen: () => set({ hasSeenWelcome: true }),
		}),
		{
			name: "fw-guest-welcome-seen",
		},
	),
);
