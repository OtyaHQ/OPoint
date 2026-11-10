# Quickteller Business — integration readiness

**Provider boundary:** Quickteller Business is a separate Interswitch product integration. Do not reuse its credentials, token, merchant identifiers, checkout flow or payload assumptions in the InterSwitch Marketplace Routing Bills Payment adapter.

## Current implementation status

- The Quickteller Business account has been reported as Test mode with onboarding incomplete.
- OtyaPoint now contains an isolated sandbox client for OAuth 2.0 token acquisition and read-only transaction-status enquiry.
- The client has no payment-initiation, refund, payout, wallet-balance or live endpoint method.
- The client is not yet bound to the deployed OtyaPoint Worker because the expected Quickteller entries are not present in the connected Cloudflare Secrets Store. No Quickteller request has been sent from OtyaPoint and no provider payment route is enabled.
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

Store all four as account-level secrets scoped to `workers`, then bind them only to `otyapoint-api`. Do not bind a credential to Otya Auth, Otya Core, Otya Next, Otya Media or another product unless that product has a documented need. Do not add a binding until the named secret exists and its scope includes `workers`. Cloudflare's Secrets Store API never returns a secret value after creation; metadata listing can confirm only the name, status and scopes.

The dashboard's `Data Ref`, QR Merchant ID and TILL Alias fields must remain separately classified. Their exact API meaning has not been established from the documented WebPay transaction flow; do not map them to Pay Item ID, QR ID or Till Alias by guessing. Confirm their usage against the country/product-specific contract with Interswitch.

Only configure a newly issued or rotated client secret. Any secret previously pasted into chat, tickets, source control or shared workspaces must be considered compromised and replaced before use.

## Sandbox authentication and status enquiry

The official Interswitch documentation describes OAuth 2.0 client-credentials authentication. Otya's isolated sandbox client uses:

`POST https://passport-sandbox.interswitchng.com/passport/oauth/token?grant_type=client_credentials`

The server constructs the Basic Authorization value from the Quickteller Business Client ID and Client Secret, requests the short-lived access token over HTTPS, and caches it only until shortly before expiry. It never logs the Basic credential, access token or Authorization header.

The read-only transaction-status enquiry uses the documented sandbox API reference:

`GET https://sandbox.interswitchng.com/api/v3/purchases?transactionRef={reference}&amount={amount}`

For this API reference, the transaction amount is documented in the major denomination. Pass the exact amount used for the original transaction; do not copy a create-payment amount into the requery call without applying the endpoint's own amount convention. The client reports success only when the provider returns `ResponseCode = "00"` **and** the returned amount matches the amount supplied for verification. Any other result remains unconfirmed.

Interswitch's FAQ lists `UGX = 800` as a supported currency code. Confirm the merchant account's actual Uganda product, currency, settlement and transaction permissions with Interswitch before building the payment-initiation flow. The QuickStart payment-initiation guide describes amounts in minor currency for its separate creation flow; do not confuse that convention with the status API's documented amount parameter.

Quickteller Business test mode does not support webhook URLs; Interswitch supplies a transaction-confirmation endpoint for test verification. A browser return page, client-side callback or HTTP success alone is never proof that a payment succeeded.

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
