import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error" | "loading";

/**
 * Optional call-to-action rendered as a link inside the toast (e.g. a duel
 * notification linking to the /duels page).
 */
export type ToastAction = {
	label: string;
	href: string;
};

export type Toast = {
	id: string;
	message: string;
	variant: ToastVariant;
	action?: ToastAction;
};

export type ToastOptions = {
	variant?: ToastVariant;
	durationMs?: number;
	action?: ToastAction;
};

type ToastState = {
	toasts: Toast[];
	push: (message: string, options?: ToastOptions) => string;
	/**
	 * Change an existing toast in place (message, variant, action) and restart
	 * its auto-dismiss timer. No-op if the toast was already dismissed, so a
	 * finished task never resurrects a toast the user closed.
	 */
	update: (id: string, message: string, options?: ToastOptions) => void;
	dismiss: (id: string) => void;
};

const DEFAULT_DURATION_MS = 4000;

// Auto-dismiss timers by toast id, so `update` can restart one and `dismiss`
// can cancel it.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const clearTimer = (id: string) => {
	const timer = timers.get(id);
	if (timer !== undefined) {
		clearTimeout(timer);
		timers.delete(id);
	}
};

export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	push: (message, options = {}) => {
		const {
			variant = "info",
			// A loading toast stays until it's updated or dismissed.
			durationMs = variant === "loading" ? 0 : DEFAULT_DURATION_MS,
			action,
		} = options;

		const id =
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

		set((state) => ({
			toasts: [...state.toasts, { id, message, variant, action }],
		}));

		if (durationMs > 0) {
			timers.set(
				id,
				setTimeout(() => {
					get().dismiss(id);
				}, durationMs),
			);
		}

		return id;
	},
	update: (id, message, options = {}) => {
		if (!get().toasts.some((t) => t.id === id)) {
			return;
		}
		const {
			variant = "info",
			durationMs = variant === "loading" ? 0 : DEFAULT_DURATION_MS,
			action,
		} = options;
		set((state) => ({
			toasts: state.toasts.map((t) =>
				t.id === id ? { ...t, message, variant, action } : t,
			),
		}));
		clearTimer(id);
		if (durationMs > 0) {
			timers.set(
				id,
				setTimeout(() => {
					get().dismiss(id);
				}, durationMs),
			);
		}
	},
	dismiss: (id) => {
		clearTimer(id);
		set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
	},
}));

type PromiseMessages<T> = {
	/** Shown (with a spinner) while the promise is pending. */
	loading: string;
	success: string | ((data: T) => string);
	error: string | ((error: unknown) => string);
};

const resolveMessage = <A,>(message: string | ((arg: A) => string), arg: A) =>
	typeof message === "function" ? message(arg) : message;

/**
 * Show a loading toast, then turn the SAME toast into a success or error toast
 * when the promise settles (like shadcn/sonner's `toast.promise`).
 * `options.variant` and `options.action` apply to the success state; the error
 * state is always the "error" variant. Returns the original promise, so callers
 * can still await it.
 */
const promiseToast = <T,>(
	promise: Promise<T>,
	messages: PromiseMessages<T>,
	options: ToastOptions = {},
): Promise<T> => {
	const id = useToastStore
		.getState()
		.push(messages.loading, { variant: "loading" });

	promise.then(
		(data) =>
			useToastStore
				.getState()
				.update(id, resolveMessage(messages.success, data), {
					variant: options.variant ?? "success",
					action: options.action,
					durationMs: options.durationMs,
				}),
		(error: unknown) =>
			useToastStore
				.getState()
				.update(id, resolveMessage(messages.error, error), {
					variant: "error",
					durationMs: options.durationMs,
				}),
	);

	return promise;
};

/**
 * Imperative helper so non-component code (event handlers, callbacks) can raise
 * a toast without reading the hook. Mirrors the ergonomics of libraries like
 * sonner's `toast(...)`.
 */
const toastFn = (message: string, options?: ToastOptions) =>
	useToastStore.getState().push(message, options);

export const toast = Object.assign(toastFn, {
	promise: promiseToast,
	update: (id: string, message: string, options?: ToastOptions) =>
		useToastStore.getState().update(id, message, options),
	dismiss: (id: string) => useToastStore.getState().dismiss(id),
});
