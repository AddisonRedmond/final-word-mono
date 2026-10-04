import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import Button from "./button";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  onClose?: () => void;
  /**
   * Optional content for the left side of the header row, placed across from
   * the Close button (e.g. a settings/toggle control for the modal's content).
   */
  headerLeft?: ReactNode;
}

const Modal = ({
  children,
  className = "",
  onClose,
  headerLeft,
  ...props
}: ModalProps) => {
  // Only render into a portal after mount so SSR (where `document` is
  // undefined) is skipped and hydration stays consistent.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!onClose) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        {...props}
        aria-modal="true"
        className={`relative flex h-dvh max-h-dvh w-full flex-col overflow-y-auto border border-gray-200 bg-white p-4 shadow-xl sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-lg sm:p-6 ${className}`}
        role="dialog"
      >
        <div className="my-2 flex w-full shrink-0 items-center justify-between gap-2">
          {/* Left slot (optional); keeps the Close button pinned right whether
              or not a left control is provided. */}
          <div className="flex items-center">{headerLeft}</div>
          <Button variant="red" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Grow to fill the dialog so full-screen mobile content (the duel
            board) can distribute its space — e.g. push the keyboard to the
            bottom. On sm+ the dialog is auto-height so this just wraps. */}
        <div className="flex min-h-0 w-full grow flex-col">{children}</div>
      </div>
    </motion.div>,
    document.body,
  );
};

export default Modal;
