import { useRouter } from "next/router";
import { useEffect } from "react";

import { useAuthStore } from "@/state/auth-store";

/**
 * Client-side route guard for authenticated pages.
 *
 * Redirects to `/sign-in` whenever the session is resolved and there is no user
 * — covering sign-out (from anywhere, not just the navbar button), direct URL
 * navigation while logged out, and session expiry. It waits for `authResolved`
 * so it never bounces a user mid-load before the session has been read.
 *
 * Server resources are already protected independently (the socket/tRPC reject
 * an absent session); this is the UI counterpart so a signed-out visitor isn't
 * left sitting on a protected page.
 *
 * Returns `authResolved` so callers can hold rendering until auth is known.
 */
export const useRequireAuth = (): { authResolved: boolean } => {
	const router = useRouter();
	const user = useAuthStore((state) => state.user);
	const authResolved = useAuthStore((state) => state.authResolved);

	useEffect(() => {
		if (authResolved && !user) {
			void router.replace("/sign-in");
		}
	}, [authResolved, user, router]);

	return { authResolved };
};
