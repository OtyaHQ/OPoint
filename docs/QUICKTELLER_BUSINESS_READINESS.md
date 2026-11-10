# Quickteller Business — integration readiness

**Provider boundary:** Quickteller Business is a separate Interswitch product integration. Do not reuse its credentials, token, merchant identifiers, checkout flow or payload assumptions in the InterSwitch Marketplace Routing Bills Payment adapter.

## Current implementation status

- The current onboarding path is the owner's individual/personal stage; the future company profile will be introduced only after the company documents are verified by Interswitch.
- For the API integration, the current profile must be an **Individual Business** profile inside Quickteller Business, not a consumer Quickteller wallet. Confirm the exact account-type label in the merchant dashboard before using it for merchant acceptance.
- OtyaPoint contains an isolated sandbox client for OAuth 2.0 token acquisition and read-only transaction-status enquiry.
- The client has no payment-initiation, refund, payout, wallet-balance or live endpoint method.
- The four Quickteller credential entries are present and active in the connected Cloudflare account Secrets Store, scoped to Workers, and are now bound only to the private `otyapoint-api` Worker. Metadata confirms their names and status, not that the stored values successfully authenticate with Interswitch.
- The current Worker source still exposes no Quickteller payment-initiation, refund, payout or provider-status route. No Quickteller request has been sent from OtyaPoint and no provider payment route is enabled.
- OtyaPoint's agency transaction write route remains disabled. This source addition does not enable money movement.

## Credential custody

Use Cloudflare Secrets Store for the OtyaPoint Worker only. Never commit provider credentials to GitHub, store them in D1/KV/R2, put them in browser/mobile code, place them in a shared Postman environment, or print them in logs.

The expected server-side names are:

| Cloudflare Secrets Store name | Purpose |
|---|---|
| `QUICKTELLER_CLIENT_ID` | Quickteller Business application identifier |
| `QUICKTELLER_CLIENT_SECRET` | Rotated Quickteller Business secret key |
| `QUICKTELLER_MERCHANT_CODE` | Merchant/account identifier |
| `QUICKTELLER_PAY_ITEM_ID` | Product/service payment-item identifier |

Store all four as account-level secrets scoped to `workers`, then bind them only to `otyapoint-api`. The four expected names are now present and active in the connected Secrets Store. Do not bind a credential to Otya Auth, Otya Core, Otya Next, Otya Media or another product unless that product has a documented need. Cloudflare's Secrets Store API never returns a secret value after creation; metadata listing can confirm only the name, status and scopes.

The dashboard's `Data Ref`, QR Merchant ID and TILL Alias fields must remain separately classified. Their exact API meaning has not been established from the documented WebPay transaction flow; do not map them to Pay Item ID, QR ID or Till Alias by guessing. Confirm their usage against the country/product-specific contract with Interswitch.

Only configure a newly issued or rotated client secret. Any secret previously pasted into chat, tickets, source control or shared workspaces must be considered compromised and replaced before use.

## Sandbox authentication and status enquiry

The official Interswitch documentation describes OAuth 2.0 client-credentials authentication. Otya's isolated sandbox client uses:

`POST https://passport-sandbox.interswitchng.com/passport/oauth/token?grant_type=client_credentials`

The server constructs the Basic Authorization value from the Quickteller Business Client ID and Client Secret, requests the short-lived access token over HTTPS, and caches it only until shortly before expiry. It never logs the Basic credential, access token or Authorization header.

The read-only transaction-status enquiry uses the documented sandbox API reference:

`GET https://sandbox.interswitchng.com/api/v3/purchases`

Send `Authorization: Bearer <token>`, `amount: <major-unit amount>` and `transactionRef: <original reference>` as **HTTP headers**. The endpoint documents the amount in the major denomination. This differs from the Web Checkout payment-creation flow, which uses its own request contract and expects amount in minor currency. Do not mix the status endpoint's headers, Web Checkout's `merchant_code` / `pay_item_id` body fields, or InterSwitch Marketplace Routing's credentials.

The sandbox status client reports success only when the provider returns `responseCode = "00"` (or the documented legacy `ResponseCode`) **and** the returned amount exactly matches the original amount. Any other result remains unconfirmed. A 404, timeout, amount mismatch or malformed payload must never be treated as a successful payment.

Interswitch lists `UGX = 800` as a supported currency code and lists Uganda payment methods separately. This confirms that UGX exists in its broader API materials, not that this particular Quickteller Business merchant profile is approved for Uganda. Confirm the account's country, product, UGX settlement bank, payment methods and limits with Interswitch before enabling checkout.

### Individual profile now; company profile later

Interswitch documents an `Individual Business` account type with personal information fields (first name, last name, phone and date of birth). Its generic KYC page also mentions BVN and a 500k settlement cap for that profile. The BVN wording is Nigeria-oriented; do **not** assume it is applicable to a Uganda account or submit an unrelated/national identifier in its place. Ask Interswitch to confirm the correct Uganda ID, proof-of-address, settlement-account and individual-profile limits in writing.

When the company documents are verified and Interswitch approves the company profile, expect the merchant profile and possibly the merchant code / Pay Item ID / integration credentials to change. Treat that as a provider-account migration: verify the new profile and currency, rotate/reissue any affected credentials, update the OtyaPoint Secrets Store values, test against the new sandbox/approved live account, and only then switch the active merchant profile. Do not assume that an individual profile's settlement history or limits transfer automatically.

A browser return page or client-side callback is never proof that a payment succeeded. Use the provider's server-side confirmation contract for the exact payment product.

Official references:
- [Getting Integration Credentials](https://docs.interswitchgroup.com/docs/getting-integration-credentials)
- [Authentication](https://docs.interswitchgroup.com/docs/authentication)
- [Generate Access Token](https://docs.interswitchgroup.com/reference/generate-access-token)
- [Get Transaction Status](https://docs.interswitchgroup.com/reference/get-transaction-status)
- [Quickteller Business](https://docs.interswitchgroup.com/docs/quickteller-business)
- [QuickStart — Accept Your First Payment](https://docs.interswitchgroup.com/docs/quickstart-accept-your-first-payment)
- [Frequently Asked Questions](https://docs.interswitchgroup.com/docs/frequently-asked-questions)

## Remaining implementation gates

Before enabling a sandbox payment-initiation method, implement and test:

1. A dedicated Quickteller Business payment-initiation path based on the confirmed Uganda merchant contract; do not silently reuse InterSwitch Marketplace Routing APIs.
2. Durable transaction-intent creation in OtyaPoint before any provider request, with unique idempotency and immutable audit history.
3. Strict request validation, bounded timeouts, token lifetime handling, secret redaction and safe provider error mapping.
4. PENDING, SUCCEEDED, FAILED and UNKNOWN outcomes. Provider timeouts must remain UNKNOWN until the same reference is requeried.
5. Callback/replay controls only for callback mechanisms that the provider confirms are supported in the target mode and product.
6. Reconciliation, settlement and fee accounting that preserve the separation between retail cash and agency float.
7. Automated tests for token errors, duplicate submissions, network timeouts, provider declines, status mismatches and recovery.

Before live mode, complete provider onboarding/KYC and obtain explicit approval for the Quickteller Business service being used. Confirm the specific Uganda use case, currency, settlement bank, payment methods, fees, refunds/reversals and dispute handling with Interswitch. Obtain the required Ugandan legal, tax and regulatory review before offering regulated payment or agency services.

## Release rule

Quickteller remains **not enabled** until credentials are confirmed in Cloudflare, the provider adapter is bound and reviewed, payment-intent/reconciliation controls pass, provider approval is evidenced, and the complete test suite succeeds. Adding credentials alone must never activate a payment route.
