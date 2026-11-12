import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyName, normalizeSlug, isUGXAmount, maskPhone, maskEmail } from "../src/index.mjs";

test("normalizes company names and slugs", () => {
  assert.equal(normalizeCompanyName("  Otya Holdings   Limited "), "Otya Holdings Limited");
  assert.equal(normalizeSlug("Mbirizi Shop & Electronics"), "mbirizi-shop-electronics");
});

test("accepts only safe non-negative integer UGX amounts", () => {
  assert.equal(isUGXAmount(0), true);
  assert.equal(isUGXAmount(125000), true);
  assert.equal(isUGXAmount(-1), false);
  assert.equal(isUGXAmount(1.5), false);
  assert.equal(isUGXAmount(Number.MAX_SAFE_INTEGER + 1), false);
});

test("masks phone and email values", () => {
  assert.equal(maskPhone("+256772123456"), "••••••3456");
  assert.equal(maskPhone("123"), "****");
  assert.equal(maskEmail("peter@example.com"), "p***@example.com");
  assert.equal(maskEmail("not-an-email"), null);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

test("staging identity service never binds to production Auth", () => {
  const config = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../wrangler.toml"), "utf8");
  assert.match(config, /binding\s*=\s*"OTYA_ID"[\s\S]*?service\s*=\s*"otya-id-staging"/);
  assert.doesNotMatch(config, /service\s*=\s*"otya-auth"/);
  assert.match(config, /ENVIRONMENT\s*=\s*"staging"/);
});

test("OtyaPoint staging deployment is manual and waits for isolated Otya ID", () => {
  const manifest = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy-opoint-staging.yml", import.meta.url), "utf8");
  assert.match(manifest, /name = "opoint-api-staging"/);
  assert.match(manifest, /workers_dev = false/);
  assert.match(manifest, /ENVIRONMENT = "staging"/);
  assert.match(manifest, /binding = "OTYA_ID"[\\s\\S]*?service = "otya-id-staging"/);
  assert.doesNotMatch(manifest, /service = "otya-auth"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /DEPLOY-STAGING/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN_STAGING/);
  assert.match(workflow, /workers\\/scripts\\/otya-id-staging\\/settings/);
  assert.match(workflow, /wrangler@4\\.159\\.0 deploy --config cloudflare-api\\/staging\\/wrangler\\.toml/);
  assert.match(workflow, /binding\\.service !== 'otya-id-staging'/);
});
