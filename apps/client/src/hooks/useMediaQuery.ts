import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and re-render when it toggles.
 *
 * SSR-safe: there is no `window` during server render, so the hook starts from
 * the caller-provided `defaultState` (default `false`) and syncs to the real
 * match on mount. Consumers that gate layout on screen size should pair this
 * with a "mounted" guard (see `useIsDesktop`) to avoid a hydration mismatch
 * flash.
 */
export const useMediaQuery = (query: string, defaultState = false): boolean => {
	const [matches, setMatches] = useState(defaultState);

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) {
			return;
		}

		const mediaQueryList = window.matchMedia(query);

		const handleChange = (event: MediaQueryListEvent) => {
			setMatches(event.matches);
		};

		// Sync immediately in case the query already matches on mount.
		setMatches(mediaQueryList.matches);
		mediaQueryList.addEventListener("change", handleChange);

		return () => mediaQueryList.removeEventListener("change", handleChange);
	}, [query]);

	return matches;
};

/**
 * Breakpoint at/above which the realtime game modes (Battle Royale, Race) are
 * allowed to render. Mirrors Tailwind's `lg` breakpoint (1024px) so the gate
 * lines up with the `lg:` utilities used in the UI. Phones and most tablets in
 * portrait fall below this and get the duel-only experience.
 */
export const DESKTOP_MIN_WIDTH = 1024;

/**
 * Whether the viewport is wide enough for desktop-only features.
 *
 * Returns `{ isDesktop, hydrated }`:
 * - `hydrated` is `false` during SSR and the first client paint, flipping to
 *   `true` after mount once the real viewport width is known.
 * - `isDesktop` reflects the live match of the desktop breakpoint.
 *
 * Gate desktop-only UI on `hydrated && isDesktop`, and treat `!hydrated` as the
 * neutral loading state, so a desktop-only screen never flashes on a phone
 * before hydration (and vice versa).
 */
export const useIsDesktop = (): { isDesktop: boolean; hydrated: boolean } => {
	const [hydrated, setHydrated] = useState(false);
	const isDesktop = useMediaQuery(`(min-width: ${DESKTOP_MIN_WIDTH}px)`, true);

	useEffect(() => {
		setHydrated(true);
	}, []);

	return { isDesktop, hydrated };
};
