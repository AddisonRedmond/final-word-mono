import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Controllable auth-store state + router spy. The hook reads `user`/`authResolved`
// from the store and calls `router.replace("/sign-in")` when resolved + no user.
let storeState: { user: unknown; authResolved: boolean };
vi.mock("@/state/auth-store", () => ({
	useAuthStore: (selector: (s: typeof storeState) => unknown) =>
		selector(storeState),
}));

const replace = vi.fn();
vi.mock("next/router", () => ({
	useRouter: () => ({ replace }),
}));

import { useRequireAuth } from "./useRequireAuth";

afterEach(() => {
	vi.clearAllMocks();
});

describe("useRequireAuth", () => {
	it("redirects to /sign-in once auth resolves with no user", () => {
		storeState = { user: null, authResolved: true };

		const { result } = renderHook(() => useRequireAuth());

		expect(replace).toHaveBeenCalledWith("/sign-in");
		expect(result.current.authResolved).toBe(true);
	});

	it("does not redirect while auth is still resolving (even with no user)", () => {
		storeState = { user: null, authResolved: false };

		const { result } = renderHook(() => useRequireAuth());

		expect(replace).not.toHaveBeenCalled();
		expect(result.current.authResolved).toBe(false);
	});

	it("does not redirect when a user is present", () => {
		storeState = { user: { id: "user-1" }, authResolved: true };

		renderHook(() => useRequireAuth());

		expect(replace).not.toHaveBeenCalled();
	});
});
