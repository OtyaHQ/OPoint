# Merchant identity and legal-entity transition runbook

**Status:** Preparation only. Otya Holdings Limited registration is in progress; no company merchant conversion or settlement transfer is represented as completed.

## 1. Identity rules

Keep these identities separate in all services and records:

| Field | Current value / rule | Use |
|---|---|---|
| Current individual merchant/legal account holder | **Peter Katabira** | Use the verified full legal name for current individual KYC, account ownership, tax, bank, contractual or regulated fields that ask for the account holder or proprietor. |
| Public umbrella brand | **Otya** | Website, ecosystem, public communications and product family. |
| Shop and agency product / storefront brand | **OtyaPoint** | Retail, phones/accessories, electronics, mobile-money agency, bills and airtime service experience. Use as an individual profile's trade/display name only when the provider explicitly supports and approves that field. |
| Intended parent company | **Otya Holdings Limited** | Future corporate identity only after URSB incorporation and provider acceptance. Do not enter it as an already registered merchant, settlement beneficiary, company taxpayer or legal controller while registration remains in progress. |
| Product brands | **Otya Media**, **OtyaHub**, **Otya End**, **Otya OS**, **Next** | Product names; none is the legal merchant or account owner. |

Do not substitute a brand for a legal name, and do not add “Limited” to the current individual merchant record. Where a provider offers separate Legal/Registered Business Name and Store/Trading Name fields, enter each according to the field label and provider instructions; obtain provider approval before publishing OtyaPoint as a trade name.

## 2. Current operating position

- Merchant/provider profiles currently remain in the individual account holder's legal name: **Peter Katabira**.
- OtyaPoint is the intended public shop and agency brand.
- Otya Holdings Limited is still in the URSB registration process.
- The Quickteller Business integration currently uses sandbox credentials for a non-transactional owner-only OAuth diagnostic. A successful sandbox token check would not constitute live merchant verification, Uganda product eligibility or settlement approval.
- Real-money payment execution, payout, refund automation and provider writes remain disabled in this product release.
- Do not close, rename, transfer or replace an active individual merchant profile until outstanding balances, refunds, disputes, settlements, exports and record-retention requirements are checked.

## 3. Before incorporation is complete

1. Continue using Peter Katabira where a provider, bank, tax authority or contract asks for the current verified individual holder.
2. Use OtyaPoint only in a provider-approved display/trading-name field. If the portal has no such field or approval is unclear, leave the field unchanged and ask the provider.
3. Keep bank and settlement details aligned with the currently verified individual merchant profile. Never route company revenue to a different beneficiary without provider and bank approval.
4. Do not create fictitious company identifiers, company TINs, registration dates, certificates, directors or settlement details.
5. Maintain a dated inventory of each provider's merchant ID, legal account type, displayed name, settlement beneficiary, currency, permitted products, live/test status, limits, fees, credentials and support case. Store secrets only in the approved secret manager, never in this document or GitHub.
6. Do not use a personal merchant profile to imply that Otya Holdings Limited is already the contracting party.

## 4. URSB and URA documents after incorporation

When URSB registration is complete, collect and verify the actual issued documents before changing any provider profile:

- Certificate of Incorporation for Otya Holdings Limited.
- Company Form 20 / current company particulars showing directors and official details, as required by URA and the provider.
- Company non-individual TIN issued by URA.
- Company bank-account confirmation and settlement account details in the exact company name.
- Company registered and operating addresses, contact details and business activity information.
- Any trading licence, beneficial-ownership, board-authorisation, director/authorised-signatory identification or sector-specific document requested by the provider or authority.

The exact package must follow current provider and Ugandan authority instructions. Never upload documents to an unverified contact or share identity documents through public GitHub, chat logs or the OtyaHub public repository.

Official Uganda references (checked 10 November 2026):
- URSB company registration: https://ursb.go.ug/services/business-registration/
- URSB eRegistry: https://eregistry.ursb.go.ug/
- URA non-individual TIN requirements: https://ura.go.ug/en/domestic-taxes/tin-application/tin-registration-non-individual/
- URA business formalisation: https://ura.go.ug/en/business-formalisation/

URA identifies Certificate of Incorporation and Company Form 20 as mandatory for a private company's non-individual TIN application. Verify current instructions when filing.

## 5. Quickteller Business / Interswitch transition

Treat Quickteller Business as an Interswitch product; do not confuse it with the separate Interswitch Marketplace Routing API.

Before changing the current profile, request written confirmation from Interswitch/Quickteller Business for the **Uganda** profile:

1. Whether an individual account can be converted to a Registered Business profile or whether a separate company business profile must be created.
2. Whether Otya Holdings Limited can be onboarded for the intended Uganda product and whether UGX settlement is supported for the specific service.
3. Which exact company KYC documents, beneficial-owner details, authorised signatories, company TIN and bank confirmation are required.
4. Whether OtyaPoint can be recorded as the storefront/trading display name, and what proof of trading-name registration or approval is needed.
5. Which payment products, agency/collections use cases, settlement timelines, fees, limits, chargeback/refund rules and compliance conditions apply in Uganda.
6. Whether the existing individual profile's merchant code, Pay Item ID, Client ID, transaction history, reports, settlement instructions, limits or API credentials can be retained. Assume **no transfer** until the provider confirms it in writing.
7. Whether both individual and company business profiles may remain under the same login during migration, and how transactions or unresolved disputes are attributed during the transition.

Official provider references:
- Quickteller Business onboarding and multiple business accounts: https://docs.interswitchgroup.com/docs/quickteller-business
- Quickteller Business KYC overview: https://docs.interswitchgroup.com/docs/kyc-requirements
- Integration credential definitions: https://docs.interswitchgroup.com/docs/getting-integration-credentials

The published KYC overview includes BVN language and individual-account settlement limits that may reflect specific markets and account types. Do not apply Nigeria-specific BVN, NGN or stated limits to Uganda without written Uganda-specific confirmation. The provider's general onboarding guide says a registered business name must match its registration documents, and that Test mode is not approval to go Live.

## 6. Controlled change sequence after provider approval

Only after incorporation, company TIN, bank details and written provider approval:

1. Create or convert the **Registered Business** merchant profile using the exact company name from the Certificate of Incorporation. Use OtyaPoint as a trade/display name only in the permitted field.
2. Add Peter Katabira as an authorised primary contact or administrator only if the company formally authorises him and the provider accepts that role. Keep director and beneficial-owner details exact.
3. Set the approved company-owned settlement beneficiary and validate account name, currency, bank, settlement timing and test settlement evidence with the provider.
4. Obtain new company merchant identifiers and credentials where issued. Do not assume personal merchant credentials carry over.
5. Store new production credentials in Cloudflare Secrets Store, separated by provider and environment. Rotate/revoke old secrets only after provider-approved cutover and a successful rollback/credential-recovery check.
6. Run authenticated non-financial readiness checks first. Then run only the provider-approved test transactions. Do not enable live payments until compliance, callback authenticity, idempotency, reversal/refund, settlement and reconciliation controls are verified.
7. Record the provider approval reference, effective date, legal entity name, settlement account verification and exact cutover/rollback window in the restricted company record.
8. Preserve individual-account statements, transaction evidence, refunds, disputes and tax records as legally required. Do not merge the histories as though a company was the original merchant.

## 7. OtyaPoint product and data model rules

- Keep company_id as an internal stable tenant identifier. The existing omnipoint-default value is a legacy data key and must not be changed by a display-name edit.
- Do not rename D1 tables, indexes, migration identifiers, Worker names, routes, API properties, merchant credential bindings or stored records merely to make the UI look branded.
- Customer receipts and screens may display OtyaPoint and the provider-approved storefront/trading name, while required receipts, tax invoices and regulatory records must show the actual merchant/taxpayer identity and required TIN/details for the transaction.
- Do not claim that OtyaPoint is a registered company. Do not claim Otya Holdings Limited is incorporated until URSB has issued the certificate.
- Any post-incorporation controller/merchant change must be reflected in Privacy, Terms, customer receipts, support notices, vendor agreements and data-processing records before the change takes effect.

## 8. Release gate

A company merchant transition is complete only when all applicable items below have evidence:

- [ ] URSB Certificate of Incorporation verified.
- [ ] URA non-individual company TIN verified.
- [ ] Company bank and settlement beneficiary verified.
- [ ] Written Uganda-specific provider KYC and eligibility approval received.
- [ ] Legal name and trade/display-name fields independently checked.
- [ ] Provider confirms what happens to old merchant identifiers, reports, history and pending transactions.
- [ ] New API credentials stored and tested securely; no secret appears in GitHub or application logs.
- [ ] Callback, idempotency, duplicate, refund/reversal and settlement reconciliation tests pass.
- [ ] Privacy, Terms, receipt/invoice and data-retention language updated.
- [ ] Owner approves an exact controlled cutover and rollback plan.

Until then, keep the merchant legal identity as Peter Katabira and keep OtyaPoint as the product/storefront brand only where provider policy permits it.
