import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let pathname = "/duels";

vi.mock("next/router", () => ({
	useRouter: () => ({ pathname, replace }),
}));

let authState: { user: { id: string } | null; authResolved: boolean } = {
	user: null,
	authResolved: false,
};

vi.mock("@/state/auth-store", () => ({
	useAuthStore: (selector: (state: typeof authState) => unknown) =>
		selector(authState),
}));

import { useAuthGuard } from "./useAuthGuard";

describe("useAuthGuard", () => {
	beforeEach(() => {
		replace.mockClear();
		pathname = "/duels";
		authState = { user: null, authResolved: false };
	});

	it("does nothing until auth has resolved", () => {
		renderHook(() => useAuthGuard());
		expect(replace).not.toHaveBeenCalled();
	});

	it("redirects a signed-out visitor on a protected page to /sign-in", () => {
		authState = { user: null, authResolved: true };
		renderHook(() => useAuthGuard());
		expect(replace).toHaveBeenCalledWith("/sign-in");
	});

	it("leaves a signed-in user alone", () => {
		authState = { user: { id: "u1" }, authResolved: true };
		renderHook(() => useAuthGuard());
		expect(replace).not.toHaveBeenCalled();
	});

	it.each(["/sign-in", "/roadmap", "/practice"])(
		"does not redirect a signed-out visitor on public route %s",
		(route) => {
			pathname = route;
			authState = { user: null, authResolved: true };
			renderHook(() => useAuthGuard());
			expect(replace).not.toHaveBeenCalled();
		},
	);

	it("redirects when the session ends while the page is open", () => {
		authState = { user: { id: "u1" }, authResolved: true };
		const { rerender } = renderHook(() => useAuthGuard());
		expect(replace).not.toHaveBeenCalled();

		authState = { user: null, authResolved: true };
		rerender();
		expect(replace).toHaveBeenCalledWith("/sign-in");
	});
});
