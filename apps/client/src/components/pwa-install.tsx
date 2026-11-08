import { Download, Share, SquarePlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	type BeforeInstallPromptEvent,
	usePwaInstallStore,
} from "@/state/pwa-install-store";
import { initAnalytics, setAnalyticsContext, track } from "@/utils/posthog";
import Button from "./button";

/** Coarse platform label for analytics segmentation. */
const getPlatform = (isIos: boolean): "ios" | "android" | "desktop" => {
	if (isIos) {
		return "ios";
	}
	return /Android/i.test(navigator.userAgent) ? "android" : "desktop";
};

/** Wait a bit after load so the banner doesn't compete with first paint. */
const BANNER_DELAY_MS = 4000;
/** After a dismissal, stay quiet for two weeks. */
const BANNER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
/** The banner is only offered on the home screen, never mid-game. */
const BANNER_ROUTES = new Set(["/"]);

/**
 * Helps players install Final Word as an app. Mount once in `_app`.
 *
 * - Chromium: captures `beforeinstallprompt` and offers a one-tap Install.
 * - iOS Safari: no install API exists, so we show Share -> Add to Home Screen.
 * - Anything else: the help dialog (opened from the navbar) gives generic tips.
 *
 * Renders nothing when the app is already running installed.
 */
const PwaInstall = () => {
	const router = useRouter();
	const deferredPrompt = usePwaInstallStore((s) => s.deferredPrompt);
	const isIos = usePwaInstallStore((s) => s.isIos);
	const isStandalone = usePwaInstallStore((s) => s.isStandalone);
	const helpOpen = usePwaInstallStore((s) => s.helpOpen);
	const dismissedAt = usePwaInstallStore((s) => s.dismissedAt);
	const setDeferredPrompt = usePwaInstallStore((s) => s.setDeferredPrompt);
	const detectEnvironment = usePwaInstallStore((s) => s.detectEnvironment);
	const markInstalled = usePwaInstallStore((s) => s.markInstalled);
	const openHelp = usePwaInstallStore((s) => s.openHelp);
	const closeHelp = usePwaInstallStore((s) => s.closeHelp);
	const dismissBanner = usePwaInstallStore((s) => s.dismissBanner);

	const [delayElapsed, setDelayElapsed] = useState(false);

	useEffect(() => {
		// Child effects run before `_app`'s, so make sure PostHog is initialised
		// before we register context / send events. Safe to call repeatedly.
		initAnalytics();
		detectEnvironment();

		// Tag every event from this session with how the game was opened, so any
		// metric (retention, games played) can be split installed vs browser.
		const env = usePwaInstallStore.getState();
		setAnalyticsContext({
			display_mode: env.isStandalone ? "standalone" : "browser",
		});
		if (env.isStandalone) {
			track("pwa_launched", { platform: getPlatform(env.isIos) });
		}

		const onBeforeInstallPrompt = (event: Event) => {
			// Stop Chrome's mini-infobar; we show our own UI instead.
			event.preventDefault();
			setDeferredPrompt(event as BeforeInstallPromptEvent);
		};
		const onAppInstalled = () => {
			track("pwa_installed", {
				platform: getPlatform(usePwaInstallStore.getState().isIos),
			});
			markInstalled();
		};

		window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
		window.addEventListener("appinstalled", onAppInstalled);
		const timer = window.setTimeout(
			() => setDelayElapsed(true),
			BANNER_DELAY_MS,
		);
		return () => {
			window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
			window.removeEventListener("appinstalled", onAppInstalled);
			window.clearTimeout(timer);
		};
	}, [detectEnvironment, markInstalled, setDeferredPrompt]);

	const handleInstall = async () => {
		if (!deferredPrompt) {
			openHelp("banner");
			return;
		}
		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		track("pwa_install_prompt_result", {
			platform: getPlatform(isIos),
			outcome,
		});
		// A captured prompt can only be used once.
		setDeferredPrompt(null);
		if (outcome === "dismissed") {
			dismissBanner();
		}
	};

	const handleDismissBanner = () => {
		track("pwa_install_banner_dismissed", { platform: getPlatform(isIos) });
		dismissBanner();
	};

	const snoozed =
		dismissedAt !== null && Date.now() - dismissedAt < BANNER_SNOOZE_MS;
	const showBanner =
		delayElapsed &&
		!isStandalone &&
		!snoozed &&
		!helpOpen &&
		BANNER_ROUTES.has(router.pathname) &&
		(deferredPrompt !== null || isIos);

	// Fire "shown" once per page session when the banner first appears. The ref
	// stops it re-firing as `showBanner` toggles (e.g. while the dialog is open).
	const bannerShownTracked = useRef(false);
	useEffect(() => {
		if (showBanner && !bannerShownTracked.current) {
			bannerShownTracked.current = true;
			track("pwa_install_banner_shown", { platform: getPlatform(isIos) });
		}
	}, [showBanner, isIos]);

	// Fire "help opened" whenever the dialog opens, from either entry point.
	const helpSource = usePwaInstallStore((s) => s.helpSource);
	useEffect(() => {
		if (helpOpen) {
			track("pwa_install_help_opened", {
				platform: getPlatform(isIos),
				source: helpSource,
			});
		}
	}, [helpOpen, helpSource, isIos]);

	return (
		<>
			<AnimatePresence>
				{showBanner && (
					<motion.div
						animate={{ opacity: 1, y: 0 }}
						aria-label="Install Final Word"
						className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur-lg"
						exit={{ opacity: 0, y: 24 }}
						initial={{ opacity: 0, y: 24 }}
						role="region"
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						{/* biome-ignore lint/performance/noImgElement: tiny static icon */}
						<img
							alt=""
							className="size-10 shrink-0 rounded-md"
							height={40}
							src="/icons/icon-192.png"
							width={40}
						/>
						<div className="min-w-0 grow">
							<p className="font-semibold text-sm text-stone-800">
								Get the Final Word app
							</p>
							<p className="text-stone-600 text-xs">
								Play full screen, right from your home screen.
							</p>
						</div>
						<Button onClick={handleInstall} variant="solid">
							{deferredPrompt ? "Install" : "How"}
						</Button>
						<button
							aria-label="Dismiss"
							className="grid size-7 shrink-0 cursor-pointer place-content-center rounded-md text-stone-500 hover:bg-gray-100"
							onClick={handleDismissBanner}
							type="button"
						>
							<X aria-hidden="true" size={16} />
						</button>
					</motion.div>
				)}
			</AnimatePresence>

			<AnimatePresence>
				{helpOpen && !isStandalone && (
					<InstallHelpDialog
						canPromptInstall={deferredPrompt !== null}
						isIos={isIos}
						onClose={closeHelp}
						onInstall={handleInstall}
					/>
				)}
			</AnimatePresence>
		</>
	);
};

type InstallHelpDialogProps = {
	isIos: boolean;
	canPromptInstall: boolean;
	onInstall: () => void;
	onClose: () => void;
};

const InstallHelpDialog = ({
	isIos,
	canPromptInstall,
	onInstall,
	onClose,
}: InstallHelpDialogProps) => {
	// Portal only after mount so SSR (no `document`) is skipped.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	if (!mounted) {
		return null;
	}

	return createPortal(
		<motion.div
			animate={{ opacity: 1 }}
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
			exit={{ opacity: 0 }}
			initial={{ opacity: 0 }}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
			transition={{ duration: 0.2, ease: "easeInOut" }}
		>
			<motion.div
				animate={{ opacity: 1, scale: 1, y: 0 }}
				aria-labelledby="pwa-install-title"
				aria-modal="true"
				className="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
				exit={{ opacity: 0, scale: 0.95, y: 12 }}
				initial={{ opacity: 0, scale: 0.95, y: 12 }}
				role="dialog"
				transition={{ duration: 0.2, ease: "easeOut" }}
			>
				<h2 className="font-bold text-lg text-stone-800" id="pwa-install-title">
					Get the Final Word app
				</h2>
				<p className="mt-1 text-sm text-stone-600">
					Add Final Word to your home screen to play full screen with one tap.
				</p>

				{canPromptInstall ? (
					<div className="mt-4">
						<Button className="w-full" onClick={onInstall} variant="solid">
							<span className="inline-flex items-center gap-1.5">
								<Download aria-hidden="true" size={14} />
								Install now
							</span>
						</Button>
					</div>
				) : isIos ? (
					<ol className="mt-4 space-y-3 text-sm text-stone-700">
						<li className="flex items-start gap-3">
							<StepBadge n={1} />
							<span>
								Tap the{" "}
								<Share
									aria-label="Share"
									className="mx-0.5 inline align-text-bottom"
									size={16}
								/>{" "}
								<strong>Share</strong>{" "} button in Safari&apos;s toolbar.
							</span>
						</li>
						<li className="flex items-start gap-3">
							<StepBadge n={2} />
							<span>
								Scroll down and tap{" "}
								<SquarePlus
									aria-hidden="true"
									className="mx-0.5 inline align-text-bottom"
									size={16}
								/>{" "}
								<strong>Add to Home Screen</strong>.
							</span>
						</li>
						<li className="flex items-start gap-3">
							<StepBadge n={3} />
							<span>
								Tap <strong>Add</strong>. Final Word now lives on your home
								screen.
							</span>
						</li>
						<li className="text-stone-500 text-xs">
							Not seeing it? Open this page in Safari first.
						</li>
					</ol>
				) : (
					<ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-stone-700">
						<li>
							<strong>Android (Chrome):</strong> open the ⋮ menu and tap{" "}
							<strong>Install app</strong> or{" "}
							<strong>Add to Home screen</strong>.
						</li>
						<li>
							<strong>Desktop (Chrome/Edge):</strong> click the install icon at
							the right end of the address bar.
						</li>
						<li>
							<strong>iPhone/iPad:</strong> open this page in Safari, tap Share,
							then <strong>Add to Home Screen</strong>.
						</li>
					</ul>
				)}

				<div className="mt-5 flex justify-end">
					<Button onClick={onClose} variant="outline">
						Close
					</Button>
				</div>
			</motion.div>
		</motion.div>,
		document.body,
	);
};

const StepBadge = ({ n }: { n: number }) => (
	<span className="grid size-6 shrink-0 place-content-center rounded-md bg-green-400 font-bold text-[11px] text-white">
		{n}
	</span>
);

export default PwaInstall;
