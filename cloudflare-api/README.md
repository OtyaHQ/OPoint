# OtyaPoint API — developer overview

This directory contains the server-side API implementation for OtyaPoint. It is source code and test coverage; its presence does not mean that a public endpoint is available or that the customer dashboard is connected.

## Responsibilities

The API is the controlled boundary for OtyaPoint business operations:

- Verified Otya account identity mapped to an active OtyaPoint staff membership.
- Server-enforced company, branch and role authorization.
- Product catalogue, stock movement and cash-only retail sale foundations.
- Audited financial and stock history.
- Staff and invitation workflows.
- Read-only agency readiness and operations reporting.

The API does not accept client-provided role or company claims as authority. It does not treat an AI response, UI message or unverified provider callback as proof that money has moved.

## Current readiness

The private backend has schema and business-logic foundations, but the dashboard is not yet certified against the replacement authentication and data flow. Do not expose an API origin or connect customer traffic until the same-origin session boundary, authorization, preview tests, rollback plan and release checks are complete.

No first owner, staff membership, product catalogue or retail activity has been provisioned in the replacement business system. Agency-provider write operations remain disabled. Any sandbox diagnostic is separate from payment initiation and must not be described as a live transaction capability.

## Financial safety

Retail cash sales and mobile-money agency operations are distinct workflows. Each provider integration must be independently approved and must implement authenticated callbacks, idempotency, duplicate handling, timeouts, unknown-state reconciliation and auditable reversals before live use.

A provider request being accepted is not sufficient evidence that a customer transaction succeeded. Unknown results remain pending until trusted provider evidence is received.

## Local development

Use the repository's documented local scripts and synthetic fixtures. Keep local configuration isolated from production. Do not paste infrastructure identifiers, credentials, service tokens, backup paths or customer data into code, tests, issue reports or logs.

Public integration guidance is published through the OtyaHub documentation surface. Detailed deployment, recovery, credential-custody and production runbooks must be maintained in a private Otya operations workspace.
