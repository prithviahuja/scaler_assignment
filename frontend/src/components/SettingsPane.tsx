"use client";

import {
  Bell,
  ChevronRight,
  Laptop,
  Lock,
  LogOut,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { Button, Modal, TextField } from "@/components/ui/Modal";
import { AVATAR_COLORS, AVATAR_COLOR_NAMES } from "@/lib/avatar";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

type Pane = "profile" | "appearance" | "privacy" | "notifications" | "devices" | null;

/** Signal's settings list. Privacy/notifications/devices are placeholders. */
export function SettingsPane() {
  const me = useAppStore((state) => state.me);
  const setMe = useAppStore((state) => state.setMe);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const signOut = useAppStore((state) => state.signOut);
  const desktopNotifications = useAppStore((state) => state.desktopNotifications);
  const enableDesktopNotifications = useAppStore((state) => state.enableDesktopNotifications);
  const pushToast = useAppStore((state) => state.pushToast);

  const [pane, setPane] = useState<Pane>(null);
  const [draftName, setDraftName] = useState(me?.display_name ?? "");
  const [draftAbout, setDraftAbout] = useState(me?.about ?? "");
  const [draftColor, setDraftColor] = useState(me?.avatar_color ?? "ultramarine");
  const [saving, setSaving] = useState(false);

  if (!me) return null;

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProfile({
        display_name: draftName.trim(),
        about: draftAbout,
        avatar_color: draftColor,
      });
      setMe(updated);
      setPane(null);
      pushToast({ title: "Profile updated", tone: "default" });
    } catch (error) {
      pushToast({
        title: "Could not save profile",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="shrink-0 px-5 pb-2 pt-5">
        <h1 className="text-[20px] font-bold text-text-primary">Settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 scroll-thin">
        <button
          type="button"
          onClick={() => {
            setDraftName(me.display_name);
            setDraftAbout(me.about);
            setDraftColor(me.avatar_color);
            setPane("profile");
          }}
          className="mb-3 flex w-full items-center gap-4 rounded-xl px-3 py-4 text-left hover:bg-surface-hover"
        >
          <Avatar name={me.display_name} color={me.avatar_color} size="xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-text-primary">
              {me.display_name}
            </p>
            <p className="truncate text-[13.5px] text-text-secondary">
              {me.phone}
              {me.username ? ` · @${me.username}` : ""}
            </p>
            {me.about && (
              <p className="mt-0.5 truncate text-[13px] text-text-secondary">{me.about}</p>
            )}
          </div>
          <ChevronRight size={18} className="shrink-0 text-text-secondary" />
        </button>

        <SettingsGroup>
          <SettingsRow
            icon={<UserIcon size={18} />}
            label="Profile"
            value="Name, about, avatar"
            onClick={() => setPane("profile")}
          />
          <SettingsRow
            icon={theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
            label="Appearance"
            value={theme === "dark" ? "Dark" : "Light"}
            onClick={() => setPane("appearance")}
          />
          <SettingsRow
            icon={<Lock size={18} />}
            label="Privacy"
            value="Coming soon"
            onClick={() => setPane("privacy")}
          />
          <SettingsRow
            icon={<Bell size={18} />}
            label="Notifications"
            value={desktopNotifications ? "Desktop alerts on" : "Off"}
            onClick={() => setPane("notifications")}
          />
          <SettingsRow
            icon={<Laptop size={18} />}
            label="Linked devices"
            value="Coming soon"
            onClick={() => setPane("devices")}
          />
        </SettingsGroup>

        <div
          className="mt-4 flex items-start gap-3 rounded-xl bg-surface-input px-4 py-3.5"
          role="note"
        >
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-signal-blue" />
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            Messages in this build are <strong>not</strong> end-to-end encrypted. Encryption is
            simulated for the purposes of this assignment.
          </p>
        </div>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-4 flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[14px] font-semibold text-[#CF163E] hover:bg-surface-hover"
        >
          <LogOut size={18} /> Sign out
        </button>
      </div>

      {/* ---------------------------------------------------- profile modal */}
      <Modal
        open={pane === "profile"}
        title="Profile"
        description="This is how you appear to other people on Signal."
        onClose={() => setPane(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPane(null)}>
              Cancel
            </Button>
            <Button onClick={saveProfile} disabled={saving || !draftName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex justify-center py-2">
            <Avatar name={draftName || me.display_name} color={draftColor} size="xxl" />
          </div>
          <TextField
            label="Display name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            maxLength={120}
          />
          <TextField
            label="About"
            value={draftAbout}
            placeholder="A few words about yourself"
            onChange={(event) => setDraftAbout(event.target.value)}
            maxLength={255}
          />
          <div>
            <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
              Avatar colour
            </span>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLOR_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDraftColor(name)}
                  aria-label={name}
                  aria-pressed={draftColor === name}
                  className={clsx(
                    "h-8 w-8 rounded-full transition-transform",
                    draftColor === name && "scale-110 ring-2 ring-offset-2",
                  )}
                  style={{
                    backgroundColor: AVATAR_COLORS[name],
                    // @ts-expect-error -- CSS custom property for the ring colour
                    "--tw-ring-color": AVATAR_COLORS[name],
                    "--tw-ring-offset-color": "var(--surface)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* ------------------------------------------------- appearance modal */}
      <Modal
        open={pane === "appearance"}
        title="Appearance"
        onClose={() => setPane(null)}
        width="sm"
      >
        <div className="flex flex-col gap-2 pb-4">
          {(["light", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px]",
                theme === option
                  ? "bg-signal-blue text-white"
                  : "bg-surface-input text-text-primary hover:bg-surface-active",
              )}
            >
              {option === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              {option === "dark" ? "Dark" : "Light"}
              {theme === option && <span className="ml-auto text-[12px]">Active</span>}
            </button>
          ))}
          <p className="mt-2 flex items-center gap-2 text-[12.5px] text-text-secondary">
            <Palette size={14} /> Chat colours and wallpapers are coming soon.
          </p>
        </div>
      </Modal>

      {/* -------------------------------------------------- placeholder panes */}
      <Modal
        open={pane === "privacy" || pane === "notifications" || pane === "devices"}
        title={
          pane === "privacy"
            ? "Privacy"
            : pane === "notifications"
              ? "Notifications"
              : "Linked devices"
        }
        onClose={() => setPane(null)}
        width="sm"
      >
        <div className="flex flex-col gap-3 pb-5">
          {pane === "notifications" && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-input px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] text-text-primary">Desktop notifications</p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  Alerts for new messages while this tab is in the background.
                </p>
              </div>
              <Button
                variant={desktopNotifications ? "secondary" : "primary"}
                onClick={() => void enableDesktopNotifications()}
                disabled={desktopNotifications}
                className="shrink-0 px-4"
              >
                {desktopNotifications ? "Enabled" : "Enable"}
              </Button>
            </div>
          )}

          {(pane === "privacy"
            ? [
                "Read receipts",
                "Typing indicators",
                "Screen lock",
                "Disappearing messages default",
              ]
            : pane === "notifications"
              ? ["Sounds", "Notify when contacts join"]
              : ["Link a new device", "Manage linked devices"]
          ).map((item) => (
            <div
              key={item}
              className="flex items-center justify-between rounded-xl bg-surface-input px-4 py-3"
            >
              <span className="text-[14px] text-text-primary">{item}</span>
              <span className="rounded-full bg-surface-active px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                Soon
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl bg-surface-input">{children}</div>;
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-active"
      style={{ borderBottom: "1px solid var(--divider)" }}
    >
      <span className="shrink-0 text-text-secondary">{icon}</span>
      <span className="flex-1 text-[14px] text-text-primary">{label}</span>
      <span className="shrink-0 text-[13px] text-text-secondary">{value}</span>
      <ChevronRight size={16} className="shrink-0 text-text-secondary" />
    </button>
  );
}
