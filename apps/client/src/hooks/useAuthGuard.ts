import { useRouter } from "next/router";
import { useEffect } from "react";

import { useAuthStore } from "@/state/auth-store";

/**
 * Routes that stay reachable while signed out. Everything else is protected.
 * Keep in step with the server proxy's matcher (`src/proxy.ts`): that list
 * names the protected pages, this one names the exceptions. `/404` and
 * `/_error` are included so an unknown URL isn't bounced to sign-in.
 */
const PUBLIC_ROUTES = new Set([
	"/sign-in",
	"/roadmap",
	"/practice",
	"/404",
	"/_error",
]);

/**
 * App-wide client auth guard (mounted once in `_app`).
 *
 * The server proxy only checks the session on navigation. Once a page is open,
 * the session can still end: the user signs out in another tab, the refresh
 * token expires or is revoked, or the API starts returning 401 (see
 * `handleUnauthorized`). In each case the auth store's `user` becomes null.
 * This hook watches for that and sends the visitor to /sign-in, on every
 * protected page, instead of each page having to remember its own guard.
 *
 * It waits for `authResolved` so it never redirects while the first session
 * read is still in flight.
 */
export const useAuthGuard = (): void => {
	const router = useRouter();
	const user = useAuthStore((state) => state.user);
	const authResolved = useAuthStore((state) => state.authResolved);

	useEffect(() => {
		if (!authResolved || user) {
			return;
		}
		if (PUBLIC_ROUTES.has(router.pathname)) {
			return;
		}
		void router.replace("/sign-in");
	}, [authResolved, user, router.pathname, router]);
};
