import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../../wrangler.opoint-staging.toml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../backend/src/index.mjs", import.meta.url), "utf8");

test("OtyaPoint staging API is private and can only be reached through service bindings", () => {
  assert.match(manifest, /^workers_dev\s*=\s*false\s*$/m);
  assert.match(manifest, /\[\[services\]\]\s*\n\s*binding\s*=\s*"OTYA_ID"\s*\n\s*service\s*=\s*"otya-id-staging"/);
  assert.doesNotMatch(manifest, /custom_domain\s*=\s*true|\bworkers_dev\s*=\s*true/);
  assert.match(worker, /env\.OTYA_ID/);
  assert.doesNotMatch(worker, /env\.AUTH\b/);
});

test("OtyaPoint staging cannot initiate payments, provider calls, or AI", () => {
  for (const feature of ["PAYMENT_EXECUTION_ENABLED", "PROVIDER_EXECUTION_ENABLED", "AI_ENABLED"]) {
    assert.match(manifest, new RegExp("^" + feature + '\\s*=\\s*"false"\\s*$', "m"));
  }
  assert.match(manifest, /^ENVIRONMENT\s*=\s*"staging"\s*$/m);
});
