"use client";

import type { LucideIcon } from "lucide-react";

/**
 * Placeholder pane for the features the assignment lets us stub out
 * (calls, stories, linked devices).
 */
export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-surface-active">
        <Icon size={32} className="text-text-secondary" />
      </div>
      <h2 className="text-[20px] font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-text-secondary">
        {description}
      </p>
      <span className="mt-5 rounded-full bg-surface-active px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
        Coming soon
      </span>
    </div>
  );
}
