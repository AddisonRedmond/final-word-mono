// PWA install state.
//
// Chromium browsers (Android Chrome, desktop Chrome/Edge) fire a
// `beforeinstallprompt` event we can stash and replay from our own button.
// iOS Safari never fires it, so there we show manual "Share -> Add to Home
// Screen" steps instead. Only the banner dismissal is persisted; everything
// else is derived from the current browser session.
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Non-standard Chromium event; not in lib.dom.d.ts. */
export type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallHelpSource = "banner" | "navbar";

type PwaInstallState = {
	/** Stashed Chromium install prompt, or null if unavailable/used. */
	deferredPrompt: BeforeInstallPromptEvent | null;
	/** True on iPhone/iPad (incl. iPadOS reporting as Mac). */
	isIos: boolean;
	/**
	 * True when running as an installed app. Defaults to true so SSR and the
	 * first client render show nothing; `detectEnvironment` corrects it.
	 */
	isStandalone: boolean;
	/** Whether the "how to install" dialog is open. */
	helpOpen: boolean;
	/** What opened the help dialog (for analytics). */
	helpSource: InstallHelpSource;
	/** Epoch ms when the user dismissed the banner (persisted). */
	dismissedAt: number | null;

	setDeferredPrompt: (event: BeforeInstallPromptEvent | null) => void;
	detectEnvironment: () => void;
	markInstalled: () => void;
	openHelp: (source: InstallHelpSource) => void;
	closeHelp: () => void;
	dismissBanner: () => void;
};

export const usePwaInstallStore = create<PwaInstallState>()(
	persist(
		(set) => ({
			deferredPrompt: null,
			isIos: false,
			isStandalone: true,
			helpOpen: false,
			helpSource: "navbar",
			dismissedAt: null,

			setDeferredPrompt: (deferredPrompt) => set({ deferredPrompt }),
			detectEnvironment: () => {
				const ua = navigator.userAgent;
				const isIos =
					/iPad|iPhone|iPod/.test(ua) ||
					// iPadOS 13+ identifies as a Mac but has a touch screen.
					(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
				const isStandalone =
					window.matchMedia("(display-mode: standalone)").matches ||
					(navigator as Navigator & { standalone?: boolean }).standalone ===
						true;
				set({ isIos, isStandalone });
			},
			markInstalled: () =>
				set({ isStandalone: true, deferredPrompt: null, helpOpen: false }),
			openHelp: (helpSource) => set({ helpOpen: true, helpSource }),
			closeHelp: () => set({ helpOpen: false }),
			dismissBanner: () => set({ dismissedAt: Date.now() }),
		}),
		{
			name: "fw-pwa-install",
			partialize: (state) => ({ dismissedAt: state.dismissedAt }),
		},
	),
);
