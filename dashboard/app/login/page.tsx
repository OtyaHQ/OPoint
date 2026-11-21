import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <div className="brand-name">Opoint</div>
            <div className="brand-sub">WORKFORCE OPERATIONS</div>
          </div>
        </div>
        <p className="eyebrow">SECURE COMPANY ACCESS</p>
        <h1 id="login-title">Sign in to your Otya Account</h1>
        <p className="login-intro">
          Use your Otya Account credentials. Staff access is granted by your company membership and approved work assignments.
        </p>
        <LoginForm />
        <p className="login-footnote">Opoint never stores your password in the workforce dashboard.</p>
      </section>
    </main>
  );
}
