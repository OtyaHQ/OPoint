# Opoint AI boundary

**Default:** disabled. The staging Worker must keep `AI_ENABLED=false` until the scoped tools, privacy controls and evaluation suite pass.

Opoint Assistant is a product-scoped helper for an authenticated Opoint user. It may eventually explain workflows and provide read-only operational summaries for the user's currently authorized company and branch.

## Allowed future capability

- Explain POS, inventory, supplier, customer, cash-session and reconciliation workflows.
- Summarize read-only metrics returned by the Opoint API, with company and branch scope checked server-side.
- Explain provider integration status without revealing credentials.
- Prepare a draft report or recommended action for the user to review.

## Prohibited capabilities

- No direct D1, R2, Firebase, secrets or provider access.
- No journal posting, sale completion, inventory mutation, cash-in/out, float movement, payment, payout, reversal, refund or EFRIS submission.
- No changing staff roles, approving its own proposals or bypassing owner/manager permissions.
- No access to another company or branch based on prompt text or client-supplied identifiers.
- No storing customer PII, OTPs, provider credentials or raw financial records in prompts or AI memory.

All future AI retrieval must use the Opoint API, derive company/branch permissions from Otya ID plus Opoint staff membership, and return the minimum data needed. AI output is advice, never authorization.

Canonical policy: [Otya End AI product isolation and execution policy](https://github.com/OtyaHQ/OEnd/blob/product-ai-isolation-foundation-2026-11-11/docs/AI_PRODUCT_ISOLATION_AND_EXECUTION_POLICY.md).
