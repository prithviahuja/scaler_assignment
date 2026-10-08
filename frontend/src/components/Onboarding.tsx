"use client";

import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { Button, TextField } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { AVATAR_COLORS, AVATAR_COLOR_NAMES, colorForSeed } from "@/lib/avatar";
import { useAppStore } from "@/store/useAppStore";

type Step = "phone" | "code" | "profile";

const DEMO_ACCOUNTS = [
  { phone: "+15550100001", name: "Prithvi Ahuja" },
  { phone: "+15550100002", name: "Aisha Khan" },
  { phone: "+15550100003", name: "Rohan Mehta" },
  { phone: "+15550100004", name: "Meera Iyer" },
];

/**
 * Signal's registration flow with the verification step mocked: the backend
 * returns the fixed code, which we prefill so the demo stays one click deep.
 */
export function Onboarding() {
  const signIn = useAppStore((state) => state.signIn);
  const pushToast = useAppStore((state) => state.pushToast);

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [registered, setRegistered] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [about, setAbout] = useState("");
  const [color, setColor] = useState("ultramarine");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (caught: unknown, fallback: string) => {
    const message = caught instanceof Error ? caught.message : fallback;
    setError(message);
    pushToast({ title: message, tone: "error" });
  };

  const startVerification = async (value: string) => {
    const target = value.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.startVerification(target);
      setPhone(result.phone);
      setRegistered(result.registered);
      setCode(result.dev_code); // mocked verification
      setStep("code");
    } catch (caught) {
      fail(caught, "Could not start verification");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      if (registered) {
        const result = await api.login(phone, code.trim());
        await signIn(result.access_token, result.user);
      } else {
        setColor(colorForSeed(phone));
        setStep("profile");
      }
    } catch (caught) {
      fail(caught, "That code did not work");
    } finally {
      setBusy(false);
    }
  };

  const completeRegistration = async () => {
    const name = displayName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.register({
        phone,
        code: code.trim(),
        display_name: name,
        username: username.trim().replace(/^@/, "") || null,
        about,
        avatar_color: color,
      });
      await signIn(result.access_token, result.user);
    } catch (caught) {
      fail(caught, "Could not create your account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-signal-blue">
            <Lock size={28} className="text-white" />
          </div>
          <h1 className="text-[26px] font-bold text-text-primary">Signal</h1>
          <p className="mt-1.5 text-[14px] text-text-secondary">
            Private messaging. Fast, simple, secure.
          </p>
        </div>

        <div
          className="rounded-2xl bg-surface p-6 shadow-sm"
          style={{ border: "1px solid var(--divider)" }}
        >
          {step === "phone" && (
            <>
              <h2 className="text-[18px] font-semibold text-text-primary">
                Enter your phone number
              </h2>
              <p className="mb-5 mt-1 text-[13.5px] text-text-secondary">
                Signal will send you a verification code.
              </p>
              <TextField
                label="Phone number"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+15550100001"
                autoFocus
                onKeyDown={(event) => event.key === "Enter" && startVerification(phone)}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <Button
                onClick={() => startVerification(phone)}
                disabled={busy || !phone.trim()}
                className="mt-5 w-full"
              >
                {busy ? "Sending…" : "Continue"}
              </Button>

              <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--divider)" }}>
                <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
                  Demo accounts
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.phone}
                      type="button"
                      disabled={busy}
                      onClick={() => startVerification(account.phone)}
                      className="flex items-center gap-2 rounded-lg bg-surface-input px-2.5 py-2 text-left hover:bg-surface-active disabled:opacity-60"
                    >
                      <Avatar
                        name={account.name}
                        color={colorForSeed(account.name)}
                        size="sm"
                      />
                      <span className="min-w-0 truncate text-[12.5px] text-text-primary">
                        {account.name}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-text-secondary">
                  Open two in separate browsers to see real-time messaging.
                </p>
              </div>
            </>
          )}

          {step === "code" && (
            <>
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="mb-4 flex items-center gap-1.5 text-[13.5px] text-signal-blue hover:underline"
              >
                <ArrowLeft size={15} /> Back
              </button>
              <h2 className="text-[18px] font-semibold text-text-primary">
                Verify {phone}
              </h2>
              <p className="mb-5 mt-1 text-[13.5px] text-text-secondary">
                {registered
                  ? "Welcome back. Enter your code to sign in."
                  : "Enter the code we sent you to continue."}
              </p>
              <TextField
                label="Verification code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus
                className="text-center text-[22px] font-semibold tracking-[0.5em]"
                onKeyDown={(event) => event.key === "Enter" && submitCode()}
              />
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-text-secondary">
                <ShieldCheck size={14} className="text-signal-blue" />
                Verification is mocked — the code is always <strong>123456</strong>.
              </p>
              {error && <ErrorText>{error}</ErrorText>}
              <Button
                onClick={submitCode}
                disabled={busy || code.trim().length < 6}
                className="mt-5 w-full"
              >
                {busy ? "Verifying…" : registered ? "Sign in" : "Verify"}
              </Button>
            </>
          )}

          {step === "profile" && (
            <>
              <button
                type="button"
                onClick={() => setStep("code")}
                className="mb-4 flex items-center gap-1.5 text-[13.5px] text-signal-blue hover:underline"
              >
                <ArrowLeft size={15} /> Back
              </button>
              <h2 className="text-[18px] font-semibold text-text-primary">Profile</h2>
              <p className="mb-5 mt-1 text-[13.5px] text-text-secondary">
                Your name and photo will be shown to people you message.
              </p>

              <div className="mb-5 flex justify-center">
                <Avatar name={displayName || "You"} color={color} size="xxl" />
              </div>

              <div className="flex flex-col gap-4">
                <TextField
                  label="Display name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name"
                  autoFocus
                  maxLength={120}
                />
                <TextField
                  label="Username (optional)"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="@yourname"
                  maxLength={64}
                />
                <TextField
                  label="About (optional)"
                  value={about}
                  onChange={(event) => setAbout(event.target.value)}
                  placeholder="A few words about yourself"
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
                        onClick={() => setColor(name)}
                        aria-label={name}
                        aria-pressed={color === name}
                        className={clsx(
                          "h-7 w-7 rounded-full transition-transform",
                          color === name && "scale-110 ring-2 ring-signal-blue ring-offset-2",
                        )}
                        style={{
                          backgroundColor: AVATAR_COLORS[name],
                          // @ts-expect-error -- CSS custom property
                          "--tw-ring-offset-color": "var(--surface)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {error && <ErrorText>{error}</ErrorText>}
              <Button
                onClick={completeRegistration}
                disabled={busy || !displayName.trim()}
                className="mt-5 w-full"
              >
                {busy ? "Creating account…" : "Finish"}
              </Button>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-text-secondary">
          This is a portfolio clone of Signal built for an assignment. Messages are stored in
          plain text; end-to-end encryption is simulated.
        </p>
      </div>
    </main>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 text-[13px] text-[#CF163E]">
      {children}
    </p>
  );
}
