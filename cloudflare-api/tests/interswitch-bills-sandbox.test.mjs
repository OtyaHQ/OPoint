import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/providers/interswitch-bills-sandbox.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { InterSwitchBillsSandboxClient, BillsProviderError, INTERSWITCH_BILLS_SANDBOX_BASE } =
  await import(moduleUrl);

function clientWithFetch(handler, options = {}) {
  const calls = [];
  const client = new InterSwitchBillsSandboxClient({
    accessToken: "synthetic-sandbox-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    },
    ...options,
  });
  return { client, calls };
}

test("biller discovery uses the fixed Marketplace Routing sandbox", async () => {
  const { client, calls } = clientWithFetch(async () => Response.json({ success: true, data: [] }));
  const result = await client.getBillers();

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${INTERSWITCH_BILLS_SANDBOX_BASE}/v1/vas/billers`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer synthetic-sandbox-token");
});

test("payment-item lookup safely encodes the biller identifier", async () => {
  const { client, calls } = clientWithFetch(async () => Response.json({ success: true }));
  await client.getPaymentItems("BILLER_123");

  assert.equal(
    calls[0].url,
    `${INTERSWITCH_BILLS_SANDBOX_BASE}/v1/vas/billers/payment-item?biller-id=BILLER_123`,
  );
});

test("customer validation sends the documented array payload", async () => {
  const { client, calls } = clientWithFetch(async () => Response.json({ success: true }));
  await client.validateCustomer("customer-123", "PAYCODE");

  assert.deepEqual(JSON.parse(calls[0].init.body), [{
    customerId: "customer-123",
    paymentCode: "PAYCODE",
  }]);
});

test("payment submission is disabled by default and makes no network call", async () => {
  const { client, calls } = clientWithFetch(async () => Response.json({ success: true }));

  await assert.rejects(
    client.pay({
      customerId: "customer-123",
      paymentCode: "PAYCODE",
      reference: "OP-TEST-001",
      amount: 1000,
    }),
    error => error instanceof BillsProviderError && error.kind === "disabled",
  );
  assert.equal(calls.length, 0);
});

test("sandbox payment requires explicit opt-in and a positive integer amount", async () => {
  const { client, calls } = clientWithFetch(
    async () => Response.json({ success: true, data: { accepted: true } }),
    { allowSandboxPaymentSubmission: true },
  );

  await client.pay({
    customerId: "customer-123",
    paymentCode: "PAYCODE",
    reference: "OP-TEST-002",
    amount: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${INTERSWITCH_BILLS_SANDBOX_BASE}/v1/vas/pay`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    customerId: "customer-123",
    paymentCode: "PAYCODE",
    reference: "OP-TEST-002",
    amount: 1000,
  });
});

test("fractional, unsafe, zero and negative amounts are rejected before transport", async () => {
  const { client, calls } = clientWithFetch(
    async () => Response.json({ success: true }),
    { allowSandboxPaymentSubmission: true },
  );

  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      client.pay({
        customerId: "customer-123",
        paymentCode: "PAYCODE",
        reference: "OP-TEST-INVALID",
        amount,
      }),
      TypeError,
    );
  }
  assert.equal(calls.length, 0);
});

test("transport failures are sanitized and do not expose token or raw exception text", async () => {
  const { client } = clientWithFetch(async () => {
    throw new Error("synthetic failure contains synthetic-sandbox-token");
  });

  await assert.rejects(
    client.getBillers(),
    error => error instanceof BillsProviderError
      && error.kind === "transport"
      && !error.message.includes("synthetic-sandbox-token")
      && !error.message.includes("synthetic failure"),
  );
});

test("non-success HTTP response bodies are not exposed", async () => {
  const { client } = clientWithFetch(async () =>
    new Response("provider echoed sensitive customer data", { status: 502 }),
  );

  await assert.rejects(
    client.getBillers(),
    error => error instanceof BillsProviderError
      && error.kind === "http"
      && error.httpStatus === 502
      && !error.message.includes("customer data"),
  );
});

test("invalid biller IDs are rejected before transport", async () => {
  const { client, calls } = clientWithFetch(async () => Response.json({ success: true }));

  assert.throws(() => client.getPaymentItems("bad/id"), TypeError);
  assert.throws(() => client.getPaymentItems(0), TypeError);
  assert.equal(calls.length, 0);
});
