import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error";

export type Toast = {
	id: string;
	message: string;
	variant: ToastVariant;
};

type ToastState = {
	toasts: Toast[];
	push: (
		message: string,
		variant?: ToastVariant,
		durationMs?: number,
	) => string;
	dismiss: (id: string) => void;
};

const DEFAULT_DURATION_MS = 4000;

export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	push: (message, variant = "info", durationMs = DEFAULT_DURATION_MS) => {
		const id =
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

		set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));

		if (durationMs > 0) {
			setTimeout(() => {
				get().dismiss(id);
			}, durationMs);
		}

		return id;
	},
	dismiss: (id) =>
		set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Imperative helper so non-component code (event handlers, callbacks) can raise
 * a toast without reading the hook. Mirrors the ergonomics of libraries like
 * sonner's `toast(...)`.
 */
export const toast = (
	message: string,
	variant?: ToastVariant,
	durationMs?: number,
) => useToastStore.getState().push(message, variant, durationMs);
