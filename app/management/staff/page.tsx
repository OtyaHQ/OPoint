import { prisma } from "@/lib/prisma";
import { requireManagement } from "@/lib/management";
import { inviteStaffAction, reviewStaffAction } from "./actions";

type PageProps = { searchParams: Promise<{ error?: string; success?: string }> };

const errorMessages: Record<string, string> = {
  invalid: "Check the name, email, agent ID, phone and role. Agent IDs must be 6–12 uppercase letters or digits.",
  duplicate: "That email address or agent ID is already registered.",
  "admin-not-configured": "Secure invitations are not configured. Add SUPABASE_SERVICE_ROLE_KEY as a server-only Vercel environment variable.",
  "invite-failed": "The invitation could not be sent. Check the email address and Supabase Auth configuration.",
  "profile-failed": "The invitation was rolled back because the staff profile or audit record could not be saved.",
  "not-found": "That staff record was not found.",
  "self-approval": "A management user cannot approve their own staff identity.",
};
const successMessages: Record<string, string> = {
  invited: "Invitation sent. The account remains inactive until management completes identity checks and approves it.",
  approved: "Staff identity marked verified and access activated.",
  rejected: "Staff access remains disabled and the identity check is marked rejected.",
};

export default async function StaffManagementPage({ searchParams }: PageProps) {
  await requireManagement();
  const params = await searchParams;
  const staff = await prisma.user.findMany({
    orderBy: [{ identityStatus: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, displayName: true, email: true, agentId: true, phone: true,
      role: true, isActive: true, identityStatus: true, createdAt: true, approvedAt: true,
    },
    take: 200,
  });

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24, color: "#e2e8f0" }}>
      <p style={{ color: "#a5b4fc", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>OTYAPOINT · MANAGEMENT</p>
      <h1 style={{ fontSize: 30, margin: "8px 0" }}>Staff onboarding and access</h1>
      <p style={{ color: "#94a3b8", maxWidth: 760 }}>
        Only the Managing Director and Chairman can invite or approve staff. Invitations do not grant access.
        Verify the person’s national ID and required documents through your approved process before approving them.
        Do not enter national ID numbers or upload identity documents here.
      </p>

      {params.error && <p role="alert" style={noticeStyle}>{errorMessages[params.error] ?? "The request could not be completed."}</p>}
      {params.success && <p role="status" style={{ ...noticeStyle, borderColor: "#166534" }}>{successMessages[params.success] ?? "Completed."}</p>}

      <section style={panelStyle}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>Invite a staff member</h2>
        <form action={inviteStaffAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <label style={labelStyle}>Full legal name<input name="displayName" autoComplete="name" minLength={3} maxLength={120} required style={inputStyle} /></label>
          <label style={labelStyle}>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required style={inputStyle} /></label>
          <label style={labelStyle}>Unique agent ID<input name="agentId" placeholder="2IQ35198" pattern="[A-Za-z0-9]{6,12}" minLength={6} maxLength={12} required style={inputStyle} /></label>
          <label style={labelStyle}>Phone (optional)<input name="phone" type="tel" autoComplete="tel" maxLength={32} style={inputStyle} /></label>
          <label style={labelStyle}>Role<select name="role" defaultValue="ATTENDANT" style={inputStyle}><option value="ATTENDANT">Attendant</option><option value="MANAGER">Manager</option></select></label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="submit" style={buttonStyle}>Send secure invitation</button></div>
        </form>
        <p style={{ color: "#94a3b8", fontSize: 12 }}>The app stores identity-verification status, not the raw national ID number. New staff start inactive.</p>
      </section>

      <section style={panelStyle}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>Staff directory ({staff.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Staff", "Agent ID", "Role", "Identity", "Access", "Management action"].map((h) => <th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {staff.map((person) => <tr key={person.id}>
                <td style={cellStyle}><strong>{person.displayName}</strong><br /><span style={{ color: "#94a3b8" }}>{person.email}</span>{person.phone && <><br /><span style={{ color: "#94a3b8" }}>{person.phone}</span></>}</td>
                <td style={cellStyle}>{person.agentId ?? "—"}</td>
                <td style={cellStyle}>{person.role}</td>
                <td style={cellStyle}>{person.identityStatus}</td>
                <td style={cellStyle}>{person.isActive ? "Active" : "Disabled"}</td>
                <td style={cellStyle}>
                  {person.identityStatus !== "VERIFIED" && <form action={reviewStaffAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="userId" value={person.id} />
                    <button name="decision" value="approve" type="submit" style={buttonStyle}>Verify & activate</button>
                    <button name="decision" value="reject" type="submit" style={{ ...buttonStyle, background: "#7f1d1d" }}>Reject</button>
                  </form>}
                  {person.identityStatus === "VERIFIED" && <span style={{ color: "#86efac" }}>Approved {person.approvedAt?.toLocaleDateString("en-UG") ?? ""}</span>}
                </td>
              </tr>)}
              {staff.length === 0 && <tr><td colSpan={6} style={cellStyle}>No staff profiles exist yet. Provision the first management administrator through the secure Supabase Dashboard process.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p style={{ color: "#94a3b8", fontSize: 12 }}>Approval records an operator’s verification decision; it does not independently validate a national ID. Keep retail and fintech permissions separate and review every privileged action in the audit log.</p>
    </main>
  );
}

const panelStyle = { border: "1px solid #334155", borderRadius: 16, padding: 20, marginTop: 24, background: "#172438" };
const labelStyle = { display: "grid", gap: 6, fontSize: 13 };
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: 11, borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const buttonStyle = { border: 0, borderRadius: 8, padding: "11px 14px", fontWeight: 700, background: "#a5b4fc", color: "#101b2b", cursor: "pointer" };
const cellStyle = { textAlign: "left" as const, verticalAlign: "top" as const, borderBottom: "1px solid #334155", padding: "12px 10px", fontSize: 13 };
const noticeStyle = { border: "1px solid #991b1b", borderRadius: 8, padding: 12, background: "#7f1d1d33" };
