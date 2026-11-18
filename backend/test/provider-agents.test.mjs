import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProviderAgentAccount,
  normalizeProviderAccountStatus,
  normalizeProviderStaffAssignment,
  providerDutyAllowed,
} from "../src/provider-agents.mjs";

test("accepts separate MTN and Airtel provider account identifiers", () => {
  const mtn = normalizeProviderAgentAccount({
    providerCode: "mtn_momo",
    branchId: "branch-1",
    providerAgentReference: "MTN-AGENT-0417",
    displayLabel: "Main MTN agent line",
    agentLineLast4: "0417",
    reason: "Provider appointment approved",
  });
  const airtel = normalizeProviderAgentAccount({
    providerCode: "AIRTEL_MONEY",
    branchId: "branch-1",
    providerAgentReference: "AIR-AGENT-0092",
    displayLabel: "Main Airtel agent line",
    reason: "Provider appointment approved",
  });
  assert.equal(mtn.value.providerCode, "MTN_MOMO");
  assert.equal(mtn.value.agentLineLast4, "0417");
  assert.equal(airtel.value.providerCode, "AIRTEL_MONEY");
});

test("rejects full phone-number-like provider references and malformed last-four suffixes", () => {
  for (const providerAgentReference of ["0700123456", "+256700123456", "256700123456"]) {
    assert.equal(normalizeProviderAgentAccount({
      providerCode: "MTN_MOMO",
      branchId: "branch-1",
      providerAgentReference,
      displayLabel: "Main outlet",
      reason: "Provider account registration",
    }).error, "invalid_provider_agent_reference_use_provider_agent_code_not_full_phone_number");
  }
  for (const agentLineLast4 of ["123", "12345", "12a4", "+123"]) {
    assert.equal(normalizeProviderAgentAccount({
      providerCode: "MTN_MOMO",
      branchId: "branch-1",
      providerAgentReference: "MTN-AGENT-0001",
      displayLabel: "Main outlet",
      agentLineLast4,
      reason: "Provider account registration",
    }).error, "agent_line_last4_must_be_four_digits");
  }
});

test("rejects raw credentials, phone numbers and KYC fields", () => {
  for (const extra of [
    { pin: "1234" },
    { otp: "123456" },
    { password: "secret" },
    { msisdn: "+256700000000" },
    { phoneNumber: "+256700000000" },
    { nationalId: "CM000000" },
    { apiKey: "test" },
  ]) {
    const input = normalizeProviderAgentAccount({
      providerCode: "MTN_MOMO",
      branchId: "branch-1",
      providerAgentReference: "AGENT-0001",
      displayLabel: "Main outlet",
      reason: "Provider confirmed this account",
      ...extra,
    });
    assert.equal(input.error, "sensitive_credentials_or_identity_data_not_accepted");
  }
});

test("requires a provider approval reference before an account can be activated", () => {
  assert.equal(
    normalizeProviderAccountStatus({ status: "ACTIVE", reason: "Activate account" }).error,
    "provider_approval_reference_required",
  );
  assert.equal(
    normalizeProviderAccountStatus({
      status: "ACTIVE",
      providerApprovalReference: "AIRTEL-APPROVAL-2026",
      reason: "Provider appointment confirmed",
    }).value.status,
    "ACTIVE",
  );
});

test("provider account and employee duties remain separate but compatible", () => {
  assert.equal(providerDutyAllowed("OPERATOR", "OPERATOR"), true);
  assert.equal(providerDutyAllowed("SUPERVISOR", "OPERATOR"), true);
  assert.equal(providerDutyAllowed("OPERATOR", "SUPERVISOR"), false);
  assert.equal(providerDutyAllowed("APPROVER", "APPROVER"), true);
  assert.equal(providerDutyAllowed("VIEWER", "VIEWER"), true);
});

test("normalizes provider-account assignment and rejects personal identity data", () => {
  const normalized = normalizeProviderStaffAssignment({
    staffMembershipId: "staff-1",
    dutyRole: "operator",
    reason: "Assigned for agency shift",
  });
  assert.deepEqual(normalized.value, {
    staffMembershipId: "staff-1",
    dutyRole: "OPERATOR",
    reason: "Assigned for agency shift",
  });
  assert.equal(
    normalizeProviderStaffAssignment({
      staffMembershipId: "staff-1",
      dutyRole: "OPERATOR",
      reason: "Assigned for agency shift",
      phone: "+256700000000",
    }).error,
    "sensitive_credentials_or_identity_data_not_accepted",
  );
});
