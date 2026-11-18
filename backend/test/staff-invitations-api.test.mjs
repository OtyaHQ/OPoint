import test from "node:test";
import assert from "node:assert/strict";
import {
  handleStaffInvitationAcceptance,
  handleStaffInvitationManagement,
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
  constructor({ invitation = null, existingMembership = null, existingInvitation = null } = {}) {
    this.invitation = invitation;
    this.existingMembership = existingMembership;
    this.existingInvitation = existingInvitation;
    this.batches = [];
    this.calls = [];
  }

  prepare(sql) {
    const statement = {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        this.calls.push({ kind: "first", sql: this.sql, values: [...this.values] });
        if (this.sql.includes("FROM branches WHERE company_id=?1")) {
          return this.values[1] === "branch-1" ? { id: "branch-1" } : null;
        }
        if (this.sql.includes("FROM staff_memberships WHERE company_id=?1 AND lower(trim")) {
          return this.existingMembership;
        }
        if (this.sql.includes("FROM staff_memberships WHERE company_id=?1 AND (identity_subject")) {
          return this.existingMembership;
        }
        if (this.sql.includes("FROM staff_invitations WHERE company_id=?1 AND email_normalized")) {
          return this.existingInvitation;
        }
        if (this.sql.includes("FROM staff_invitations i JOIN companies c")) {
          return this.invitation;
        }
        if (this.sql.includes("FROM staff_invitations WHERE company_id=?1 AND id=?2")) {
          return this.invitation;
        }
        return null;
      },
      async all() {
        this.calls.push({ kind: "all", sql: this.sql, values: [...this.values] });
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
    OTYAPOINT_INVITE_SERVICE_TOKEN: "test-only-high-entropy-service-token-32bytes",
    OTYA_ID: {
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
  assert.equal(calls[0].url, "https://auth/internal/notifications/otyapoint/staff-invitation");
  assert.equal(calls[0].headers["x-otya-service"], "otyapoint");
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
  env.OTYAPOINT_INVITE_SERVICE_TOKEN = undefined;
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
