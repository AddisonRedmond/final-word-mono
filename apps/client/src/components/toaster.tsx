import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";

import { useToastStore } from "@/state/toast-store";

const Toaster: React.FC = () => {
	const toasts = useToastStore((state) => state.toasts);
	const dismiss = useToastStore((state) => state.dismiss);

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-end gap-2 px-4 sm:inset-x-auto sm:right-4">
			<LazyMotion features={domAnimation} strict>
				<AnimatePresence initial={false}>
					{toasts.map((toast) => (
						<m.div
							animate={{ opacity: 1, x: 0, scale: 1 }}
							className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-md bg-green-400 px-4 py-2 font-semibold text-sm text-white shadow-lg"
							exit={{ opacity: 0, x: 16, scale: 0.96 }}
							initial={{ opacity: 0, x: 16, scale: 0.96 }}
							key={toast.id}
						>
							<span>{toast.message}</span>
							<button
								aria-label="Dismiss notification"
								className="-mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
								onClick={() => dismiss(toast.id)}
								type="button"
							>
								<svg
									aria-hidden="true"
									fill="none"
									height="14"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2.5"
									viewBox="0 0 24 24"
									width="14"
								>
									<path d="M18 6 6 18" />
									<path d="m6 6 12 12" />
								</svg>
							</button>
						</m.div>
					))}
				</AnimatePresence>
			</LazyMotion>
		</div>
	);
};

export default Toaster;
