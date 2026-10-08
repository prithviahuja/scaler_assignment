"use client";

import { CircleDashed, MessageSquare, Phone, Settings } from "lucide-react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import type { User } from "@/lib/types";

export type NavTab = "chats" | "calls" | "stories" | "settings";

const TABS: { id: NavTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "stories", label: "Stories", icon: CircleDashed },
];

/** Signal Desktop's narrow left rail. */
export function NavRail({
  active,
  onChange,
  me,
  unreadTotal,
  socketOffline,
}: {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  me: User;
  unreadTotal: number;
  socketOffline: boolean;
}) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-16 shrink-0 flex-col items-center gap-1 bg-surface-raised py-3"
      style={{ borderRight: "1px solid var(--divider)" }}
    >
      {TABS.map((tab) => (
        <RailButton
          key={tab.id}
          label={tab.label}
          active={active === tab.id}
          badge={tab.id === "chats" ? unreadTotal : 0}
          onClick={() => onChange(tab.id)}
        >
          <tab.icon size={21} />
        </RailButton>
      ))}

      <div className="mt-auto flex flex-col items-center gap-2">
        {socketOffline && (
          <span
            title="Reconnecting to the server…"
            className="h-2 w-2 rounded-full bg-[#FFB800]"
            aria-label="Reconnecting"
          />
        )}
        <RailButton
          label="Settings"
          active={active === "settings"}
          badge={0}
          onClick={() => onChange("settings")}
        >
          <Settings size={21} />
        </RailButton>
        <button
          type="button"
          onClick={() => onChange("settings")}
          title={`${me.display_name} — profile`}
          aria-label="Your profile"
          className="mt-1 rounded-full ring-signal-blue transition-all hover:ring-2"
        >
          <Avatar name={me.display_name} color={me.avatar_color} size="sm" />
        </button>
      </div>
    </nav>
  );
}

function RailButton({
  label,
  active,
  badge,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  badge: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-surface-active text-text-primary"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
      )}
    >
      {children}
      {badge > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-blue px-1 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
