import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../../wrangler.opoint-staging.toml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../backend/src/index.mjs", import.meta.url), "utf8");
const cloudflare = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
const apiDeploy = readFileSync(new URL("../../.github/workflows/deploy-opoint-staging.yml", import.meta.url), "utf8");
const dashboardDeploy = readFileSync(new URL("../../.github/workflows/deploy-opoint-dashboard-staging.yml", import.meta.url), "utf8");

test("OtyaPoint staging API is private and can only be reached through service bindings", () => {
  assert.match(manifest, /^workers_dev\s*=\s*false\s*$/m);
  assert.match(manifest, /\[\[services\]\]\s*\n\s*binding\s*=\s*"OTYA_ID"\s*\n\s*service\s*=\s*"otya-id-staging"/);
  assert.doesNotMatch(manifest, /custom_domain\s*=\s*true|\bworkers_dev\s*=\s*true/);
  assert.match(worker, /env\.OTYA_ID/);
  assert.doesNotMatch(worker, /env\.AUTH\b/);
});

test("OtyaPoint dashboard Worker has no public workers.dev or version preview URL", () => {
  assert.match(cloudflare, /workersDev:\s*false/);
  assert.match(cloudflare, /previewUrls:\s*false/);
  assert.match(cloudflare, /worker:\s*"otya-id-staging"/);
  assert.match(cloudflare, /worker:\s*"opoint-api-staging"/);
  assert.doesNotMatch(cloudflare, /domains:\s*\[/);
});

test("OtyaPoint staging cannot initiate payments, provider calls, or AI", () => {
  for (const feature of ["PAYMENT_EXECUTION_ENABLED", "PROVIDER_EXECUTION_ENABLED", "AI_ENABLED"]) {
    assert.match(manifest, new RegExp("^" + feature + '\\s*=\\s*"false"\\s*$', "m"));
  }
  assert.match(manifest, /^ENVIRONMENT\s*=\s*"staging"\s*$/m);
});

test("API release is gated, applies migrations, verifies private identity bindings, and has no legacy public URL", () => {
  assert.match(apiDeploy, /workflow_dispatch:/);
  assert.match(apiDeploy, /DEPLOY-STAGING/);
  assert.match(apiDeploy, /d1 migrations apply opoint-staging-db --remote/);
  assert.match(apiDeploy, /service == 'otya-id-staging'/);
  assert.match(apiDeploy, /PAYMENT_EXECUTION_ENABLED/);
  assert.match(apiDeploy, /previews_enabled == false/);
  assert.doesNotMatch(apiDeploy, /petersmartlink\.workers\.dev|petersmartlink\.com/);
  assert.doesNotMatch(apiDeploy, /Smoke test deployed OtyaPoint staging API/);
});

test("dashboard release is manual, identity-gated, uses Vinext, and remains private", () => {
  assert.match(dashboardDeploy, /workflow_dispatch:/);
  assert.match(dashboardDeploy, /github\.ref == "refs\/heads\/main"/);
  assert.match(dashboardDeploy, /DEPLOY-STAGING/);
  assert.match(dashboardDeploy, /CLOUDFLARE_API_TOKEN_STAGING/);
  assert.match(dashboardDeploy, /workers\/scripts\/otya-id-staging/);
  assert.match(dashboardDeploy, /workers\/scripts\/opoint-api-staging/);
  assert.match(dashboardDeploy, /npx @vinext\/cloudflare deploy --env staging --dry-run/);
  assert.match(dashboardDeploy, /npx @vinext\/cloudflare deploy --env staging/);
  assert.match(dashboardDeploy, /workers\/scripts\/opoint-dashboard-staging\/subdomain/);
  assert.doesNotMatch(dashboardDeploy, /wrangler deploy|petersmartlink/);
});
