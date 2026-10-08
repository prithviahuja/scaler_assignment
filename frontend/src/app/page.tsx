"use client";

import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { Onboarding } from "@/components/Onboarding";
import { useAppStore } from "@/store/useAppStore";

/**
 * Single entry point: restore the session from the stored token, then render
 * either the onboarding flow or the app shell.
 */
export default function HomePage() {
  const authStatus = useAppStore((state) => state.authStatus);
  const bootstrap = useAppStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (authStatus === "loading") return <SplashScreen />;
  if (authStatus === "anonymous") return <Onboarding />;
  return <AppShell />;
}

function SplashScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-surface-active border-t-signal-blue" />
        <p className="text-[13px] text-text-secondary">Loading your chats…</p>
      </div>
    </div>
  );
}
