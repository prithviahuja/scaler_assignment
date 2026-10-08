/** Timestamp and label formatting, matching how Signal labels things. */

import { format, isThisWeek, isToday, isYesterday } from "date-fns";

/** Timestamps are stored UTC-naive-aware; `Date` handles the ISO offset. */
function toDate(value: string): Date {
  // SQLite round-trips without a timezone suffix in some rows; assume UTC.
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/** Right-hand side of a conversation list row. */
export function formatListTimestamp(value: string): string {
  const date = toDate(value);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  if (isThisWeek(date)) return format(date, "EEE");
  return format(date, "MM/dd/yy");
}

/** Inside a message bubble. */
export function formatBubbleTimestamp(value: string): string {
  return format(toDate(value), "h:mm a");
}

/** The sticky date divider between groups of messages. */
export function formatDateDivider(value: string): string {
  const date = toDate(value);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisWeek(date)) return format(date, "EEEE");
  return format(date, "MMMM d, yyyy");
}

export function sameDay(a: string, b: string): boolean {
  const left = toDate(a);
  const right = toDate(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** "Online" / "Last seen 4 minutes ago" subtitle under a contact's name. */
export function formatPresence(user: { is_online: boolean; last_seen_at: string }): string {
  if (user.is_online) return "Online";
  const seen = toDate(user.last_seen_at);
  const minutes = Math.floor((Date.now() - seen.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "Offline";
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Last seen ${format(seen, "MMM d")}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** File sizes on attachment chips: 480 B, 1.4 MB, … */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Human label for the disappearing-messages timer. */
export function formatTimer(seconds: number): string {
  if (!seconds) return "Off";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

/** Preview line in the conversation list. */
export function messagePreview(
  message: { kind: string; body: string; deleted_at: string | null; attachment_name: string | null },
  senderLabel?: string,
): string {
  let text: string;
  if (message.deleted_at) text = "This message was deleted";
  else if (message.kind === "image") text = "📷 Photo";
  else if (message.kind === "audio") text = "🎤 Voice message";
  else if (message.kind === "file") text = `📎 ${message.attachment_name ?? "Attachment"}`;
  else text = message.body;

  if (message.kind === "system") return text;
  return senderLabel ? `${senderLabel}: ${text}` : text;
}
