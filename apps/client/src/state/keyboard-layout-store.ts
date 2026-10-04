// Keyboard layout preference.
//
// Lets a player swap the on-screen keyboard's Enter and Delete action keys so
// whichever one they reach for lands under their dominant thumb. The choice is
// a durable personal preference, so — like the guest-welcome flag — this store
// is backed by localStorage via zustand's `persist` middleware rather than the
// app's usual in-memory stores.
import { create } from "zustand";
import { persist } from "zustand/middleware";

type KeyboardLayoutState = {
	/**
	 * When true, the bottom keyboard row shows Delete on the left and Enter on
	 * the right (swapped from the default Enter-left / Delete-right order).
	 */
	swapActionKeys: boolean;
	/** Flip the Enter/Delete positions and persist the new value. */
	toggleSwapActionKeys: () => void;
};

export const useKeyboardLayoutStore = create<KeyboardLayoutState>()(
	persist(
		(set) => ({
			swapActionKeys: false,
			toggleSwapActionKeys: () =>
				set((state) => ({ swapActionKeys: !state.swapActionKeys })),
		}),
		{
			name: "fw-keyboard-swap-action-keys",
		},
	),
);
