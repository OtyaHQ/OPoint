import { signInAction } from "./actions";

type LoginPageProps = { searchParams: Promise<{ error?: string; next?: string }> };

const messages: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  "staff-access": "Your account does not have a verified and active OtyaPoint staff profile. Contact an administrator.",
  "auth-not-configured": "Sign-in is not available right now. Please contact the workspace administrator.",
  "staff-lookup-unavailable": "Staff access could not be verified because the staff database is unavailable. Please contact the system administrator.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = params.error ? messages[params.error] : undefined;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#101b2b", color: "#f8fafc" }}>
      <section style={{ width: "100%", maxWidth: 420, border: "1px solid #334155", borderRadius: 20, padding: 28, background: "#172438" }}>
        <p style={{ color: "#a5b4fc", fontSize: 12, letterSpacing: 2, fontWeight: 700 }}>OTYAPOINT · STAFF ACCESS</p>
        <h1 style={{ fontSize: 30, margin: "12px 0 8px" }}>Sign in</h1>
        <p style={{ color: "#cbd5e1", marginBottom: 24 }}>Use your authorized OtyaPoint staff account.</p>
        {message && <p role="alert" style={{ color: "#fecaca", background: "#7f1d1d55", padding: 12, borderRadius: 8 }}>{message}</p>}
        <form action={signInAction} style={{ display: "grid", gap: 14 }}>
          <input type="hidden" name="next" value={params.next ?? "/"} />
          <label style={{ display: "grid", gap: 6 }}>Email
            <input name="email" type="email" autoComplete="username" required maxLength={254} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>Password
            <input name="password" type="password" autoComplete="current-password" required maxLength={1024} style={inputStyle} />
          </label>
          <button type="submit" style={{ border: 0, borderRadius: 10, padding: "12px 16px", fontWeight: 700, background: "#a5b4fc", color: "#101b2b", cursor: "pointer" }}>Sign in securely</button>
        </form>
        <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 20 }}>Access is limited to invited users with an active OtyaPoint staff membership. New staff cannot join through public sign-up.</p>
      </section>
    </main>
  );
}

const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: 12, borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
