"use client";

import { useState, type FormEvent } from "react";

type LoginResult = {
  error?: string;
  code?: string;
  authenticated?: boolean;
};

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/otya/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email,
          password,
          ...(totpCode ? { totpCode } : {}),
          ...(recoveryCode ? { recoveryCode } : {}),
        }),
      });
      const result = await response.json().catch(() => ({})) as LoginResult;
      if (!response.ok) {
        const message = result.code === "TWO_FACTOR_REQUIRED"
          ? "Enter your authenticator code or a recovery code."
          : result.error || "Sign in could not be completed.";
        setError(message);
        return;
      }
      window.location.assign("/workforce");
    } catch {
      setError("The identity service is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {error ? <div className="message error" role="alert">{error}</div> : null}
      <div className="field">
        <label htmlFor="email">Otya Account email</label>
        <input
          className="input"
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={254}
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="name@example.com"
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Your Otya Account password"
        />
      </div>
      <div className="field">
        <label htmlFor="totp">Authenticator code (when enabled)</label>
        <input
          className="input"
          id="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          value={totpCode}
          onChange={event => setTotpCode(event.target.value)}
          disabled={useRecovery}
          placeholder="Optional 2-step code"
        />
      </div>
      <div className="field">
        <label htmlFor="recovery">Recovery code (alternative)</label>
        <input
          className="input"
          id="recovery"
          autoComplete="off"
          maxLength={128}
          value={recoveryCode}
          onChange={event => setRecoveryCode(event.target.value)}
          disabled={!useRecovery}
          placeholder="Use only when authenticator is unavailable"
        />
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={useRecovery}
          onChange={event => {
            setUseRecovery(event.target.checked);
            setTotpCode("");
            setRecoveryCode("");
          }}
        />
        Use a recovery code instead
      </label>
      <button className="button primary login-submit" type="submit" disabled={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? "Signing in…" : "Sign in securely"}
      </button>
    </form>
  );
}
