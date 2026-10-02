import type { User } from "@supabase/supabase-js";
import { create } from "zustand";
import { createClient } from "@/utils/supabase/client";

type AuthState = {
	user: User | null;
	profileName: string | null;
	profileEmail: string | null;
	/** True once `initializeAuth` has kicked off (guards against re-running it). */
	isInitialized: boolean;
	/**
	 * True once the FIRST `getUser()` has resolved — i.e. the current user is
	 * actually known (signed-in or confirmed signed-out). Distinct from
	 * `isInitialized`, which flips synchronously before auth is read. UI that
	 * branches on auth (e.g. guest vs registered) should wait on this to avoid
	 * flashing the wrong state while the session is still loading.
	 */
	authResolved: boolean;
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

/**
 * Keep the realtime *socket* authenticated with the current access token.
 *
 * `createBrowserClient` authenticates REST requests via cookies, but the
 * realtime websocket is a separate transport that must be told the user's JWT
 * explicitly — otherwise `auth.uid()` is null on the socket and RLS-protected
 * subscriptions (e.g. the duel channels) silently receive nothing. Access
 * tokens also expire (~1h) and rotate on refresh, so we re-apply the token on
 * every auth state change, not just at sign-in. Passing `undefined` on sign-out
 * drops the socket back to the anon key.
 */
const syncRealtimeAuth = (accessToken: string | undefined) => {
	// setAuth returns a promise; we don't need to await it here — the token is
	// applied to the socket for subsequent subscriptions.
	void supabase.realtime.setAuth(accessToken);
};

export const useAuthStore = create<AuthState>((set, get) => ({
	user: null,
	profileName: null,
	profileEmail: null,
	isInitialized: false,
	authResolved: false,
	initializeAuth: () => {
		if (get().isInitialized) {
			return;
		}

		set({ isInitialized: true });

		// Prime the realtime socket with the existing session's token on load, so
		// subscriptions created before the first auth event are authenticated too.
		void supabase.auth.getSession().then(({ data: { session } }) => {
			syncRealtimeAuth(session?.access_token);
		});

		void supabase.auth.getUser().then(({ data: { user } }) => {
			setUser(user);
			// Auth is now known — unblock UI that branches on the user's state.
			set({ authResolved: true });
		});

		supabase.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null);
			// Re-apply the token on sign-in, sign-out, and TOKEN_REFRESHED so the
			// socket auth never goes stale.
			syncRealtimeAuth(session?.access_token);
		});
	},
	signOut: async () => {
		await supabase.auth.signOut();
	},
}));
