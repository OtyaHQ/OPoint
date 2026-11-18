import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProviderRelationship,
  normalizeProviderRelationshipStatus,
  normalizeOutletAccount,
  normalizeProviderOperator,
  normalizeProviderOperatorStatus,
} from "../src/provider-operators.mjs";

test("normalizes Airtel, MTN and InterSwitch provider relationships separately", () => {
  for (const providerCode of ["AIRTEL_MONEY", "MTN_MOMO", "INTERSWITCH_QUICKTELLER"]) {
    const value = normalizeProviderRelationship({
      providerCode,
      legalEntityName: "Otya Holdings Limited",
      corporateAgentReference: "CORP-AGENT-001",
      agreementReference: "AGREEMENT-2026-001",
      reason: "Provider onboarding started",
    });
    assert.equal(value.value.providerCode, providerCode);
  }
});

test("partial relationship and operator updates preserve previously recorded expiry dates", () => {
  const relationship = normalizeProviderRelationshipStatus({
    onboardingStatus: "SUSPENDED",
    reason: "Provider temporarily paused",
  }, { corporate_agent_reference: "CORP-AGENT-001", agreement_reference: "AGREEMENT-2026-001", expires_at: "2027-12-31" });
  assert.equal(relationship.value.expiresAt, "2027-12-31");

  const operator = normalizeProviderOperatorStatus({
    approvalStatus: "SUSPENDED",
    reason: "Operator access paused",
  }, { training_status: "COMPLETED", provider_operator_reference: "AIR-OP-001", valid_until: "2027-06-30" });
  assert.equal(operator.value.validUntil, "2027-06-30");
});

test("provider relationship cannot be activated without corporate and agreement references", () => {
  assert.equal(
    normalizeProviderRelationshipStatus({ onboardingStatus: "ACTIVE", reason: "Approve provider" }, {}).error,
    "active_provider_relationship_requires_corporate_and_agreement_references",
  );
});

test("outlet account references are provider IDs, not staff phone numbers", () => {
  const base = {
    providerRelationshipId: "relationship-1",
    branchId: "branch-1",
    accountKind: "AGENT_FLOAT",
    displayName: "Mbirizi Airtel float",
    reason: "Registered at provider",
  };
  assert.equal(normalizeOutletAccount({ ...base, outletAccountReference: "AIR-MBR-001" }).value.accountKind, "AGENT_FLOAT");
  for (const outletAccountReference of ["0700123456", "+256700123456"]) {
    assert.equal(normalizeOutletAccount({ ...base, outletAccountReference }).error, "invalid_outlet_account_reference_use_provider_account_code_not_personal_phone");
  }
});

test("operator profile requires a provider operator reference and forbids credentials/KYC", () => {
  assert.equal(normalizeProviderOperator({ employeeProfileId: "employee-1", reason: "Add operator" }).error, "provider_operator_reference_required");
  assert.equal(normalizeProviderOperator({
    employeeProfileId: "employee-1",
    providerOperatorReference: "AIR-OP-001",
    reason: "Add operator",
    pin: "1234",
  }).error, "sensitive_identity_or_credential_field_not_accepted");
});

test("approval requires a provider reference and completed training", () => {
  assert.equal(normalizeProviderOperatorStatus({
    approvalStatus: "APPROVED",
    trainingStatus: "IN_PROGRESS",
    reason: "Approve operator",
  }, {}).error, "operator_approval_requires_provider_reference_and_completed_training");
  const approved = normalizeProviderOperatorStatus({
    approvalStatus: "APPROVED",
    trainingStatus: "COMPLETED",
    providerOperatorReference: "MTN-OP-001",
    reason: "Provider confirmed operator approval",
  }, {});
  assert.equal(approved.value.approvalStatus, "APPROVED");
});
