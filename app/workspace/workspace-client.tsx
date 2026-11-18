"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type Membership = {
  membership_id?: string;
  company_id: string;
  company_name?: string;
  company_slug?: string;
  role_key?: string;
  branch_id?: string | null;
  branch_name?: string | null;
  status?: string;
};
type ApiObject = Record<string, unknown>;
type Session = { user: { userId: string; email: string; emailVerified: boolean }; memberships: Membership[] };
type Branch = { id: string; name: string; district?: string | null; town_council?: string | null };
type Staff = { membership_id: string; display_name: string; email: string; role_key: string; membership_status: string; branch_name?: string | null };
type Invitation = { id: string; email: string; display_name: string; role_key: string; status: string; delivery_status: string; expires_at: string; branch_name?: string | null };
type Assignment = { id: string; work_area: string; duty_role: string; branch_name?: string; status: string };
type StaffAssignment = { id: string; staff_membership_id: string; display_name: string; email: string; membership_role: string; branch_id: string; branch_name: string; work_area: string; duty_role: string; status: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  const payload = await response.json().catch(() => ({})) as ApiObject;
  if (response.status === 401) {
    window.location.replace("/workspace/sign-in");
    throw new Error("Authentication required.");
  }
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request could not be completed.");
  return payload as T;
}

function getData<T>(reply: { data?: T }): T | undefined {
  return reply.data;
}

export default function OtyaWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [staffAssignments, setStaffAssignments] = useState<StaffAssignment[]>([]);
  const [busy, setBusy] = useState(true);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("CASHIER");
  const [inviteBranch, setInviteBranch] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [assignmentStaff, setAssignmentStaff] = useState("");
  const [assignmentBranch, setAssignmentBranch] = useState("");
  const [assignmentArea, setAssignmentArea] = useState("RETAIL");
  const [assignmentDuty, setAssignmentDuty] = useState("OPERATOR");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assignmentReasons, setAssignmentReasons] = useState<Record<string, string>>({});

  const membership = useMemo(
    () => session?.memberships.find((item) => item.company_id === companyId) ?? null,
    [session, companyId],
  );
  const role = (membership?.role_key || "").toUpperCase();
  const canManageStaff = ["OWNER", "ADMIN"].includes(role);
  const canInvite = ["OWNER", "ADMIN"].includes(role);

  const loadCompany = useCallback(async (selectedCompanyId: string, selectedRole: string) => {
    if (!selectedCompanyId) return;
    setCompanyBusy(true);
    setError("");
    const query = "?companyId=" + encodeURIComponent(selectedCompanyId);
    const requests: Promise<unknown>[] = [
      api<{ data?: Branch[] }>("/api/otyapoint/workforce/branches" + query).then((r) => setBranches(getData(r) || [])).catch((e) => { setBranches([]); setError(e.message); }),
      api<{ data?: Assignment[] }>("/api/otyapoint/workforce/my-assignments").then((r) => setAssignments(getData(r) || [])).catch(() => setAssignments([])),
    ];
    if (["OWNER", "ADMIN"].includes(selectedRole)) {
      requests.push(api<{ data?: Staff[] }>("/api/otyapoint/workforce/staff" + query).then((r) => setStaff(getData(r) || [])).catch((e) => { setStaff([]); setError(e.message); }));
      requests.push(api<{ data?: StaffAssignment[] }>("/api/otyapoint/workforce/assignments" + query).then((r) => setStaffAssignments(getData(r) || [])).catch((e) => { setStaffAssignments([]); setError(e.message); }));
    } else {
      setStaff([]);
      setStaffAssignments([]);
    }
    if (["OWNER", "ADMIN"].includes(selectedRole)) {
      requests.push(api<{ data?: Invitation[] }>("/api/otyapoint/workforce/invitations" + query).then((r) => setInvitations(getData(r) || [])).catch((e) => { setInvitations([]); setError(e.message); }));
    } else {
      setInvitations([]);
    }
    await Promise.allSettled(requests);
    setCompanyBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api<{ authenticated: boolean; user?: Session["user"]; memberships?: Membership[] }>("/api/otyapoint/session");
        if (!result.authenticated || !result.user) {
          window.location.replace("/workspace/sign-in");
          return;
        }
        if (cancelled) return;
        const nextSession = { user: result.user, memberships: result.memberships || [] };
        setSession(nextSession);
        const first = nextSession.memberships[0];
        if (first?.company_id) setCompanyId(first.company_id);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your Otya account.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (membership) void loadCompany(companyId, role);
  }, [companyId, membership, role, loadCompany]);

  async function sendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId) return;
    setError("");
    setNotice("");
    setCompanyBusy(true);
    try {
      await api("/api/otyapoint/workforce/invitations?companyId=" + encodeURIComponent(companyId), {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          displayName: inviteName.trim(),
          roleKey: inviteRole,
          branchId: inviteBranch || null,
        }),
      });
      setInviteName("");
      setInviteEmail("");
      setInviteRole("CASHIER");
      setInviteBranch("");
      setNotice("Invitation created. Access remains pending until the person accepts and an owner/admin activates the membership.");
      await loadCompany(companyId, role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the invitation.");
    } finally {
      setCompanyBusy(false);
    }
  }

  async function changeStaffStatus(person: Staff, status: "ACTIVE" | "SUSPENDED" | "REVOKED") {
    const reason = (reasons[person.membership_id] || "").trim();
    if (reason.length < 4) {
      setError("Add a short reason before changing staff access.");
      return;
    }
    setError("");
    setNotice("");
    setCompanyBusy(true);
    try {
      await api("/api/otyapoint/workforce/staff/" + encodeURIComponent(person.membership_id) + "/status?companyId=" + encodeURIComponent(companyId), {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      });
      setNotice("Staff membership status updated. Existing work assignments follow the server-side suspension and revocation rules.");
      await loadCompany(companyId, role);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Could not update staff access.");
    } finally {
      setCompanyBusy(false);
    }
  }

  const assignableStaff = staff.filter((person) =>
    person.membership_status === "ACTIVE" && !["OWNER", "ADMIN"].includes(person.role_key),
  );

  async function createWorkAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId) return;
    if (assignmentReason.trim().length < 4) {
      setError("A reason is required for a work-area assignment.");
      return;
    }
    setError("");
    setNotice("");
    setCompanyBusy(true);
    try {
      await api("/api/otyapoint/workforce/assignments?companyId=" + encodeURIComponent(companyId), {
        method: "POST",
        headers: { "idempotency-key": window.crypto.randomUUID() },
        body: JSON.stringify({
          staffMembershipId: assignmentStaff,
          branchId: assignmentBranch,
          workArea: assignmentArea,
          dutyRole: assignmentDuty,
          reason: assignmentReason.trim(),
        }),
      });
      setAssignmentStaff("");
      setAssignmentBranch("");
      setAssignmentReason("");
      setNotice(assignmentArea === "RETAIL"
        ? "Retail work access assigned. It does not grant Mobile Money access."
        : "Mobile Money work access assigned separately from Retail access.");
      await loadCompany(companyId, role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the work-area assignment.");
    } finally {
      setCompanyBusy(false);
    }
  }

  async function changeAssignmentStatus(item: StaffAssignment, status: "ACTIVE" | "SUSPENDED" | "REVOKED") {
    const reason = (assignmentReasons[item.id] || "").trim();
    if (reason.length < 4) {
      setError("Add a short reason before changing a work-area assignment.");
      return;
    }
    setError("");
    setNotice("");
    setCompanyBusy(true);
    try {
      await api("/api/otyapoint/workforce/assignments/" + encodeURIComponent(item.id) + "/status?companyId=" + encodeURIComponent(companyId), {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      });
      setNotice("Work-area assignment updated. This change is audited separately from the staff membership.");
      await loadCompany(companyId, role);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Could not update the work-area assignment.");
    } finally {
      setCompanyBusy(false);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    setError("");
    setNotice("");
    setCompanyBusy(true);
    try {
      await api("/api/otyapoint/workforce/invitations/" + encodeURIComponent(invitation.id) + "/revoke?companyId=" + encodeURIComponent(companyId), {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked by an authorized company manager." }),
      });
      setNotice("Pending invitation revoked.");
      await loadCompany(companyId, role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke the invitation.");
    } finally {
      setCompanyBusy(false);
    }
  }

  async function logout() {
    try {
      await api("/api/otyapoint/logout", { method: "POST", body: "{}" });
    } finally {
      window.location.assign("/workspace/sign-in");
    }
  }

  if (busy) return <main style={page}><div style={panel}>Checking your Otya session…</div></main>;
  if (!session) return <main style={page}><div style={panel}>Could not load your Otya session. <a href="/workspace/sign-in" style={link}>Sign in</a></div></main>;

  return (
    <main style={page}>
      <header style={topbar}>
        <div style={brandRow}><div style={mark}>O</div><div><strong>OtyaPoint</strong><div style={smallMuted}>BUSINESS WORKSPACE</div></div></div>
        <div style={account}>
          <span style={smallMuted}>{session.user.email}</span>
          <button onClick={logout} style={secondaryButton}>Sign out</button>
        </div>
      </header>
      <section style={content}>
        <div style={intro}>
          <div><p style={eyebrow}>COMPANY OPERATIONS</p><h1>Good to see you</h1><p style={muted}>Your access is determined by company membership, branch scope and separate work assignments.</p></div>
          {session.memberships.length > 1 && (
            <select aria-label="Active company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={select}>
              {session.memberships.map((item) => <option key={item.company_id} value={item.company_id}>{item.company_name || item.company_slug || item.company_id}</option>)}
            </select>
          )}
        </div>

        {error && <div role="alert" style={errorBox}>{error}</div>}
        {notice && <div role="status" style={noticeBox}>{notice}</div>}

        {session.memberships.length === 0 ? (
          <section style={panel}><h2>No active company membership</h2><p style={muted}>Your Otya Account is signed in, but it is not yet linked to an active OtyaPoint company. Ask the company owner to invite the email address shown above.</p><p style={muted}>Already have an invitation code? <a href="/workspace/invitations/accept" style={link}>Accept your invitation</a></p></section>
        ) : membership ? (
          <>
            <section style={grid}>
              <article style={panel}><p style={eyebrow}>COMPANY</p><h2>{membership.company_name || membership.company_slug || "Your company"}</h2><p style={muted}>Role: {role || "Staff"} · {membership.branch_name || "Company-wide / assigned branch scope"}</p></article>
              <article style={panel}><p style={eyebrow}>YOUR WORK AREAS</p>{assignments.length ? assignments.map((item) => <div key={item.id} style={assignmentRow}><strong>{item.work_area.replace(/_/g, " ")}</strong><span style={smallMuted}>{item.duty_role} · {item.branch_name || "Assigned branch"}</span></div>) : <p style={muted}>No active work-area assignment is linked to this account.</p>}</article>
              <article style={panel}><p style={eyebrow}>BRANCH ACCESS</p>{branches.length ? branches.map((item) => <div key={item.id} style={assignmentRow}><strong>{item.name}</strong><span style={smallMuted}>{[item.town_council, item.district].filter(Boolean).join(", ")}</span></div>) : <p style={muted}>No active branch is available in your current scope.</p>}</article>
            </section>

            {canManageStaff && <section style={panel}>
              <div style={sectionHeader}><div><p style={eyebrow}>WORKFORCE</p><h2>Staff directory</h2><p style={muted}>Company membership and access status. Retail and Mobile Money duties are assigned separately.</p></div><span style={counter}>{staff.length} staff</span></div>
              {staff.length === 0 ? <p style={muted}>No staff memberships were returned for this company scope.</p> : (
                <div style={tableWrap}><table style={table}><thead><tr><th>STAFF</th><th>ROLE</th><th>BRANCH</th><th>MEMBERSHIP</th><th>ACCESS CONTROL</th></tr></thead><tbody>
                  {staff.map((person) => <tr key={person.membership_id}>
                    <td><strong>{person.display_name}</strong><div style={smallMuted}>{person.email}</div></td>
                    <td>{person.role_key}</td><td>{person.branch_name || "—"}</td><td>{person.membership_status}</td>
                    <td>{person.role_key !== "OWNER" && !(role === "ADMIN" && person.role_key === "ADMIN") && person.membership_id !== membership?.membership_id && person.membership_status !== "REVOKED" ? (
                      <div style={statusControls}>
                        <input aria-label={"Reason for " + person.display_name} value={reasons[person.membership_id] || ""} onChange={(e) => setReasons((old) => ({ ...old, [person.membership_id]: e.target.value }))} placeholder="Reason (required)" style={reasonInput}/>
                        {person.membership_status !== "ACTIVE" && <button disabled={companyBusy} onClick={() => void changeStaffStatus(person, "ACTIVE")} style={smallButton}>Activate</button>}
                        {person.membership_status === "ACTIVE" && <button disabled={companyBusy} onClick={() => void changeStaffStatus(person, "SUSPENDED")} style={smallButton}>Suspend</button>}
                        <button disabled={companyBusy} onClick={() => void changeStaffStatus(person, "REVOKED")} style={dangerButton}>Revoke</button>
                      </div>
                    ) : <span style={smallMuted}>{person.role_key === "OWNER" ? "Owner-protected" : person.membership_id === membership?.membership_id ? "Self-access protected" : "Admin-protected / terminal"}</span>}</td>
                  </tr>)}
                </tbody></table></div>
              )}
            </section>}

            {canManageStaff && <section style={panel}>
              <div style={sectionHeader}><div><p style={eyebrow}>DUTY SEPARATION</p><h2>Retail and Mobile Money assignments</h2><p style={muted}>A staff job title alone does not grant access. Assign each work area independently.</p></div><span style={counter}>{staffAssignments.length} assignments</span></div>
              <form onSubmit={createWorkAssignment} style={inviteGrid}>
                <label style={field}>Active staff member<select required value={assignmentStaff} onChange={(e) => setAssignmentStaff(e.target.value)} style={textInput}><option value="">Select staff</option>{assignableStaff.map((person) => <option key={person.membership_id} value={person.membership_id}>{person.display_name} · {person.role_key}</option>)}</select></label>
                <label style={field}>Branch<select required value={assignmentBranch} onChange={(e) => setAssignmentBranch(e.target.value)} style={textInput}><option value="">Select branch</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label style={field}>Work area<select value={assignmentArea} onChange={(e) => setAssignmentArea(e.target.value)} style={textInput}><option value="RETAIL">Retail</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
                <label style={field}>Duty level<select value={assignmentDuty} onChange={(e) => setAssignmentDuty(e.target.value)} style={textInput}><option value="OPERATOR">Operator</option><option value="SUPERVISOR">Supervisor</option><option value="APPROVER">Approver</option><option value="VIEWER">Viewer</option></select></label>
                <label style={field}>Reason<input required minLength={4} maxLength={300} value={assignmentReason} onChange={(e) => setAssignmentReason(e.target.value)} style={textInput} placeholder="Why is this duty assigned?"/></label>
                <button type="submit" disabled={companyBusy || assignableStaff.length === 0 || branches.length === 0} style={primaryButton}>{companyBusy ? "Saving…" : "Assign work area"}</button>
              </form>
              <div style={{ marginTop: 20 }}>
                <h3 style={subheading}>Current company work-area assignments</h3>
                {staffAssignments.length === 0 ? <p style={muted}>No work-area assignments have been configured for this company yet.</p> : (
                  <div style={tableWrap}><table style={table}><thead><tr><th>STAFF</th><th>WORK AREA</th><th>DUTY</th><th>BRANCH</th><th>STATUS</th><th>CONTROL</th></tr></thead><tbody>
                    {staffAssignments.map((item) => <tr key={item.id}>
                      <td><strong>{item.display_name}</strong><div style={smallMuted}>{item.email}</div></td>
                      <td>{item.work_area === "MOBILE_MONEY" ? "Mobile Money" : "Retail"}</td><td>{item.duty_role}</td><td>{item.branch_name}</td><td>{item.status}</td>
                      <td>{item.status !== "REVOKED" ? <div style={statusControls}>
                        <input aria-label={"Reason for assignment " + item.id} value={assignmentReasons[item.id] || ""} onChange={(e) => setAssignmentReasons((old) => ({ ...old, [item.id]: e.target.value }))} placeholder="Reason (required)" style={reasonInput}/>
                        {item.status === "SUSPENDED" && <button disabled={companyBusy} onClick={() => void changeAssignmentStatus(item, "ACTIVE")} style={smallButton}>Resume</button>}
                        {item.status === "ACTIVE" && <button disabled={companyBusy} onClick={() => void changeAssignmentStatus(item, "SUSPENDED")} style={smallButton}>Suspend</button>}
                        <button disabled={companyBusy} onClick={() => void changeAssignmentStatus(item, "REVOKED")} style={dangerButton}>Revoke</button>
                      </div> : <span style={smallMuted}>Terminal</span>}</td>
                    </tr>)}
                  </tbody></table></div>
                )}
              </div>
            </section>}

            {canInvite && <section style={panel}>
              <div style={sectionHeader}><div><p style={eyebrow}>ONBOARDING</p><h2>Invite a staff member</h2><p style={muted}>An invitation does not grant access. New memberships start pending.</p></div></div>
              <form onSubmit={sendInvite} style={inviteGrid}>
                <label style={field}>Full name<input required minLength={2} maxLength={120} value={inviteName} onChange={(e) => setInviteName(e.target.value)} style={textInput}/></label>
                <label style={field}>Email<input required type="email" maxLength={254} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={textInput}/></label>
                <label style={field}>Role<select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={textInput}>
                  <option value="MANAGER">Manager</option><option value="CASHIER">Cashier</option><option value="AGENT">Agent</option><option value="ACCOUNTANT">Accountant</option><option value="AUDITOR">Auditor</option>
                  {role === "OWNER" && <option value="ADMIN">Administrator</option>}
                </select></label>
                <label style={field}>Branch<select value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)} style={textInput}><option value="">Company / to be assigned</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <button type="submit" disabled={companyBusy} style={primaryButton}>{companyBusy ? "Saving…" : "Send invitation"}</button>
              </form>
              <div style={{ marginTop: 20 }}><h3 style={subheading}>Recent invitations</h3>
                {invitations.length === 0 ? <p style={muted}>No invitations yet.</p> : <div style={tableWrap}><table style={table}><thead><tr><th>INVITEE</th><th>ROLE</th><th>BRANCH</th><th>DELIVERY</th><th>STATUS</th><th></th></tr></thead><tbody>
                  {invitations.map((invite) => <tr key={invite.id}><td><strong>{invite.display_name}</strong><div style={smallMuted}>{invite.email}</div></td><td>{invite.role_key}</td><td>{invite.branch_name || "—"}</td><td>{invite.delivery_status}</td><td>{invite.status}</td><td>{invite.status === "PENDING" && <button disabled={companyBusy} onClick={() => void revokeInvitation(invite)} style={dangerButton}>Revoke</button>}</td></tr>)}
                </tbody></table></div>}
              </div>
            </section>}
          </>
        ) : null}
        <div style={bottomNote}>Operational access is enforced by OtyaPoint on the server. This dashboard does not grant provider access or enable payment execution.</div>
      </section>
    </main>
  );
}

const page: CSSProperties = { minHeight: "100vh", background: "#0c1422", color: "#f0f4fa" };
const topbar: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 72, padding: "12px 28px", background: "#0e1929", borderBottom: "1px solid #243249" };
const brandRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 16 };
const mark: CSSProperties = { width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 11, background: "linear-gradient(145deg,#9c9aff,#6f75e9)", color: "white", fontWeight: 900, fontSize: 18 };
const smallMuted: CSSProperties = { display: "block", fontSize: 10, color: "#8d9bb0", marginTop: 4 };
const account: CSSProperties = { display: "flex", alignItems: "center", gap: 14 };
const content: CSSProperties = { maxWidth: 1300, margin: "0 auto", padding: "32px 24px" };
const intro: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, marginBottom: 22 };
const eyebrow: CSSProperties = { color: "#a8b8ff", fontSize: 9, letterSpacing: 1.4, fontWeight: 800, marginBottom: 8 };
const muted: CSSProperties = { color: "#8d9bb0", fontSize: 12, lineHeight: 1.65, marginTop: 7 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14, marginBottom: 16 };
const panel: CSSProperties = { border: "1px solid #243249", borderRadius: 13, background: "#111e30", padding: 19, marginBottom: 16, minWidth: 0 };
const assignmentRow: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderTop: "1px solid #243249", padding: "10px 0" };
const select: CSSProperties = { background: "#111e30", color: "#f0f4fa", border: "1px solid #33445f", borderRadius: 8, padding: 10, minWidth: 210 };
const sectionHeader: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", marginBottom: 15 };
const counter: CSSProperties = { color: "#a8b8ff", background: "#7777ff20", borderRadius: 7, padding: "6px 9px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" };
const tableWrap: CSSProperties = { width: "100%", overflowX: "auto" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", textAlign: "left", minWidth: 760 };
const statusControls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, minWidth: 260 };
const reasonInput: CSSProperties = { maxWidth: 150, minWidth: 110, border: "1px solid #33445f", borderRadius: 6, background: "#0c1422", color: "#f0f4fa", padding: 7, fontSize: 10 };
const smallButton: CSSProperties = { border: "1px solid #40516e", borderRadius: 6, background: "#1c2b42", color: "#dce5f4", padding: "7px 9px", fontSize: 10, fontWeight: 700 };
const dangerButton: CSSProperties = { border: "1px solid #7f343d", borderRadius: 6, background: "#7f1d1d33", color: "#fecaca", padding: "7px 9px", fontSize: 10, fontWeight: 700 };
const inviteGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", alignItems: "end", gap: 12 };
const field: CSSProperties = { display: "grid", gap: 6, color: "#b6c2d4", fontSize: 11, fontWeight: 700 };
const textInput: CSSProperties = { height: 39, background: "#0c1422", border: "1px solid #33445f", borderRadius: 7, color: "#f0f4fa", padding: "0 10px", minWidth: 0 };
const primaryButton: CSSProperties = { border: 0, borderRadius: 8, background: "#8585fa", color: "#fff", padding: "11px 13px", fontWeight: 800, fontSize: 11 };
const secondaryButton: CSSProperties = { border: "1px solid #33445f", background: "transparent", color: "#c5d0e1", borderRadius: 7, padding: "8px 10px", fontSize: 10, fontWeight: 700 };
const link: CSSProperties = { color: "#a8b8ff" };
const subheading: CSSProperties = { fontSize: 12, marginBottom: 10 };
const bottomNote: CSSProperties = { color: "#62728a", fontSize: 10, textAlign: "center", padding: "10px 0 25px" };
const errorBox: CSSProperties = { color: "#fecaca", background: "#7f1d1d33", border: "1px solid #991b1b66", borderRadius: 8, padding: 11, fontSize: 12, marginBottom: 12 };
const noticeBox: CSSProperties = { color: "#c7d2fe", background: "#6366f11c", border: "1px solid #6366f155", borderRadius: 8, padding: 11, fontSize: 12, lineHeight: 1.5, marginBottom: 12 };
