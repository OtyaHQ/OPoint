# Quickteller Business — integration readiness

**Product boundary:** Quickteller Business is its own payment integration. Do not reuse its credentials, authentication tokens, merchant identifiers or payload assumptions in the separate InterSwitch Marketplace Routing Bills Payment adapter.

## Current status

- The supplied Quickteller Business account is in Test mode and its onboarding is incomplete.
- The current OtyaPoint Worker source does not contain a Quickteller adapter or a customer-facing payment route.
- OtyaPoint's agency transaction write route remains disabled. No Quickteller or other provider money movement is enabled.
- A test-mode dashboard credential is not evidence of production approval, a live merchant account, or authorization to process Uganda customer payments.

## Credential custody

Use Cloudflare Secrets Store for the OtyaPoint Worker only. Never commit provider credentials to GitHub, store them in D1/KV/R2, put them in browser/mobile code, place them in a shared Postman environment, or print them in logs.

When a dedicated Quickteller adapter is implemented and reviewed, the proposed server-side names are:

| Cloudflare Secrets Store name | Purpose |
|---|---|
| `QUICKTELLER_CLIENT_ID` | Quickteller Business application identifier |
| `QUICKTELLER_CLIENT_SECRET` | Quickteller Business OAuth client secret |
| `QUICKTELLER_MERCHANT_CODE` | Merchant/account identifier |
| `QUICKTELLER_PAY_ITEM_ID` | Product/service payment-item identifier |

Keep the names above scoped to the OtyaPoint Worker. Store the identifiers in Secrets Store as well as the secret, so the full merchant configuration stays server-side. Do not add these bindings until the adapter reads and validates them. Do not use plain `vars` for credentials.

The dashboard's `Data Ref`, QR Merchant ID and TILL Alias fields must remain separately classified. The exact API meaning and usage of `Data Ref` has not been confirmed against a country-specific Quickteller Business contract. Do not map it to a request field, Pay Item ID, QR ID or Till Alias by guessing. Confirm the exact contract with Interswitch support first. A blank QR Merchant ID is not a value to fabricate.

Only configure a newly issued or rotated client secret. Any secret previously pasted into chat, tickets, source control or shared workspaces must be considered compromised and replaced before use. Do not copy it into Cloudflare.

## Authentication and test-mode notes

The official Interswitch documentation describes OAuth 2.0 client-credentials authentication for Quickteller Business. The documented sandbox token endpoint is:

`POST https://passport-sandbox.interswitchng.com/passport/oauth/token?grant_type=client_credentials`

The server constructs the Basic Authorization credential from the Quickteller Business Client ID and Client Secret, requests the short-lived access token over HTTPS, and keeps that token server-side. Never log the Basic credential, client secret, token or Authorization header.

Quickteller Business test mode does not support configuring customer webhook URLs; use the provider's documented transaction-confirmation/status flow for sandbox verification. Do not treat a browser return page or an HTTP success alone as proof that a payment succeeded.

Official references:
- [Getting Integration Credentials](https://docs.interswitchgroup.com/docs/getting-integration-credentials)
- [Authentication](https://docs.interswitchgroup.com/docs/authentication)
- [Generate Access Token](https://docs.interswitchgroup.com/reference/generate-access-token)
- [Quickteller Business](https://docs.interswitchgroup.com/docs/quickteller-business)
- [Frequently Asked Questions](https://docs.interswitchgroup.com/docs/frequently-asked-questions)

## Required implementation gates

Before enabling even a sandbox payment submission, implement and test:

1. A dedicated Quickteller Business provider adapter, not an extension that silently reuses Marketplace Routing credentials or payloads.
2. Server-side OAuth token acquisition, bounded timeouts, token lifetime handling and redaction.
3. Strict input validation and a unique OtyaPoint idempotency key for every payment intent.
4. A durable local record before provider submission, with distinct PENDING, SUCCEEDED, FAILED and UNKNOWN outcomes.
5. Provider status enquiry by the same reference after timeouts; never blindly retry an unknown outcome.
6. Signature/authentication verification for any supported callback mechanism and replay protection.
7. Reconciliation, settlement and fee accounting that preserve the separation between retail cash and agency float.
8. Automated tests for token errors, duplicate submissions, network timeouts, provider declines, status mismatches and recovery.

Before live mode, complete the provider's onboarding/KYC and obtain explicit live approval. Confirm that the specific Quickteller Business product and agreement support the intended Uganda use case, currencies, settlement bank, transaction types, fees, refunds/reversals and dispute handling. Do not infer a Uganda-specific requirement from Nigeria-only documentation examples. Obtain the required Ugandan legal, tax and regulatory review before offering a regulated payment or agency service.

## Release rule

Quickteller remains **not enabled** until all gates above are evidenced in code, automated tests, provider approval and the operations runbook. Adding credentials alone must never activate a payment route.
