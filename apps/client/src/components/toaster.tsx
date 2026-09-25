import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";

import { type ToastVariant, useToastStore } from "@/state/toast-store";

const variantClasses: Record<ToastVariant, string> = {
	info: "bg-stone-800 text-white",
	success: "bg-emerald-500 text-white",
	error: "bg-red-500 text-white",
};

const Toaster: React.FC = () => {
	const toasts = useToastStore((state) => state.toasts);
	const dismiss = useToastStore((state) => state.dismiss);

	return (
		<div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
			<LazyMotion features={domAnimation} strict>
				<AnimatePresence initial={false}>
					{toasts.map((toast) => (
						<m.button
							animate={{ opacity: 1, y: 0, scale: 1 }}
							className={`pointer-events-auto max-w-sm rounded-md px-4 py-2 text-center font-semibold text-sm shadow-lg ${variantClasses[toast.variant]}`}
							exit={{ opacity: 0, y: -16, scale: 0.96 }}
							initial={{ opacity: 0, y: -16, scale: 0.96 }}
							key={toast.id}
							onClick={() => dismiss(toast.id)}
							type="button"
						>
							{toast.message}
						</m.button>
					))}
				</AnimatePresence>
			</LazyMotion>
		</div>
	);
};

export default Toaster;
