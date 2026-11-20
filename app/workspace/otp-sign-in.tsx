"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

export default function OtyaOtpSignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/otyapoint/auth/otp/request", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Sign-in code request failed.");
      setStep("code");
      setNotice("Check your inbox for a sign-in code. For security, this message is the same whether or not an eligible account exists.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/otyapoint/auth/otp/verify", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: code.trim().toUpperCase() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The code is invalid or expired.");
      window.location.assign("/workspace");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify the sign-in code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={page}>
      <section style={card}>
        <div style={brandRow}>
          <div style={mark}>O</div>
          <div>
            <div style={brand}>OtyaPoint</div>
            <div style={subtitle}>BUSINESS WORKSPACE</div>
          </div>
        </div>
        <p style={eyebrow}>SECURE STAFF ACCESS</p>
        <h1 style={heading}>Sign in to your workspace</h1>
        <p style={muted}>Use your verified Otya Account email. We will send a one-time sign-in code; no Telegram login or separate staff password is required.</p>

        {error && <p role="alert" style={errorBox}>{error}</p>}
        {notice && <p role="status" style={noticeBox}>{notice}</p>}

        {step === "email" ? (
          <form onSubmit={requestCode} style={form}>
            <label style={label} htmlFor="otya-email">Email address</label>
            <input
              id="otya-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              style={input}
            />
            <button type="submit" disabled={busy} style={primaryButton}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} style={form}>
            <div style={address}>{email}</div>
            <label style={label} htmlFor="otya-code">One-time code</label>
            <input
              id="otya-code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              required
              minLength={5}
              maxLength={5}
              pattern="[A-HJ-NP-Z][0-9]{4}"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="A1234"
              style={{ ...input, letterSpacing: 5, fontSize: 20, textAlign: "center", fontWeight: 800 }}
            />
            <button type="submit" disabled={busy} style={primaryButton}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
            <button type="button" disabled={busy} style={secondaryButton} onClick={() => { setStep("email"); setCode(""); setNotice(""); setError(""); }}>
              Use a different email
            </button>
          </form>
        )}
        <div style={footnote}>Codes expire after 10 minutes. Never share your sign-in code with anyone.</div>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0c1422", color: "#f0f4fa" };
const card: CSSProperties = { width: "100%", maxWidth: 440, border: "1px solid #243249", borderRadius: 20, padding: 30, background: "#111e30", boxShadow: "0 24px 80px #0004" };
const brandRow: CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 34 };
const mark: CSSProperties = { width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 13, background: "linear-gradient(145deg,#9c9aff,#6f75e9)", color: "white", fontSize: 22, fontWeight: 900 };
const brand: CSSProperties = { fontSize: 18, fontWeight: 900, letterSpacing: -0.5 };
const subtitle: CSSProperties = { fontSize: 9, letterSpacing: 1.4, color: "#8d9bb0", marginTop: 3 };
const eyebrow: CSSProperties = { fontSize: 10, letterSpacing: 1.5, color: "#a8b8ff", fontWeight: 800, marginBottom: 10 };
const heading: CSSProperties = { fontSize: 27, lineHeight: 1.2, letterSpacing: -0.8, marginBottom: 10 };
const muted: CSSProperties = { color: "#8d9bb0", lineHeight: 1.65, fontSize: 13, marginBottom: 24 };
const form: CSSProperties = { display: "grid", gap: 12 };
const label: CSSProperties = { fontSize: 11, fontWeight: 700, color: "#c5d0e1" };
const input: CSSProperties = { width: "100%", borderRadius: 9, border: "1px solid #33445f", background: "#0c1422", color: "#f0f4fa", padding: "13px 14px", fontSize: 14, outlineColor: "#a8b8ff" };
const primaryButton: CSSProperties = { border: 0, borderRadius: 9, padding: "13px 16px", background: "#8585fa", color: "#fff", fontWeight: 800, marginTop: 4, opacity: 1 };
const secondaryButton: CSSProperties = { border: "1px solid #33445f", borderRadius: 9, padding: "12px 16px", background: "transparent", color: "#c5d0e1", fontWeight: 700 };
const address: CSSProperties = { color: "#a8b8ff", fontSize: 12, fontWeight: 700, padding: "10px 12px", border: "1px solid #33445f", borderRadius: 8, background: "#0c1422" };
const footnote: CSSProperties = { borderTop: "1px solid #243249", marginTop: 24, paddingTop: 16, color: "#62728a", fontSize: 10, lineHeight: 1.6 };
const errorBox: CSSProperties = { color: "#fecaca", background: "#7f1d1d33", border: "1px solid #991b1b66", borderRadius: 8, padding: 11, fontSize: 12, marginBottom: 12 };
const noticeBox: CSSProperties = { color: "#c7d2fe", background: "#6366f11c", border: "1px solid #6366f155", borderRadius: 8, padding: 11, fontSize: 12, lineHeight: 1.5, marginBottom: 12 };
