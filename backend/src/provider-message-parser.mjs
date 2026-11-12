const clean = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\\u0000-\\u001f\\u007f]/g, " ").trim().slice(0, max)
  : "";

const PROVIDERS = new Set(["AIRTEL_MONEY", "MTN_MOMO", "INTERSWITCH_QUICKTELLER"]);
const TYPES = [
  ["CASH_IN", /\\b(cash\\s*in|deposit|deposited|received\\s*cash)\\b/i],
  ["CASH_OUT", /\\b(cash\\s*out|withdraw|withdrawal|withdrawn)\\b/i],
  ["AIRTIME", /\\bairtime\\b/i],
  ["DATA", /\\b(data\\s*(bundle|package|purchase)|internet\\s*bundle)\\b/i],
  ["BILL_PAYMENT", /\\b(bill\\s*payment|utility\\s*payment|paid\\s*to\\s*biller)\\b/i],
  ["MERCHANT_COLLECTION", /\\b(merchant\\s*(payment|collection)|payment\\s*received)\\b/i],
];

export function parseProviderMessage(input) {
  const providerCode = clean(input?.providerCode, 40).toUpperCase();
  const messageText = typeof input?.messageText === "string" ? input.messageText.trim() : "";
  if (!PROVIDERS.has(providerCode)) return { ok: false, error: "unsupported_provider" };
  if (!messageText || messageText.length > 10000) return { ok: false, error: "message_text_invalid" };

  const normalized = messageText.replace(/\\s+/g, " ");
  const referenceMatch = normalized.match(/\\b(?:transaction\\s*(?:id|ref(?:erence)?|no\\.?|number)?|txn\\s*(?:id|ref|no\\.?|number)?|ref(?:erence)?\\s*(?:no\\.?|number|id)?)\\s*[:#= -]+([A-Z0-9][A-Z0-9-]{4,63})\\b/i);
  const amountMatch = normalized.match(/\\b(?:amount|amt|total)\\s*[:= -]*\\s*(?:UGX|USh|Shs\\.?\\s*)?([0-9][0-9,]*)(?:\\.00)?\\s*(?:UGX|USh)?\\b/i);
  const type = TYPES.find(([, pattern]) => pattern.test(normalized))?.[0] || "OTHER";
  const claimedStatus = /\\b(successful|success|completed|approved)\\b/i.test(normalized)
    ? "SUCCESS_CLAIMED_BY_MESSAGE"
    : /\\b(failed|failure|declined|rejected)\\b/i.test(normalized)
      ? "FAILURE_CLAIMED_BY_MESSAGE"
      : "STATUS_NOT_FOUND";
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
  const reference = referenceMatch ? clean(referenceMatch[1], 80).toUpperCase() : null;
  const fields = {
    providerCode,
    providerReferenceCandidate: reference,
    amountUGXCandidate: Number.isSafeInteger(amount) && amount > 0 && amount <= 1000000000000 ? amount : null,
    transactionKindCandidate: type,
    messageClaimedStatus: claimedStatus,
  };
  const needsReview = !fields.providerReferenceCandidate || !fields.amountUGXCandidate || type === "OTHER";
  return {
    ok: true,
    status: needsReview ? "NEEDS_REVIEW" : "PARSED_NEEDS_HUMAN_CONFIRMATION",
    fields,
    // Deliberately never maps SMS wording to a provider-confirmed transaction status.
    providerStatus: "UNKNOWN",
  };
}
