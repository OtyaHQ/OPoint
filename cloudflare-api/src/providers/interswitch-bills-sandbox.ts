/**
 * InterSwitch Marketplace Routing Bills Payment — sandbox-only client.
 *
 * This module is deliberately not wired into the OtyaPoint Worker router,
 * UI, ledger, queue, or any customer-facing workflow. It supports only the
 * documented shared sandbox hostname; there is no live endpoint in this
 * client. No network request occurs until a caller invokes a method.
 *
 * Never pass provider credentials from a browser/mobile client, commit them,
 * or include them in logs. A caller supplies a short-lived sandbox access
 * token from a trusted server-side credential flow.
 */

export const INTERSWITCH_BILLS_SANDBOX_BASE =
  "https://sandbox.interswitchng.com/marketplace-routing/api";

export type BillsApiEnvelope<T = unknown> = Record<string, unknown> & {
  success?: boolean;
  code?: string;
  message?: string;
  data?: T;
};

export type BillsClientOptions = {
  accessToken: string;
  fetchImpl?: typeof fetch;
  /** Explicit opt-in for an isolated sandbox payment test. Defaults to false. */
  allowSandboxPaymentSubmission?: boolean;
  timeoutMs?: number;
};

export class BillsProviderError extends Error {
  readonly kind: "disabled" | "transport" | "http" | "invalid_response";
  readonly httpStatus?: number;

  constructor(
    kind: BillsProviderError["kind"],
    message: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "BillsProviderError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

function requireText(value: unknown, field: string, max = 180): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value.trim();
}

function requirePositiveIntegerAmount(value: unknown): number {
  // Preserve integer UGX-like amount semantics without claiming the provider's
  // amount scale. Minor-unit conversion is deliberately not guessed here.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Invalid amount");
  }
  return value;
}

export class InterSwitchBillsSandboxClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly allowPayment: boolean;
  private readonly timeoutMs: number;

  constructor(options: BillsClientOptions) {
    this.token = requireText(options.accessToken, "accessToken", 8192);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowPayment = options.allowSandboxPaymentSubmission === true;
    this.timeoutMs = options.timeoutMs ?? 8000;

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) {
      throw new TypeError("timeoutMs must be an integer between 1000 and 30000");
    }
  }

  getBillers(): Promise<BillsApiEnvelope> {
    return this.request("GET", "/v1/vas/billers");
  }

  getPaymentItems(billerId: string | number): Promise<BillsApiEnvelope> {
    const id = typeof billerId === "number"
      ? (Number.isSafeInteger(billerId) && billerId > 0 ? String(billerId) : "")
      : requireText(billerId, "billerId", 64);

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new TypeError("Invalid billerId");
    }

    const query = new URLSearchParams({ "biller-id": id });
    return this.request("GET", `/v1/vas/billers/payment-item?${query.toString()}`);
  }

  validateCustomer(customerId: string, paymentCode: string): Promise<BillsApiEnvelope> {
    const payload = [{
      customerId: requireText(customerId, "customerId", 180),
      paymentCode: requireText(paymentCode, "paymentCode", 80),
    }];

    // Mirrors the supplied dashboard example. Confirm the exact schema against
    // the provider's sandbox contract before enabling this integration.
    return this.request("POST", "/v1/vas/validate-customer", payload);
  }

  pay(input: {
    customerId: string;
    paymentCode: string;
    reference: string;
    amount: number;
  }): Promise<BillsApiEnvelope> {
    if (!this.allowPayment) {
      throw new BillsProviderError("disabled", "InterSwitch sandbox payment submission is disabled.");
    }

    const payload = {
      customerId: requireText(input.customerId, "customerId", 180),
      paymentCode: requireText(input.paymentCode, "paymentCode", 80),
      reference: requireText(input.reference, "reference", 128),
      amount: requirePositiveIntegerAmount(input.amount),
    };

    return this.request("POST", "/v1/vas/pay", payload);
  }

  getTransaction(requestReference: string): Promise<BillsApiEnvelope> {
    const reference = requireText(requestReference, "requestReference", 128);
    const query = new URLSearchParams({ "request-reference": reference });
    return this.request("GET", `/v1/vas/transactions?${query.toString()}`);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<BillsApiEnvelope> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetchImpl(`${INTERSWITCH_BILLS_SANDBOX_BASE}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      // Never include the token, request headers, or provider exception detail.
      throw new BillsProviderError(
        "transport",
        "InterSwitch sandbox request failed or timed out; query the same reference before any retry.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      throw new BillsProviderError(
        "http",
        `InterSwitch sandbox returned HTTP ${response.status}.`,
        response.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new BillsProviderError("invalid_response", "InterSwitch sandbox returned invalid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BillsProviderError("invalid_response", "InterSwitch sandbox returned an unexpected response shape.");
    }

    return parsed as BillsApiEnvelope;
  }
}
