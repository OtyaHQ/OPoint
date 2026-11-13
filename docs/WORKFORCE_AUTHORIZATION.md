# Workforce authorization and provider identity model

**Status:** Implementation contract for the Otya Enterprise feature branch. This does not certify production readiness or provider approval.

## One person, several independent records

A worker is not the same thing as their job, login, provider operator registration, company SIM, or identity/KYC contact.

- Otya ID authenticates the person and owns login/recovery credentials.
- OtyaPoint staff membership links that identity to a legal company.
- Employee profile records employment status and employment details.
- Outlet assignment records where the employee is permitted to work and when.
- Permission grant gives a narrowly scoped capability, with a start time and optional expiry.
- Provider operator profile links an employee to a provider-approved operator identity for one provider outlet account.
- Company SIM/device assignment records which company asset is in the employee's custody. It does not grant provider access by itself.
- Provider KYC verification records the outcome/evidence reference for that employee and provider. It is separate from the operational SIM/MSISDN.

## Authorization rule

Every protected API request must pass all applicable checks on the server:

1. The Otya identity token/session is valid.
2. The company staff membership is active.
3. A current permission grant exists for the requested permission.
4. The grant scope matches the requested company, outlet, provider account, or the employee's own records.
5. For outlet scope, the employee and outlet assignment are active and within their validity dates.
6. For provider-account scope, the employee has an approved provider operator profile, the provider agreement and provider outlet account are active, and the employee has an active assignment to that outlet.
7. Sensitive operations also satisfy their maker-checker/approval rules.

The default is deny. A UI role, hidden menu item, client-provided staff ID, branch ID, provider ID, SIM number or job title is not proof of authorization.

SOVEREIGN is the company owner role. Existing active sovereign owners receive explicit company-wide grants during migration. No other role receives automatic access. A manager/teller/cashier can have multiple duties by receiving multiple grants, without receiving unrelated permissions.

## Legacy endpoint containment

The first authorization-enforcement tranche only grants access to existing company-wide legacy records through explicit company-scope grants (and own-record reads through SELF grants). Outlet/provider-account scoped grants are supported by the shared authorization evaluator, but must not be used with a legacy endpoint that does not bind its data query to the same outlet/provider account.

This is intentionally fail-closed: a teller with only an outlet/provider-account grant cannot use a company-wide legacy query to see another outlet's records. The next data/API tranche must move the relevant sales, stock, agency evidence and reports to outlet/provider-account scoped queries before granting those routes narrower-scope access.

## KYC and phone/SIM separation

Otya must not infer a KYC identity/contact number from a business SIM or agent line.

- A company SIM is stored in omni_company_sim_cards and issued through omni_sim_assignments.
- Provider-approved operator identity is stored in omni_provider_operator_profiles.
- Provider-specific KYC status/evidence is stored in omni_employee_provider_kyc.
- identity_contact_reference is an opaque pointer to the approved identity/PII system; identity_contact_last4 is only a masked cross-check. Do not store a raw national ID, provider PIN, OTP, password, or full personal contact number in this table.
- Full identity documents, where legally required and approved, belong in private evidence storage with restricted access and retention rules, not public repositories or UI logs.

## Initial permission catalog

| Permission | Intended use |
|---|---|
| retail.sell | Create retail cash sales |
| retail.inventory.read | View stock in assigned outlet |
| retail.inventory.manage | Receive, transfer or adjust stock |
| agency.records.read.assigned | Read permitted agency records |
| providers.operate | Use an approved assigned provider account |
| providers.read.assigned | View assigned provider account details |
| providers.manage | Manage provider relationships and outlet account records |
| evidence.submit | Submit a transaction record/evidence for review |
| evidence.review | Review evidence; sensitive and maker-checker controlled |
| identity.kyc.read | View restricted provider KYC verification status |
| identity.kyc.manage | Record/review provider KYC evidence |
| finance.read | View company financial reports and ledger |
| finance.approve | Approve financial adjustments/reconciliation |
| staff.manage | Manage invitations and staff access |
| hr.read / hr.manage | View/manage restricted employment records |
| sims.assign / devices.assign | Control company asset custody |

## Required workflow examples

### Retail-only cashier
Grant retail.sell and, where needed, retail.inventory.read for their assigned outlet. Do not grant agency.records.read.assigned, providers.operate, identity.kyc.read, finance.read, or staff.manage.

### Mobile-money teller
Grant providers.operate, agency.records.read.assigned, and evidence.submit only for the assigned provider account/outlet. The employee must have an approved provider operator profile for that provider account. This does not provide retail POS, HR or finance-management access.

### Dual-duty worker
A worker doing both retail and agency receives both separate permission sets. This is an explicit dual assignment—not a general attendant/worker role that automatically unlocks both modules.

### KYC officer
Grant identity.kyc.read and/or identity.kyc.manage only as required. It does not grant provider account operation, cash handling, retail sales or company-wide finance permissions.

## Release boundaries

- No provider PINs, passwords or OTPs are stored.
- No provider payment execution is enabled by this change.
- No migration is applied to remote D1 databases.
- No Worker, secret, provider contract, company record, staff member or live transaction is created or modified.
- No deployment or production release is performed.
