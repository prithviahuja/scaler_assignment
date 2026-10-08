"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import clsx from "clsx";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTHS = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" } as const;

/** Signal's dialogs: centred card, dimmed backdrop, Escape to dismiss. */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "md",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "relative z-10 w-full overflow-hidden rounded-xl bg-surface shadow-2xl",
          WIDTHS[width],
        )}
        style={{ border: "1px solid var(--divider)" }}
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
            {description && (
              <p className="mt-1 text-[13px] text-text-secondary">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-full p-2 text-text-secondary hover:bg-surface-hover"
          >
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto px-5 pb-2 scroll-thin">{children}</div>
        {footer && (
          <footer
            className="flex justify-end gap-2 px-5 py-4"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-signal-blue text-white hover:bg-signal-blue-hover",
    secondary: "bg-surface-active text-text-primary hover:bg-surface-hover",
    danger: "bg-[#CF163E] text-white hover:bg-[#AC1133]",
    ghost: "text-signal-blue hover:bg-surface-hover",
  }[variant];

  return (
    <button
      {...props}
      className={clsx(
        "rounded-full px-5 py-2 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
      )}
      <input
        {...props}
        className={clsx(
          "w-full rounded-lg bg-surface-input px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-signal-blue",
          className,
        )}
      />
      {hint && <span className="mt-1.5 block text-[12px] text-text-secondary">{hint}</span>}
    </label>
  );
}
