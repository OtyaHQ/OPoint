"use client";

import {
  Activity,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Identity = { userId: string; email: string | null; emailVerified: boolean };
type Membership = {
  membership_id: string;
  company_id: string;
  branch_id: string | null;
  display_name: string;
  email: string | null;
  role_key: string;
  status: "ACTIVE";
  company_slug: string;
  company_name: string;
  company_status: string;
  branch_name: string | null;
};
type PendingMembership = {
  membership_id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  display_name: string;
  email: string | null;
  role_key: string;
  status: "PENDING";
  created_at: string;
};
type Staff = {
  membership_id: string;
  display_name: string;
  email: string | null;
  role_key: string;
  membership_status: string;
  branch_id: string | null;
  branch_name: string | null;
  employee_number: string | null;
  employment_type: string | null;
  employment_status: string | null;
  position_title: string | null;
  department_name: string | null;
};
type Branch = { id: string; name: string; branch_code: string; district?: string | null; status: string };
type Invitation = {
  id: string;
  email: string;
  display_name: string;
  branch_id: string | null;
  branch_name: string | null;
  role_key: string;
  status: string;
  delivery_status: string;
  expires_at: string;
  created_at: string;
};
type Assignment = {
  id: string;
  company_name?: string;
  staff_membership_id: string;
  display_name: string;
  email: string | null;
  branch_id: string;
  branch_name: string;
  work_area: string;
  duty_role: string;
  status: string;
  reason: string;
};

type ApiEnvelope<T> = { data?: T; error?: string; message?: string; invitation?: Record<string, unknown> };
type SessionEnvelope = {
  authenticated?: boolean;
  identity?: Identity;
  memberships?: Membership[];
  pendingMemberships?: PendingMembership[];
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

async function getView<T>(view: string, companyId?: string, branchId?: string): Promise<T> {
  const query = new URLSearchParams({ view });
  if (companyId) query.set("companyId", companyId);
  if (branchId) query.set("branchId", branchId);
  const response = await fetch("/api/otya/workforce?" + query.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const result = await readJson<ApiEnvelope<T>>(response);
  if (!response.ok) throw new Error(result.error || "workforce_request_failed");
  return (result.data ?? []) as T;
}

async function postAction<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/otya/workforce", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const result = await readJson<ApiEnvelope<T>>(response);
  if (!response.ok) throw new Error(result.error || "workforce_action_failed");
  return (result.data ?? result) as T;
}

function displayDate(value?: string | null): string {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleDateString();
}

function statusTone(status?: string): string {
  if (status === "ACTIVE" || status === "SENT") return "badge green";
  if (status === "PENDING" || status === "SUSPENDED" || status === "FAILED") return "badge amber";
  if (status === "REVOKED" || status === "EXPIRED") return "badge red";
  return "badge";
}

export default function WorkforcePortal() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [pendingMemberships, setPendingMemberships] = useState<PendingMembership[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [tab, setTab] = useState<"staff" | "invitations" | "assignments">("staff");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [myAssignments, setMyAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("AGENT");
  const [inviteBranch, setInviteBranch] = useState("");

  const [assignmentStaff, setAssignmentStaff] = useState("");
  const [assignmentBranch, setAssignmentBranch] = useState("");
  const [assignmentArea, setAssignmentArea] = useState("RETAIL");
  const [assignmentDuty, setAssignmentDuty] = useState("OPERATOR");
  const [reason, setReason] = useState("Reviewed by company administrator");

  const [inviteToken, setInviteToken] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);

  const activeMembership = useMemo(
    () => memberships.find(item => item.company_id === companyId) ?? memberships[0] ?? null,
    [memberships, companyId],
  );
  const isPrivileged = activeMembership?.role_key === "OWNER" || activeMembership?.role_key === "ADMIN";
  const isOwner = activeMembership?.role_key === "OWNER";
  const assignableStaff = staff.filter(item => item.membership_status === "ACTIVE" && !["OWNER", "ADMIN"].includes(item.role_key));

  async function loadSession() {
    const response = await fetch("/api/otya/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const result = await readJson<SessionEnvelope>(response);
    if (!response.ok) throw new Error(result.error || "session_unavailable");
    if (result.authenticated !== true || !result.identity) {
      router.replace("/login");
      return null;
    }
    setIdentity(result.identity);
    setMemberships(result.memberships ?? []);
    setPendingMemberships(result.pendingMemberships ?? []);
    if (!companyId && result.memberships?.length) setCompanyId(result.memberships[0].company_id);
    return result;
  }

  async function refreshData() {
    if (!activeMembership) return;
    setRefreshing(true);
    setError("");
    try {
      const company = activeMembership.company_id;
      const branch = branchFilter || undefined;
      const branchRows = await getView<Branch[]>("branches", company);
      setBranches(branchRows);
      if (isPrivileged) {
        const [staffRows, invitationRows, assignmentRows] = await Promise.all([
          getView<Staff[]>("staff", company, branch),
          getView<Invitation[]>("invitations", company),
          getView<Assignment[]>("assignments", company, branch),
        ]);
        setStaff(staffRows);
        setInvitations(invitationRows);
        setAssignments(assignmentRows);
        if (!assignmentStaff && staffRows.length) setAssignmentStaff(staffRows.find(row => row.membership_status === "ACTIVE" && !["OWNER", "ADMIN"].includes(row.role_key))?.membership_id ?? "");
        if (!assignmentBranch && branchRows.length) setAssignmentBranch(branchRows[0].id);
      } else {
        const own = await getView<Assignment[]>("my-assignments");
        setMyAssignments(own);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "workforce_data_unavailable");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await loadSession();
        if (!active) return;
        if (!result?.memberships?.length) {
          setLoading(false);
          return;
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "session_unavailable");
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (activeMembership) void refreshData();
    // Company and branch filters determine the server-side data scope.
  }, [companyId, branchFilter, identity?.userId]);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/otya/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
    } finally {
      router.replace("/login");
    }
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMembership) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await postAction<{ id?: string; deliveryStatus?: string }>({
        action: "create-invitation",
        companyId: activeMembership.company_id,
        email: inviteEmail,
        displayName: inviteName,
        roleKey: inviteRole,
        ...(inviteBranch ? { branchId: inviteBranch } : {}),
      });
      setNotice(result.deliveryStatus === "SENT"
        ? "Invitation created and email accepted by Otya Auth."
        : "Invitation record created; email delivery needs review.");
      setInviteEmail("");
      setInviteName("");
      await refreshData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invitation_create_failed");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(item: Invitation) {
    if (!activeMembership) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction({
        action: "revoke-invitation",
        companyId: activeMembership.company_id,
        invitationId: item.id,
        reason: "Invitation revoked by company administrator",
      });
      setNotice("Invitation revoked.");
      await refreshData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invitation_revoke_failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeMembership(item: Staff, status: "ACTIVE" | "SUSPENDED" | "REVOKED") {
    if (!activeMembership) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction({
        action: "membership-status",
        companyId: activeMembership.company_id,
        membershipId: item.membership_id,
        status,
        reason: reason.trim() || "Reviewed by company administrator",
      });
      setNotice("Staff membership updated. Previous work assignments are not silently restored.");
      await refreshData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "membership_update_failed");
    } finally {
      setBusy(false);
    }
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMembership) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction({
        action: "create-assignment",
        companyId: activeMembership.company_id,
        staffMembershipId: assignmentStaff,
        branchId: assignmentBranch,
        workArea: assignmentArea,
        dutyRole: assignmentDuty,
        reason,
      });
      setNotice("Branch work assignment created.");
      await refreshData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "assignment_create_failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateAssignment(item: Assignment, status: "ACTIVE" | "SUSPENDED" | "REVOKED") {
    if (!activeMembership) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction({
        action: "assignment-status",
        companyId: activeMembership.company_id,
        assignmentId: item.id,
        status,
        reason: reason.trim() || "Reviewed by company administrator",
      });
      setNotice("Work assignment updated.");
      await refreshData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "assignment_update_failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendVerification() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/otya/auth/email-verification", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const result = await readJson<{ error?: string; message?: string }>(response);
      if (!response.ok) throw new Error(result.error || "email_verification_send_failed");
      setVerificationSent(true);
      setNotice(result.message || "A verification code was sent to your Otya Account email.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "email_verification_send_failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/otya/auth/email-verification", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", otp: verificationCode }),
      });
      const result = await readJson<{ error?: string; emailVerified?: boolean }>(response);
      if (!response.ok) throw new Error(result.error || "email_verification_failed");
      await loadSession();
      setNotice(result.emailVerified ? "Otya Account email verified." : "Email verification was accepted; checking account status.");
      setVerificationCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "email_verification_failed");
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postAction({ action: "accept-invitation", token: inviteToken });
      setInviteToken("");
      setNotice("Invitation accepted. Your company owner or administrator must activate your membership before operational access is available.");
      await loadSession();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invitation_acceptance_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="login-shell"><div className="panel"><span className="spinner" /> Loading your Opoint workspace…</div></main>;
  }

  if (!identity) {
    return <main className="login-shell"><section className="login-card"><h1>Opoint Workforce</h1><p className="login-intro">Your session could not be loaded. Sign in again to continue.</p><button className="button primary" onClick={() => router.replace("/login")}>Go to sign in</button></section></main>;
  }

  if (!memberships.length) {
    return (
      <main className="login-shell">
        <section className="login-card onboarding-card">
          <div className="brand">
            <div className="brand-mark"><img src="https://assets.otya.site/brand/otya/v4/otya-master-icon-512.webp" alt="Otya" width={38} height={38} /></div>
            <div><div className="brand-name">Opoint</div><div className="brand-sub">BY OTYA · WORKFORCE ONBOARDING</div></div>
          </div>
          <p className="eyebrow">ACCOUNT CONNECTED</p>
          <h1>Complete your company access</h1>
          <p className="login-intro">Signed in as <strong>{identity.email ?? identity.userId}</strong>. Company access appears after an owner or administrator invites and activates your membership.</p>
          {error ? <div className="message error" role="alert">{error}</div> : null}
          {notice ? <div className="message success" role="status">{notice}</div> : null}
          {!identity.emailVerified ? (
            <div className="panel">
              <h2>Verify your Otya Account email</h2>
              <p className="page-subtitle">Invitation acceptance requires the currently verified email on your Otya Account to match the invitation address.</p>
              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="button primary" onClick={sendVerification} disabled={busy}>Send verification code</button>
              </div>
              {verificationSent ? (
                <div className="form-row" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="verificationCode">5-character verification code</label>
                    <input className="input" id="verificationCode" value={verificationCode} maxLength={5} onChange={event => setVerificationCode(event.target.value.toUpperCase())} placeholder="A1234" />
                  </div>
                  <button className="button" onClick={verifyEmail} disabled={busy || verificationCode.length !== 5}>Verify email</button>
                </div>
              ) : null}
            </div>
          ) : (
            <form className="login-form" onSubmit={acceptInvitation}>
              <div className="field">
                <label htmlFor="inviteToken">One-time invitation code</label>
                <input className="input" id="inviteToken" value={inviteToken} maxLength={64} onChange={event => setInviteToken(event.target.value.toLowerCase())} placeholder="Paste the 64-character code from your email" required />
              </div>
              <button className="button primary" type="submit" disabled={busy || inviteToken.length !== 64}>Accept invitation</button>
            </form>
          )}
          {pendingMemberships.length ? (
            <div className="panel" style={{ marginTop: 15 }}>
              <h2>Awaiting activation</h2>
              {pendingMemberships.map(item => (
                <div className="pending-row" key={item.membership_id}>
                  <div><strong>{item.company_name}</strong><span>{item.role_key} · invited for {item.display_name}</span></div>
                  <span className="badge amber">PENDING</span>
                </div>
              ))}
              <p className="page-subtitle">Your company owner or administrator must activate each membership before you can use operational screens.</p>
            </div>
          ) : null}
          <button className="button" style={{ marginTop: 18, width: "100%" }} onClick={signOut} disabled={busy}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src="https://assets.otya.site/brand/otya/v4/otya-master-icon-512.webp" alt="Otya" width={38} height={38} /></div>
          <div><div className="brand-name">Opoint</div><div className="brand-sub">BY OTYA · WORKFORCE OPERATIONS</div></div>
        </div>
        <div className="workspace-box">
          <div className="workspace-icon"><Building2 size={17} /></div>
          <div className="workspace-copy"><strong>{activeMembership?.company_name ?? "Company workspace"}</strong><span>{activeMembership?.role_key ?? "Staff member"}</span></div>
          <ChevronDown size={14} />
        </div>
        <div className="side-label">WORKSPACE</div>
        {isPrivileged ? (
          <>
            <button className={"side-link " + (tab === "staff" ? "active" : "")} onClick={() => setTab("staff")}><Users size={15} /> Staff directory</button>
            <button className={"side-link " + (tab === "invitations" ? "active" : "")} onClick={() => setTab("invitations")}><Mail size={15} /> Invitations</button>
            <button className={"side-link " + (tab === "assignments" ? "active" : "")} onClick={() => setTab("assignments")}><ClipboardList size={15} /> Work assignments</button>
          </>
        ) : (
          <button className="side-link active"><UserCheck size={15} /> My work</button>
        )}
        <div className="side-note">
          <strong><ShieldCheck size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} /> Access controls active</strong>
          Roles and branch permissions are validated by the Opoint API, not by this interface.
        </div>
        <button className="side-link signout-link" onClick={signOut} disabled={busy}><LogOut size={15} /> Sign out</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">Opoint <span className="crumb-divider">/</span> Workforce</div>
          <div className="top-right">
            {memberships.length > 1 ? (
              <select className="company-picker" value={activeMembership?.company_id ?? ""} onChange={event => setCompanyId(event.target.value)} aria-label="Select company">
                {memberships.map(item => <option key={item.company_id} value={item.company_id}>{item.company_name}</option>)}
              </select>
            ) : <span className="user-chip">{activeMembership?.company_name}</span>}
            <span className="user-chip">{identity.email ?? identity.userId}</span>
            <button className="icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button>
          </div>
        </header>

        <div className="content">
          <div className="page-head">
            <div>
              <p className="eyebrow">COMPANY OPERATIONS</p>
              <h1>{isPrivileged ? "Workforce management" : "My work assignments"}</h1>
              <p className="page-subtitle">Manage staff access, branch duties and Mobile Money operator responsibilities.</p>
            </div>
            <div className="toolbar">
              <span className="user-chip"><CheckCircle2 size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} /> {identity.emailVerified ? "Email verified" : "Email not verified"}</span>
              <button className="button" onClick={refreshData} disabled={refreshing}><RefreshCw size={13} /> Refresh</button>
            </div>
          </div>

          {error ? <div className="message error" role="alert">{error}</div> : null}
          {notice ? <div className="message success" role="status">{notice}</div> : null}

          {pendingMemberships.length ? (
            <section className="panel pending-banner">
              <div className="panel-head">
                <div><h2>Memberships awaiting activation</h2><p>You have accepted invitations that an Owner/Admin still needs to activate.</p></div>
                <span className="badge amber">{pendingMemberships.length} pending</span>
              </div>
              {pendingMemberships.map(item => (
                <div className="pending-row" key={item.membership_id}>
                  <div><strong>{item.company_name}</strong><span>{item.role_key} · {item.email ?? identity.email ?? "Otya Account"}</span></div>
                  <span className="badge amber">AWAITING ACTIVATION</span>
                </div>
              ))}
            </section>
          ) : null}
          {!identity.emailVerified ? (
            <div className="message error" role="status">
              Your Otya Account email is not verified. Some onboarding actions, including invitation acceptance, require email verification.
            </div>
          ) : null}

          {isPrivileged ? (
            <>
              <div className="grid-4">
                <div className="stat"><div className="stat-label">Staff records</div><div className="stat-value">{staff.length}</div><div className="stat-foot">Company workforce</div></div>
                <div className="stat"><div className="stat-label">Active branches</div><div className="stat-value">{branches.length}</div><div className="stat-foot">Within this company</div></div>
                <div className="stat"><div className="stat-label">Pending invitations</div><div className="stat-value">{invitations.filter(item => item.status === "PENDING").length}</div><div className="stat-foot">Awaiting acceptance</div></div>
                <div className="stat"><div className="stat-label">Work assignments</div><div className="stat-value">{assignments.filter(item => item.status === "ACTIVE").length}</div><div className="stat-foot">Active branch duties</div></div>
              </div>
              <div className="filter-row">
                <div className="field filter-field">
                  <label htmlFor="branchFilter">Branch filter</label>
                  <select className="input" id="branchFilter" value={branchFilter} onChange={event => setBranchFilter(event.target.value)}>
                    <option value="">All branches</option>
                    {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
                <div className="field filter-field">
                  <label htmlFor="accessReason">Reason for access changes</label>
                  <input className="input" id="accessReason" value={reason} onChange={event => setReason(event.target.value)} maxLength={300} />
                </div>
              </div>
              <div className="tabs" role="tablist" aria-label="Workforce sections">
                <button className={"tab " + (tab === "staff" ? "active" : "")} onClick={() => setTab("staff")} role="tab" aria-selected={tab === "staff"}>Staff directory</button>
                <button className={"tab " + (tab === "invitations" ? "active" : "")} onClick={() => setTab("invitations")} role="tab" aria-selected={tab === "invitations"}>Invitations</button>
                <button className={"tab " + (tab === "assignments" ? "active" : "")} onClick={() => setTab("assignments")} role="tab" aria-selected={tab === "assignments"}>Work assignments</button>
              </div>

              {tab === "staff" ? (
                <section className="panel">
                  <div className="panel-head"><div><h2>Company staff</h2><p>Business contact and employment details only. National ID, KYC documents and provider credentials are not shown.</p></div><span className="badge">{staff.length} records</span></div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Employee</th><th>Company role</th><th>Membership</th><th>Branch</th><th>Employment</th><th>Position</th><th>Actions</th></tr></thead>
                      <tbody>
                        {staff.map(item => {
                          const self = item.membership_id === activeMembership?.membership_id;
                          const mayManage = !self && item.role_key !== "OWNER" && !(item.role_key === "ADMIN" && !isOwner);
                          return (
                            <tr key={item.membership_id}>
                              <td><strong>{item.display_name}</strong><br /><span>{item.email ?? "No email"}</span><br /><small>{item.employee_number ?? item.department_name ?? "Staff member"}</small></td>
                              <td>{item.role_key}</td>
                              <td><span className={statusTone(item.membership_status)}>{item.membership_status}</span></td>
                              <td>{item.branch_name ?? "Not assigned"}</td>
                              <td>{item.employment_status ?? "Not recorded"}</td>
                              <td>{item.position_title ?? "—"}</td>
                              <td>
                                {mayManage && item.membership_status === "PENDING" ? <button className="button small primary" onClick={() => changeMembership(item, "ACTIVE")} disabled={busy}>Activate</button> : null}
                                {mayManage && item.membership_status === "ACTIVE" ? <button className="button small" onClick={() => changeMembership(item, "SUSPENDED")} disabled={busy}>Suspend</button> : null}
                                {mayManage && item.membership_status === "SUSPENDED" ? <button className="button small" onClick={() => changeMembership(item, "ACTIVE")} disabled={busy}>Resume</button> : null}
                                {mayManage && item.membership_status !== "REVOKED" ? <button className="button small danger" onClick={() => changeMembership(item, "REVOKED")} disabled={busy}>Revoke</button> : null}
                                {self ? <span className="badge">You</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                        {!staff.length ? <tr><td colSpan={7}><div className="empty">No staff records were returned for this company and branch filter.</div></td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {tab === "invitations" ? (
                <>
                  <section className="panel">
                    <div className="panel-head"><div><h2>Invite a team member</h2><p>A one-use code is sent by Otya Auth. Acceptance creates a pending membership; operational access requires activation.</p></div><Mail size={18} /></div>
                    <form className="form-grid" onSubmit={submitInvitation}>
                      <div className="field"><label htmlFor="inviteName">Full name</label><input className="input" id="inviteName" value={inviteName} onChange={event => setInviteName(event.target.value)} required maxLength={120} /></div>
                      <div className="field"><label htmlFor="inviteEmail">Otya Account email</label><input className="input" id="inviteEmail" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} required maxLength={254} /></div>
                      <div className="field"><label htmlFor="inviteRole">Company role</label><select className="input" id="inviteRole" value={inviteRole} onChange={event => setInviteRole(event.target.value)}>
                        {isOwner ? <option value="ADMIN">Admin</option> : null}
                        <option value="MANAGER">Manager</option><option value="CASHIER">Cashier</option><option value="AGENT">Agent</option><option value="ACCOUNTANT">Accountant</option><option value="AUDITOR">Auditor</option>
                      </select></div>
                      <div className="field"><label htmlFor="inviteBranch">Default branch (optional)</label><select className="input" id="inviteBranch" value={inviteBranch} onChange={event => setInviteBranch(event.target.value)}><option value="">Choose later</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                      <div className="form-action"><button className="button primary" type="submit" disabled={busy || !inviteEmail || !inviteName}><Plus size={14} /> Send invitation</button></div>
                    </form>
                  </section>
                  <section className="panel">
                    <div className="panel-head"><div><h2>Invitation history</h2><p>Expired, revoked and accepted invitations remain in the audit trail.</p></div></div>
                    <div className="table-wrap"><table><thead><tr><th>Invited person</th><th>Role</th><th>Branch</th><th>Status</th><th>Delivery</th><th>Expires</th><th>Action</th></tr></thead><tbody>
                      {invitations.map(item => <tr key={item.id}><td><strong>{item.display_name}</strong><br />{item.email}</td><td>{item.role_key}</td><td>{item.branch_name ?? "—"}</td><td><span className={statusTone(item.status)}>{item.status}</span></td><td><span className={statusTone(item.delivery_status)}>{item.delivery_status}</span></td><td>{displayDate(item.expires_at)}</td><td>{item.status === "PENDING" ? <button className="button small danger" onClick={() => revokeInvitation(item)} disabled={busy}>Revoke</button> : "—"}</td></tr>)}
                      {!invitations.length ? <tr><td colSpan={7}><div className="empty">No staff invitations yet.</div></td></tr> : null}
                    </tbody></table></div>
                  </section>
                </>
              ) : null}

              {tab === "assignments" ? (
                <>
                  <section className="panel">
                    <div className="panel-head"><div><h2>Assign branch duties</h2><p>Retail and Mobile Money are separate work areas. Provider operator approval is a separate controlled step.</p></div><ClipboardList size={18} /></div>
                    <form className="form-grid" onSubmit={createAssignment}>
                      <div className="field"><label htmlFor="assignmentStaff">Staff member</label><select className="input" id="assignmentStaff" value={assignmentStaff} onChange={event => setAssignmentStaff(event.target.value)} required><option value="">Choose staff</option>{assignableStaff.map(item => <option key={item.membership_id} value={item.membership_id}>{item.display_name} · {item.role_key}</option>)}</select></div>
                      <div className="field"><label htmlFor="assignmentBranch">Branch</label><select className="input" id="assignmentBranch" value={assignmentBranch} onChange={event => setAssignmentBranch(event.target.value)} required><option value="">Choose branch</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                      <div className="field"><label htmlFor="assignmentArea">Work area</label><select className="input" id="assignmentArea" value={assignmentArea} onChange={event => setAssignmentArea(event.target.value)}><option value="RETAIL">Retail</option><option value="MOBILE_MONEY">Mobile Money</option></select></div>
                      <div className="field"><label htmlFor="assignmentDuty">Duty role</label><select className="input" id="assignmentDuty" value={assignmentDuty} onChange={event => setAssignmentDuty(event.target.value)}><option value="OPERATOR">Operator</option><option value="SUPERVISOR">Supervisor</option><option value="APPROVER">Approver</option><option value="VIEWER">Viewer</option></select></div>
                      <div className="field"><label htmlFor="assignmentReason">Reason</label><input className="input" id="assignmentReason" value={reason} onChange={event => setReason(event.target.value)} required minLength={4} maxLength={300} /></div>
                      <div className="form-action"><button className="button primary" type="submit" disabled={busy || !assignmentStaff || !assignmentBranch}><Plus size={14} /> Create assignment</button></div>
                    </form>
                  </section>
                  <section className="panel">
                    <div className="panel-head"><div><h2>Current branch assignments</h2><p>Suspending a membership or Mobile Money assignment also removes linked provider authority.</p></div></div>
                    <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Branch</th><th>Work area</th><th>Duty</th><th>Status</th><th>Actions</th></tr></thead><tbody>
                      {assignments.map(item => <tr key={item.id}><td><strong>{item.display_name}</strong><br />{item.email ?? ""}</td><td>{item.branch_name}</td><td>{item.work_area === "MOBILE_MONEY" ? <span className="work-label mobile"><Wallet size={12} /> Mobile Money</span> : <span className="work-label"><Store size={12} /> Retail</span>}</td><td>{item.duty_role}</td><td><span className={statusTone(item.status)}>{item.status}</span></td><td>{item.status === "ACTIVE" ? <><button className="button small" onClick={() => updateAssignment(item, "SUSPENDED")} disabled={busy}>Suspend</button> <button className="button small danger" onClick={() => updateAssignment(item, "REVOKED")} disabled={busy}>Revoke</button></> : item.status === "SUSPENDED" ? <><button className="button small" onClick={() => updateAssignment(item, "ACTIVE")} disabled={busy}>Resume</button> <button className="button small danger" onClick={() => updateAssignment(item, "REVOKED")} disabled={busy}>Revoke</button></> : "—"}</td></tr>)}
                      {!assignments.length ? <tr><td colSpan={6}><div className="empty">No work assignments found for this branch filter.</div></td></tr> : null}
                    </tbody></table></div>
                  </section>
                </>
              ) : null}
            </>
          ) : (
            <section className="panel">
              <div className="panel-head"><div><h2>Your active duties</h2><p>Only work areas and branches assigned to your active membership are shown.</p></div><Activity size={17} /></div>
              <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Work area</th><th>Duty</th><th>Status</th></tr></thead><tbody>
                {myAssignments.map(item => <tr key={item.id}><td><strong>{item.branch_name}</strong><br />{item.company_name}</td><td>{item.work_area}</td><td>{item.duty_role}</td><td><span className={statusTone(item.status)}>{item.status}</span></td></tr>)}
                {!myAssignments.length ? <tr><td colSpan={4}><div className="empty">No active work assignments are available. Ask your company owner or administrator to review your branch duties.</div></td></tr> : null}
              </tbody></table></div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
