import { useEffect, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import Button from "./button";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  onClose?: () => void;
}

const Modal = ({ children, className = "", onClose, ...props }: ModalProps) => {
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        {...props}
        aria-modal="true"
        className={`relative w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl ${className}`}
        role="dialog"
      >
        <div className="w-full flex justify-end-safe my-2">
          <Button variant="red" onClick={onClose}>
            Close
          </Button>
        </div>

        {children}
      </div>
    </motion.div>
  );
};

export default Modal;
