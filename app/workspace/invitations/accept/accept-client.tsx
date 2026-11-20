"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

export default function AcceptStaffInvitation() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = token.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      setError("Enter the complete 64-character invitation code from your OtyaPoint email.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/otyapoint/workforce/invitations/accept", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: normalized }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (response.status === 401) {
        window.location.assign("/workspace/sign-in");
        return;
      }
      if (!response.ok) {
        const messages: Record<string, string> = {
          invitation_email_mismatch: "This invitation belongs to a different verified Otya Account email.",
          invitation_not_found_or_used: "This invitation is invalid, expired, revoked or has already been used.",
          verified_account_email_required: "Sign in using a verified Otya Account email before accepting.",
          invitation_scope_unavailable: "The company or branch in this invitation is no longer available.",
          company_membership_already_exists: "This Otya Account already has a membership in that company.",
        };
        throw new Error(messages[result.error || ""] || "The invitation could not be accepted.");
      }
      setAccepted(true);
      setToken("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={page}>
      <section style={card}>
        <div style={brandRow}><div style={mark}>O</div><div><div style={brand}>OtyaPoint</div><div style={subtitle}>STAFF INVITATION</div></div></div>
        <p style={eyebrow}>COMPANY WORKSPACE ACCESS</p>
        {accepted ? (
          <>
            <h1 style={heading}>Invitation accepted</h1>
            <p style={muted}>Your invitation has been accepted and your company membership is now pending. You will be able to access company operations only after an Owner or Administrator activates your membership.</p>
            <a href="/workspace" style={primaryLink}>Return to workspace</a>
          </>
        ) : (
          <>
            <h1 style={heading}>Accept your invitation</h1>
            <p style={muted}>Sign in with the verified Otya Account email address that received the invitation. Paste the one-time code from the OtyaPoint invitation email below.</p>
            {error && <div role="alert" style={errorBox}>{error}</div>}
            <form onSubmit={submit} style={form}>
              <label htmlFor="invitation-token" style={label}>Invitation code</label>
              <input
                id="invitation-token"
                type="text"
                required
                minLength={64}
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                pattern="[a-fA-F0-9]{64}"
                value={token}
                onChange={(event) => setToken(event.target.value.toLowerCase())}
                placeholder="Paste the 64-character invitation code"
                style={input}
              />
              <button type="submit" disabled={busy} style={primaryButton}>{busy ? "Verifying invitation…" : "Accept invitation"}</button>
            </form>
            <p style={footnote}>For security, an invitation can only be accepted by the verified Otya Account email address it was sent to. Acceptance does not activate staff access; the company Owner or Administrator must do that separately.</p>
          </>
        )}
        <a href="/workspace" style={secondaryLink}>Back to OtyaPoint</a>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0c1422", color: "#f0f4fa" };
const card: CSSProperties = { width: "100%", maxWidth: 480, border: "1px solid #243249", borderRadius: 20, padding: 30, background: "#111e30", boxShadow: "0 24px 80px #0004" };
const brandRow: CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 34 };
const mark: CSSProperties = { width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 13, background: "linear-gradient(145deg,#9c9aff,#6f75e9)", color: "white", fontSize: 22, fontWeight: 900 };
const brand: CSSProperties = { fontSize: 18, fontWeight: 900, letterSpacing: -0.5 };
const subtitle: CSSProperties = { fontSize: 9, letterSpacing: 1.4, color: "#8d9bb0", marginTop: 3 };
const eyebrow: CSSProperties = { fontSize: 10, letterSpacing: 1.5, color: "#a8b8ff", fontWeight: 800, marginBottom: 10 };
const heading: CSSProperties = { fontSize: 27, lineHeight: 1.2, letterSpacing: -0.8, marginBottom: 10 };
const muted: CSSProperties = { color: "#8d9bb0", lineHeight: 1.65, fontSize: 13, marginBottom: 24 };
const form: CSSProperties = { display: "grid", gap: 12 };
const label: CSSProperties = { fontSize: 11, fontWeight: 700, color: "#c5d0e1" };
const input: CSSProperties = { width: "100%", borderRadius: 9, border: "1px solid #33445f", background: "#0c1422", color: "#f0f4fa", padding: "13px 14px", fontSize: 12, outlineColor: "#a8b8ff" };
const primaryButton: CSSProperties = { border: 0, borderRadius: 9, padding: "13px 16px", background: "#8585fa", color: "#fff", fontWeight: 800, marginTop: 4, opacity: 1 };
const primaryLink: CSSProperties = { display: "block", textAlign: "center", textDecoration: "none", borderRadius: 9, padding: "13px 16px", background: "#8585fa", color: "#fff", fontWeight: 800, margin: "20px 0" };
const secondaryLink: CSSProperties = { display: "block", marginTop: 20, color: "#a8b8ff", textAlign: "center", fontSize: 12 };
const footnote: CSSProperties = { borderTop: "1px solid #243249", marginTop: 24, paddingTop: 16, color: "#62728a", fontSize: 10, lineHeight: 1.6 };
const errorBox: CSSProperties = { color: "#fecaca", background: "#7f1d1d33", border: "1px solid #991b1b66", borderRadius: 8, padding: 11, fontSize: 12, marginBottom: 12 };
