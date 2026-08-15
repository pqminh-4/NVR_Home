import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  noPadding,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  noPadding?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={cn(
              "relative w-full max-w-lg card-surface shadow-2xl max-h-[92vh] flex flex-col",
              wide && "max-w-3xl",
            )}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {title && (
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                <h2 className="text-sm font-semibold">{title}</h2>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-muted/70 transition-colors"
                  aria-label="Đóng"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className={cn("overflow-y-auto grow", !noPadding && "p-5")}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
