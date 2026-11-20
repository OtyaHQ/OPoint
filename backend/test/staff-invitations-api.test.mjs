import test from "node:test";
import assert from "node:assert/strict";
import {
  handleStaffInvitationAcceptance,
  handleStaffInvitationManagement,
  handleStaffMembershipStatusManagement,
} from "../src/staff-invitations.mjs";

const OWNER = {
  membership_id: "membership-owner",
  company_id: "company-1",
  role_key: "OWNER",
};
const ADMIN = {
  membership_id: "membership-admin",
  company_id: "company-1",
  role_key: "ADMIN",
};
const AGENT = {
  membership_id: "membership-agent",
  company_id: "company-1",
  role_key: "AGENT",
};

class MemoryD1 {
  constructor({ invitation = null, existingMembership = null, existingInvitation = null, targetMembership = null } = {}) {
    this.invitation = invitation;
    this.existingMembership = existingMembership;
    this.existingInvitation = existingInvitation;
    this.targetMembership = targetMembership;
    this.batches = [];
    this.calls = [];
  }

  prepare(sql) {
    const { invitation, existingMembership, existingInvitation, targetMembership, calls } = this;
    const statement = {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        calls.push({ kind: "first", sql: this.sql, values: [...this.values] });
        if (this.sql.includes("FROM branches WHERE company_id=?1")) {
          return this.values[1] === "branch-1" ? { id: "branch-1" } : null;
        }
        if (this.sql.includes("FROM staff_memberships WHERE company_id=?1 AND lower(trim")) {
          return existingMembership;
        }
        if (this.sql.includes("FROM staff_memberships WHERE company_id=?1 AND (identity_subject")) {
          return existingMembership;
        }
        if (this.sql.includes("FROM staff_memberships WHERE company_id=?1 AND id=?2")) {
          return targetMembership;
        }
        if (this.sql.includes("FROM staff_invitations WHERE company_id=?1 AND email_normalized")) {
          return existingInvitation;
        }
        if (this.sql.includes("FROM staff_invitations i JOIN companies c")) {
          return invitation;
        }
        if (this.sql.includes("FROM staff_invitations WHERE company_id=?1 AND id=?2")) {
          return invitation;
        }
        return null;
      },
      async all() {
        calls.push({ kind: "all", sql: this.sql, values: [...this.values] });
        return { results: [] };
      },
    };
    statement.calls = this.calls;
    return statement;
  }

  async batch(statements) {
    this.batches.push(statements.map(statement => ({
      sql: statement.sql,
      values: [...statement.values],
    })));
    return statements.map(() => ({ success: true }));
  }
}

function apiRequest(path, body) {
  return new Request("https://opoint.internal" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeEnv(options = {}) {
  const calls = [];
  const env = {
    DB: new MemoryD1(options),
    OPOINT_INVITE_SERVICE_TOKEN: "test-only-high-entropy-service-token-32bytes",
    OID: {
      async fetch(request) {
        const body = await request.clone().json();
        calls.push({
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          body,
        });
        return Response.json({ accepted: true }, { status: 202 });
      },
    },
  };
  return { env, calls };
}

async function digestHex(value) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function requestUrl(path) {
  return new URL("https://opoint.internal" + path);
}

test("Owner creates an email-bound invite without exposing its one-time token", async () => {
  const { env, calls } = makeEnv();
  const request = apiRequest("/v1/staff/invitations", {
    email: "Teller@example.invalid",
    displayName: "Shop Teller",
    roleKey: "AGENT",
    branchId: "branch-1",
  });
  const result = await handleStaffInvitationManagement(
    request, env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/invitations"), "request-1",
  );
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.equal(body.data.email, "teller@example.invalid");
  assert.equal(body.data.deliveryStatus, "SENT");
  assert.equal(body.data.status, "PENDING");
  assert.equal(JSON.stringify(body).includes(calls[0].body.token), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oid/internal/notifications/opoint/staff-invitation");
  assert.equal(calls[0].headers["x-otya-service"], "opoint");
  assert.equal(calls[0].body.role, "AGENT");
  assert.match(calls[0].body.token, /^[a-f0-9]{64}$/);
  const insert = env.DB.batches[0].find(row => row.sql.includes("INSERT INTO staff_invitations"));
  assert.equal(insert.values[7], await digestHex(calls[0].body.token));
  assert.equal(insert.values[7].includes(calls[0].body.token), false);
});

test("An Admin cannot invite another Admin and only Owner can assign Admin role", async () => {
  const { env, calls } = makeEnv();
  const result = await handleStaffInvitationManagement(
    apiRequest("/v1/staff/invitations", {
      email: "admin@example.invalid",
      displayName: "New Admin",
      roleKey: "ADMIN",
    }),
    env, { userId: "admin-identity" }, ADMIN,
    requestUrl("/v1/staff/invitations"), "request-2",
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "owner_required_to_invite_admin");
  assert.equal(calls.length, 0);
  assert.equal(env.DB.batches.length, 0);
});

test("Normal staff invitation cannot assign OWNER role", async () => {
  const { env } = makeEnv();
  const result = await handleStaffInvitationManagement(
    apiRequest("/v1/staff/invitations", {
      email: "owner2@example.invalid",
      displayName: "Second Owner",
      roleKey: "OWNER",
    }),
    env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/invitations"), "request-3",
  );
  assert.equal(result.status, 400);
  assert.equal((await result.json()).error, "invalid_invitation_role");
  assert.equal(env.DB.batches.length, 0);
});

test("Non-privileged staff cannot list or create company invitations", async () => {
  const { env } = makeEnv();
  const result = await handleStaffInvitationManagement(
    apiRequest("/v1/staff/invitations", {
      email: "worker@example.invalid",
      displayName: "Worker",
      roleKey: "CASHIER",
    }),
    env, { userId: "agent-identity" }, AGENT,
    requestUrl("/v1/staff/invitations"), "request-4",
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "staff_invitation_management_forbidden");
  assert.equal(env.DB.calls.length, 0);
});

test("Invitation fails closed when the private email service secret is unavailable", async () => {
  const { env, calls } = makeEnv();
  env.OPOINT_INVITE_SERVICE_TOKEN = undefined;
  const result = await handleStaffInvitationManagement(
    apiRequest("/v1/staff/invitations", {
      email: "no-secret@example.invalid",
      displayName: "No Secret",
      roleKey: "CASHIER",
    }),
    env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/invitations"), "request-5",
  );
  assert.equal(result.status, 503);
  const body = await result.json();
  assert.equal(body.error, "invitation_email_not_configured");
  assert.equal(body.invitation.deliveryStatus, "FAILED");
  assert.equal(calls.length, 0);
});

test("Invitation redemption requires verified account email before database access", async () => {
  const { env } = makeEnv();
  const result = await handleStaffInvitationAcceptance(
    apiRequest("/v1/staff/invitations/accept", { token: "a".repeat(64) }),
    env, { userId: "worker-identity", email: "worker@example.invalid", emailVerified: false },
    requestUrl("/v1/staff/invitations/accept"), "request-6",
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "verified_account_email_required");
  assert.equal(env.DB.calls.length, 0);
});

test("Verified email mismatch does not consume the invitation", async () => {
  const { env } = makeEnv({
    invitation: {
      id: "invite-1", company_id: "company-1", email_normalized: "right@example.invalid",
      display_name: "Teller", branch_id: null, role_key: "AGENT", status: "PENDING",
      expires_at: "2099-01-01T00:00:00.000Z", company_status: "ACTIVE", branch_status: null,
    },
  });
  const result = await handleStaffInvitationAcceptance(
    apiRequest("/v1/staff/invitations/accept", { token: "a".repeat(64) }),
    env, { userId: "worker-identity", email: "wrong@example.invalid", emailVerified: true },
    requestUrl("/v1/staff/invitations/accept"), "request-7",
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "invitation_email_mismatch");
  assert.equal(env.DB.batches.length, 0);
});

test("Verified matching email redeems the token into a PENDING membership only", async () => {
  const token = "a".repeat(64);
  const { env } = makeEnv({
    invitation: {
      id: "invite-1", company_id: "company-1", email_normalized: "worker@example.invalid",
      display_name: "Teller", branch_id: "branch-1", role_key: "AGENT", status: "PENDING",
      expires_at: "2099-01-01T00:00:00.000Z", company_status: "ACTIVE", branch_status: "ACTIVE",
    },
  });
  const result = await handleStaffInvitationAcceptance(
    apiRequest("/v1/staff/invitations/accept", { token }),
    env, { userId: "worker-identity", email: "worker@example.invalid", emailVerified: true },
    requestUrl("/v1/staff/invitations/accept"), "request-8",
  );
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.equal(body.data.status, "PENDING");
  assert.equal(body.data.roleKey, "AGENT");
  assert.match(body.data.membershipId, /^[0-9a-f-]{36}$/i);
  const statements = env.DB.batches.flat();
  const insert = statements.find(row => row.sql.includes("INSERT INTO staff_memberships"));
  assert.ok(insert.sql.includes("'PENDING'"));
  assert.equal(insert.values[3], "worker-identity");
  assert.equal(insert.values[5], "worker@example.invalid");
  const consume = statements.find(row => row.sql.includes("UPDATE staff_invitations SET status='ACCEPTED'"));
  assert.ok(consume);
  assert.equal(consume.values[0], body.data.membershipId);
  assert.equal(JSON.stringify(statements).includes(token), false);
});

test("Expired invitation transitions to EXPIRED and cannot be redeemed", async () => {
  const { env } = makeEnv({
    invitation: {
      id: "invite-expired", company_id: "company-1", email_normalized: "worker@example.invalid",
      display_name: "Teller", branch_id: null, role_key: "AGENT", status: "PENDING",
      expires_at: "2000-01-01T00:00:00.000Z", company_status: "ACTIVE", branch_status: null,
    },
  });
  const result = await handleStaffInvitationAcceptance(
    apiRequest("/v1/staff/invitations/accept", { token: "a".repeat(64) }),
    env, { userId: "worker-identity", email: "worker@example.invalid", emailVerified: true },
    requestUrl("/v1/staff/invitations/accept"), "request-9",
  );
  assert.equal(result.status, 410);
  assert.equal((await result.json()).error, "invitation_expired");
  assert.ok(env.DB.batches.flat().some(row => row.sql.includes("status='EXPIRED'")));
});

test("Invitation lists never expose token digests", async () => {
  const { env } = makeEnv();
  env.DB.prepare = (sql) => ({
    sql,
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return { id: "branch-1" }; },
    async all() {
      return { results: [{
        id: "invite-1", email: "worker@example.invalid", display_name: "Worker",
        branch_id: "branch-1", branch_name: "Mbirizi", role_key: "CASHIER",
        status: "PENDING", delivery_status: "SENT", expires_at: "2099-01-01T00:00:00.000Z",
      }] };
    },
  });
  const result = await handleStaffInvitationManagement(
    apiRequest("/v1/staff/invitations"),
    env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/invitations"), "request-10",
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.data[0].email, "worker@example.invalid");
  assert.equal(JSON.stringify(body).includes("token_digest"), false);
});


test("Owner explicitly activates an accepted pending membership", async () => {
  const { env } = makeEnv({
    targetMembership: {
      id: "membership-pending",
      identity_subject: "worker-identity",
      role_key: "AGENT",
      status: "PENDING",
    },
  });
  const result = await handleStaffMembershipStatusManagement(
    apiRequest("/v1/staff/membership-pending/status", {
      status: "ACTIVE",
      reason: "Employment checks completed",
    }),
    env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/membership-pending/status"), "request-11",
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.status, "ACTIVE");
  const statements = env.DB.batches.flat();
  const update = statements.find(row => row.sql.includes("UPDATE staff_memberships SET status"));
  assert.equal(update.values[0], "ACTIVE");
  assert.equal(update.values[1], "owner-identity");
  const event = statements.find(row => row.sql.includes("INSERT INTO staff_membership_events"));
  assert.ok(event);
  assert.equal(event.values[3], "ACTIVATED");
});

test("Admin cannot activate or manage another Admin membership", async () => {
  const { env } = makeEnv({
    targetMembership: {
      id: "membership-admin-2",
      identity_subject: "other-admin",
      role_key: "ADMIN",
      status: "PENDING",
    },
  });
  const result = await handleStaffMembershipStatusManagement(
    apiRequest("/v1/staff/membership-admin-2/status", {
      status: "ACTIVE",
      reason: "Attempted admin escalation",
    }),
    env, { userId: "admin-identity" }, ADMIN,
    requestUrl("/v1/staff/membership-admin-2/status"), "request-12",
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "owner_required_to_manage_admin");
  assert.equal(env.DB.batches.length, 0);
});

test("Ordinary membership controls cannot change Owner or self access", async () => {
  const ownerEnv = makeEnv({
    targetMembership: {
      id: "owner-membership",
      identity_subject: "owner-identity",
      role_key: "OWNER",
      status: "ACTIVE",
    },
  }).env;
  const ownerResult = await handleStaffMembershipStatusManagement(
    apiRequest("/v1/staff/owner-membership/status", {
      status: "SUSPENDED",
      reason: "Not permitted",
    }),
    ownerEnv, { userId: "admin-identity" }, ADMIN,
    requestUrl("/v1/staff/owner-membership/status"), "request-13",
  );
  assert.equal(ownerResult.status, 403);
  assert.equal((await ownerResult.json()).error, "owner_transfer_requires_separate_controlled_process");

  const selfEnv = makeEnv({
    targetMembership: {
      id: "membership-agent",
      identity_subject: "agent-identity",
      role_key: "AGENT",
      status: "ACTIVE",
    },
  }).env;
  const selfResult = await handleStaffMembershipStatusManagement(
    apiRequest("/v1/staff/membership-agent/status", {
      status: "SUSPENDED",
      reason: "Self test",
    }),
    selfEnv, { userId: "agent-identity" }, ADMIN,
    requestUrl("/v1/staff/membership-agent/status"), "request-14",
  );
  assert.equal(selfResult.status, 409);
  assert.equal((await selfResult.json()).error, "self_membership_change_forbidden");
});

test("Revoked memberships cannot be reactivated", async () => {
  const { env } = makeEnv({
    targetMembership: {
      id: "membership-revoked",
      identity_subject: "worker-identity",
      role_key: "AGENT",
      status: "REVOKED",
    },
  });
  const result = await handleStaffMembershipStatusManagement(
    apiRequest("/v1/staff/membership-revoked/status", {
      status: "ACTIVE",
      reason: "Trying to restore revoked access",
    }),
    env, { userId: "owner-identity" }, OWNER,
    requestUrl("/v1/staff/membership-revoked/status"), "request-15",
  );
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, "staff_membership_revoked_terminal");
  assert.equal(env.DB.batches.length, 0);
});
