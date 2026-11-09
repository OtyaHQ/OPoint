import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../wrangler.local.toml", import.meta.url), "utf8");
const auth = readFileSync(new URL("../wrangler.auth-local.toml", import.meta.url), "utf8");
const mock = readFileSync(new URL("../cloudflare-api/dev-auth/index.mjs", import.meta.url), "utf8");

function requireMatch(source, pattern, message) {
  assert.match(source, pattern, message);
}

function forbidMatch(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

requireMatch(api, /^name\s*=\s*"otyapoint-api-local"$/m, "API local Worker name must be isolated");
requireMatch(api, /^workers_dev\s*=\s*false$/m, "API local config must not create a public workers.dev endpoint");
requireMatch(api, /database_name\s*=\s*"otyapoint-local"/, "API must use a local-only D1 name");
forbidMatch(api, /\[\[r2_buckets\]\]|\[\[kv_namespaces\]\]|\[\[queues\.producers\]\]/, "Unused R2, KV and Queue bindings must stay out until runtime code uses them");
requireMatch(api, /service\s*=\s*"otyapoint-auth-local"/, "API must use the synthetic local auth Worker");
requireMatch(api, /migrations_dir\s*=\s*"cloudflare-api\/migrations"/, "Local API must use the reviewed migration sequence");
forbidMatch(api, /remote\s*=\s*true/i, "Remote bindings are forbidden in local development");
forbidMatch(api, /custom_domain|routes?\s*=/i, "Local API config must not create public routes or custom domains");
forbidMatch(api, /otya-store-db|otya-auth-db|otyapoint-db|omnipoint-dev|petersmartlink\.com/i, "Production and legacy resource names must not appear in local config");
forbidMatch(api, /RESEND_API_KEY|QUICKTELLER|INTERSWITCH|AIRTEL|MTN|FCM_SERVICE_ACCOUNT/i, "Local config must not contain live provider configuration");

requireMatch(auth, /^name\s*=\s*"otyapoint-auth-local"$/m, "Synthetic auth Worker must have its own local name");
requireMatch(auth, /^workers_dev\s*=\s*false$/m, "Synthetic auth Worker must not expose a public endpoint");
requireMatch(auth, /LOCAL_AUTH_ONLY\s*=\s*"true"/, "Synthetic auth Worker must be explicitly local-only");
forbidMatch(auth, /remote\s*=\s*true|custom_domain|routes?\s*=|\[\[d1_databases\]\]|secrets_store_secrets/i, "Synthetic auth Worker must not use remote resources, routes or stored secrets");

requireMatch(mock, /LOCAL_AUTH_ONLY !== "true"/, "Synthetic auth code must fail closed unless local-only mode is explicit");
requireMatch(mock, /otya-local-test-token/, "Only the documented synthetic local token may pass");
requireMatch(mock, /synthetic-otyapoint-local-owner/, "Synthetic identity must match the local seed record");

console.log("Local OtyaPoint development configuration passed isolation checks.");
