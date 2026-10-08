"use client";

import { AlertCircle, MessageSquare, X } from "lucide-react";
import clsx from "clsx";

import { useAppStore } from "@/store/useAppStore";

/** In-app notifications, stacked top-centre like Signal Desktop's banners. */
export function Toaster() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  if (!toasts.length) return null;

  return (
    // Bottom-right so a notification never covers the conversation header.
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={clsx(
            "pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl px-4 py-3 shadow-xl",
            toast.tone === "error" ? "bg-[#CF163E] text-white" : "bg-[#2E2E2E] text-white",
          )}
        >
          <span className="mt-0.5 shrink-0">
            {toast.tone === "error" ? <AlertCircle size={17} /> : <MessageSquare size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 line-clamp-2 text-[12px] opacity-85">{toast.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded-full p-1 hover:bg-white/15"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
