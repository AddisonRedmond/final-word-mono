import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "./toast-store";

const current = () => useToastStore.getState().toasts;

describe("toast store", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useToastStore.setState({ toasts: [] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-dismisses a normal toast", () => {
		toast("hello");
		expect(current()).toHaveLength(1);
		vi.advanceTimersByTime(4000);
		expect(current()).toHaveLength(0);
	});

	it("keeps a loading toast until it is updated", () => {
		toast("working", { variant: "loading" });
		vi.advanceTimersByTime(60_000);
		expect(current()).toHaveLength(1);
	});

	it("update changes the same toast and restarts the dismiss timer", () => {
		const id = toast("working", { variant: "loading" });
		toast.update(id, "done", { variant: "success" });

		expect(current()).toHaveLength(1);
		expect(current()[0]).toMatchObject({
			id,
			message: "done",
			variant: "success",
		});

		vi.advanceTimersByTime(4000);
		expect(current()).toHaveLength(0);
	});

	it("update is a no-op once the toast was dismissed", () => {
		const id = toast("working", { variant: "loading" });
		toast.dismiss(id);
		toast.update(id, "done", { variant: "success" });
		expect(current()).toHaveLength(0);
	});
});

describe("toast.promise", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useToastStore.setState({ toasts: [] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows loading, then turns the same toast into the success message", async () => {
		let resolve!: (name: string) => void;
		const pending = new Promise<string>((r) => {
			resolve = r;
		});

		void toast.promise(pending, {
			loading: "Loading…",
			success: (name) => `${name} challenged you`,
			error: "Failed",
		});

		expect(current()).toHaveLength(1);
		const id = current()[0]?.id;
		expect(current()[0]).toMatchObject({
			message: "Loading…",
			variant: "loading",
		});

		resolve("Sam");
		await pending;
		await Promise.resolve();

		expect(current()).toHaveLength(1);
		expect(current()[0]).toMatchObject({
			id,
			message: "Sam challenged you",
			variant: "success",
		});
	});

	it("applies the requested variant and action to the success state", async () => {
		const done = Promise.resolve("Sam");
		void toast.promise(
			done,
			{ loading: "…", success: (n) => n, error: "x" },
			{ variant: "info", action: { label: "View", href: "/duels" } },
		);
		await done;
		await Promise.resolve();

		expect(current()[0]).toMatchObject({
			variant: "info",
			action: { label: "View", href: "/duels" },
		});
	});

	it("turns into an error toast when the promise rejects", async () => {
		const failed = Promise.reject(new Error("nope"));
		const handled = toast
			.promise(failed, { loading: "…", success: "ok", error: "Failed" })
			.catch(() => undefined);
		await handled;
		await Promise.resolve();

		expect(current()[0]).toMatchObject({ message: "Failed", variant: "error" });
	});

	it("does not bring back a loading toast the user dismissed", async () => {
		let resolve!: (v: string) => void;
		const pending = new Promise<string>((r) => {
			resolve = r;
		});
		void toast.promise(pending, {
			loading: "…",
			success: "done",
			error: "x",
		});
		toast.dismiss(current()[0]?.id as string);

		resolve("v");
		await pending;
		await Promise.resolve();

		expect(current()).toHaveLength(0);
	});
});
