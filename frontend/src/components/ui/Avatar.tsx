"use client";

import clsx from "clsx";

import { avatarColor } from "@/lib/avatar";
import { initials } from "@/lib/format";

const SIZES = {
  xs: "h-[18px] w-[18px] text-[8px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-12 w-12 text-[15px]",
  xl: "h-20 w-20 text-[26px]",
  xxl: "h-28 w-28 text-[34px]",
} as const;

const DOT_SIZES = {
  xs: "h-2 w-2",
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
  xl: "h-4 w-4",
  xxl: "h-5 w-5",
} as const;

interface AvatarProps {
  name: string;
  color?: string | null;
  size?: keyof typeof SIZES;
  /** Groups get the people glyph instead of initials, as in Signal. */
  isGroup?: boolean;
  online?: boolean;
  className?: string;
}

/** A coloured tile with initials — Signal's default avatar. */
export function Avatar({
  name,
  color,
  size = "md",
  isGroup = false,
  online = false,
  className,
}: AvatarProps) {
  return (
    <div className={clsx("relative shrink-0", className)}>
      <div
        className={clsx(
          "flex items-center justify-center rounded-full font-semibold tracking-wide text-white select-none",
          SIZES[size],
        )}
        style={{ backgroundColor: avatarColor(color) }}
        aria-hidden
      >
        {isGroup ? <GroupGlyph /> : initials(name)}
      </div>
      {online && (
        <span
          className={clsx(
            "absolute bottom-0 right-0 rounded-full border-2 bg-[#01C650]",
            DOT_SIZES[size],
          )}
          style={{ borderColor: "var(--surface)" }}
          title="Online"
        />
      )}
    </div>
  );
}

function GroupGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[55%] w-[55%]">
      <path d="M9 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm0 1.5c-2.9 0-5.5 1.45-5.5 3.25V18a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.75C14.5 14.45 11.9 13 9 13Zm7.25-1.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Zm.25 1.5c-.73 0-1.42.1-2.03.29 1.1.84 1.78 1.95 1.78 3.21V19h3.25a1 1 0 0 0 1-1v-1.5c0-1.64-2.2-2.75-4-2.75Z" />
    </svg>
  );
}
