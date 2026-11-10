/**
 * Quickteller Business OAuth + transaction-status client.
 *
 * This adapter is isolated from the InterSwitch Marketplace Routing Bills API.
 * It can obtain a sandbox OAuth token and requery an existing transaction.
 * It intentionally has no payment-initiation, refund, payout, or wallet method.
 *
 * Do not log credentials, Authorization headers, access tokens, request bodies,
 * or raw provider exceptions. Never pass credentials from a browser/mobile app.
 */

export const QUICKTELLER_SANDBOX_TOKEN_URL =
  "https://passport-sandbox.interswitchng.com/passport/oauth/token";
export const QUICKTELLER_SANDBOX_STATUS_URL =
  "https://sandbox.interswitchng.com/api/v3/purchases";

export type QuicktellerSandboxOptions = {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

export type QuicktellerStatusResult = {
  status: "CONFIRMED_SUCCESS" | "NOT_CONFIRMED";
  responseCode: string;
  amountMatched: boolean;
};

type TokenPayload = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
};

type TransactionPayload = {
  ResponseCode?: unknown;
  responseCode?: unknown;
  Amount?: unknown;
  amount?: unknown;
};

export class QuicktellerBusinessError extends Error {
  readonly kind: "configuration" | "transport" | "http" | "invalid_response";
  readonly httpStatus?: number;

  constructor(
    kind: QuicktellerBusinessError["kind"],
    message: string,
    httpStatus?: number
  ) {
    super(message);
    this.name = "QuicktellerBusinessError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

function requiredText(value: unknown, field: string, max = 2048): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new QuicktellerBusinessError("configuration", `Invalid ${field} configuration.`);
  }
  return value.trim();
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class QuicktellerBusinessSandboxClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private tokenRequest?: Promise<string>;

  constructor(options: QuicktellerSandboxOptions) {
    this.clientId = requiredText(options.clientId, "client ID");
    this.clientSecret = requiredText(options.clientSecret, "client secret");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.now = options.now ?? Date.now;

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) {
      throw new QuicktellerBusinessError("configuration", "timeoutMs must be between 1000 and 30000.");
    }
  }

  /**
   * Requests and caches a sandbox OAuth token. Concurrent callers share one
   * in-flight token request. Expired tokens are never reused.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.tokenExpiresAt) return this.accessToken;
    if (this.tokenRequest) return this.tokenRequest;

    this.tokenRequest = this.requestAccessToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = undefined;
    }
  }

  /**
   * Read-only transaction requery. The provider API documents amount in major
   * denomination for this status endpoint. The caller must supply the exact
   * amount originally submitted; no minor/major conversion is guessed here.
   */
  async getTransactionStatus(
    transactionRef: string,
    amountMajor: number
  ): Promise<QuicktellerStatusResult> {
    const reference = requiredText(transactionRef, "transaction reference", 128);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0 || amountMajor > Number.MAX_SAFE_INTEGER) {
      throw new QuicktellerBusinessError("configuration", "Invalid transaction amount.");
    }

    const token = await this.getAccessToken();
    // Interswitch documents amount and transactionRef as request headers,
    // not query parameters. Amount is in the major denomination for this
    // status endpoint (distinct from Web Checkout's minor-unit create amount).
    const response = await this.fetchWithTimeout(QUICKTELLER_SANDBOX_STATUS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        amount: String(amountMajor),
        transactionRef: reference
      },
      redirect: "error"
    });

    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      throw new QuicktellerBusinessError(
        "http",
        `Quickteller sandbox status enquiry returned HTTP ${response.status}.`,
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new QuicktellerBusinessError("invalid_response", "Quickteller sandbox returned invalid JSON.");
    }

    if (!isRecord(payload)) {
      throw new QuicktellerBusinessError("invalid_response", "Quickteller sandbox returned an unexpected response.");
    }

    const transaction = payload as TransactionPayload;
    const rawCode = transaction.ResponseCode ?? transaction.responseCode;
    const rawAmount = transaction.Amount ?? transaction.amount;
    const responseCode = typeof rawCode === "string" ? rawCode : "";
    const returnedAmount = typeof rawAmount === "number" ? rawAmount
      : typeof rawAmount === "string" && rawAmount.trim() ? Number(rawAmount) : NaN;
    const amountMatched = Number.isFinite(returnedAmount) && returnedAmount === amountMajor;

    return {
      status: responseCode === "00" && amountMatched ? "CONFIRMED_SUCCESS" : "NOT_CONFIRMED",
      responseCode,
      amountMatched
    };
  }

  private async requestAccessToken(): Promise<string> {
    const authorization = "Basic " + encodeBase64Utf8(`${this.clientId}:${this.clientSecret}`);
    const form = new URLSearchParams({ grant_type: "client_credentials" });

    const response = await this.fetchWithTimeout(
      `${QUICKTELLER_SANDBOX_TOKEN_URL}?grant_type=client_credentials`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString(),
        redirect: "error"
      }
    );

    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      throw new QuicktellerBusinessError(
        "http",
        `Quickteller sandbox authentication returned HTTP ${response.status}.`,
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new QuicktellerBusinessError("invalid_response", "Quickteller sandbox authentication returned invalid JSON.");
    }

    if (!isRecord(payload)) {
      throw new QuicktellerBusinessError("invalid_response", "Quickteller sandbox authentication returned an unexpected response.");
    }

    const data = payload as TokenPayload;
    const token = typeof data.access_token === "string" ? data.access_token.trim() : "";
    const tokenType = typeof data.token_type === "string" ? data.token_type.trim().toLowerCase() : "";
    const expiresIn = data.expires_in;

    if (!token || token.length > 16384 || (tokenType && tokenType !== "bearer") ||
        !Number.isSafeInteger(expiresIn) || Number(expiresIn) <= 0 || Number(expiresIn) > 86400) {
      throw new QuicktellerBusinessError("invalid_response", "Quickteller sandbox authentication returned invalid token metadata.");
    }

    // Refresh one minute early where possible; short-lived tokens are not cached.
    const safetyWindowMs = Math.min(60000, Math.floor(Number(expiresIn) * 100));
    this.accessToken = token;
    this.tokenExpiresAt = this.now() + (Number(expiresIn) * 1000) - safetyWindowMs;
    return token;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch {
      // Never expose provider exception detail; it may include request headers.
      throw new QuicktellerBusinessError("transport", "Quickteller sandbox request failed or timed out.");
    } finally {
      clearTimeout(timer);
    }
  }
}
