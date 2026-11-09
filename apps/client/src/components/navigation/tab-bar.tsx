import { ChartColumn, Play, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useGameSessionStore } from "@/state/game-session-store";

/**
 * Mobile bottom tab bar (phones only). Thumb-reach navigation for the main
 * sections; the top navbar keeps the profile/menu on small screens.
 *
 * While mounted and visible it sets `data-tabbar` on <html>, which makes the
 * global CSS reserve `--tabbar-h` of space at the bottom of the page (see
 * globals.css), so no page content or h-dvh layout sits under the bar.
 */
const TABS = [
	{ href: "/", label: "Play", Icon: Play },
	{ href: "/friends", label: "Friends", Icon: Users },
	{ href: "/stats", label: "Stats", Icon: ChartColumn },
	{ href: "/leaderboard", label: "Ranks", Icon: Trophy },
] as const;

/** Routes that show the bar. Auth, practice and roadmap stay full-bleed. */
const TAB_ROUTES = new Set([
	"/",
	"/duels",
	"/friends",
	"/stats",
	"/leaderboard",
	"/profile",
]);

const TabBar = () => {
	const router = useRouter();
	const inRealtimeGame = useGameSessionStore((s) => s.isRealtimeGameActive);
	const visible = TAB_ROUTES.has(router.pathname) && !inRealtimeGame;

	useEffect(() => {
		const root = document.documentElement;
		if (visible) {
			root.setAttribute("data-tabbar", "true");
		} else {
			root.removeAttribute("data-tabbar");
		}
		return () => root.removeAttribute("data-tabbar");
	}, [visible]);

	if (!visible) {
		return null;
	}

	return (
		<nav
			aria-label="Primary"
			className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-white/10 border-t bg-panel/90 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
		>
			{TABS.map(({ href, label, Icon }) => {
				const active =
					href === "/"
						? router.pathname === "/" || router.pathname === "/duels"
						: router.pathname === href;
				return (
					<Link
						aria-current={active ? "page" : undefined}
						className={`flex w-16 flex-col items-center gap-1 font-display text-[10px] uppercase tracking-widest transition-colors ${
							active ? "text-lime" : "text-gray-500"
						}`}
						href={href}
						key={href}
					>
						<span
							className={`grid h-7 w-12 place-content-center rounded-full transition-colors ${
								active ? "bg-lime/15" : ""
							}`}
						>
							<Icon aria-hidden="true" size={18} />
						</span>
						{label}
					</Link>
				);
			})}
		</nav>
	);
};

export default TabBar;
