const PROVIDERS = new Set(["AIRTEL_MONEY", "MTN_MOMO", "INTERSWITCH_QUICKTELLER"]);
const PROVIDER_ALIASES = Object.freeze({
  AIRTEL_MONEY: ["airtel", "airtel money"],
  MTN_MOMO: ["mtn", "mtn momo"],
  INTERSWITCH_QUICKTELLER: ["interswitch", "quickteller", "quick teller"]
});

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseUgxAmount(text) {
  const value = firstMatch(text, [
    /\b(?:UGX|USh|Shs\.?|Shillings?)\s*[:=-]?\s*([0-9][0-9,]*(?:\.00)?)\b/i,
    /\b([0-9][0-9,]*(?:\.00)?)\s*(?:UGX|USh)\b/i
  ]);
  if (!value) return null;
  const amount = Number(value.replaceAll(",", "").replace(/\.00$/, ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function parseReference(text) {
  const value = firstMatch(text, [
    /\b(?:transaction\s*(?:id|ref(?:erence)?)|txn\s*(?:id|ref)|reference|ref|receipt\s*(?:no\.?|number)?)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9/_-]{4,39})\b/i
  ]);
  return value ? value.toUpperCase() : null;
}

function parseTransactionType(text) {
  if (/\b(airtime|recharge|top\s?up)\b/i.test(text)) return "AIRTIME";
  if (/\b(data\s(bundle|purchase)|internet bundle)\b/i.test(text)) return "DATA";
  if (/\b(umeme|yakam|nwsc|water bill|pay ?tv|bill payment|utility)\b/i.test(text)) return "BILL_PAYMENT";
  if (/\b(withdraw(?:al|n|ed|s)?|cash[\s-]?out|you\s+withdrew)\b/i.test(text)) return "CASH_OUT";
  if (/\b(deposit|cash.?in|cash in|received from|you have received)\b/i.test(text)) return "CASH_IN";
  if (/\b(merchant payment|payment received|paid to merchant)\b/i.test(text)) return "MERCHANT_PAYMENT";
  if (/\b(reversal|reversed)\b/i.test(text)) return "REVERSAL";
  return "OTHER";
}

function parseSourceStatusClaim(text) {
  if (/\b(reversed|reversal successful)\b/i.test(text)) return "REVERSED_REPORTED";
  if (/\b(failed|declined|unsuccessful|not completed)\b/i.test(text)) return "FAILED_REPORTED";
  if (/\b(successful|successfully|completed|confirmed|transaction complete|has been paid)\b/i.test(text)) return "SUCCESS_REPORTED";
  return "UNKNOWN";
}

/**
 * Extracts a minimal candidate from text explicitly shared by a user.
 * Raw text and customer data are not returned or persisted by this parser.
 * Parsed source claims are never treated as provider confirmation.
 */
export function parseTransactionMessage(messageText, provider) {
  if (typeof provider !== "string" || !PROVIDERS.has(provider)) throw new TypeError("Unsupported provider");
  if (typeof messageText !== "string" || messageText.trim().length < 8 || messageText.length > 8000) {
    throw new TypeError("Message text must contain 8 to 8000 characters");
  }

  const text = messageText.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
  const amountUgx = parseUgxAmount(text);
  const providerReference = parseReference(text);
  const transactionType = parseTransactionType(text);
  const sourceStatusClaim = parseSourceStatusClaim(text);
  const hasProviderHint = PROVIDER_ALIASES[provider].some(alias => text.toLowerCase().includes(alias));
  const confidence =
    amountUgx !== null && providerReference && transactionType !== "OTHER" ? (hasProviderHint ? 0.9 : 0.82) :
    amountUgx !== null && providerReference ? 0.68 :
    amountUgx !== null ? 0.45 : 0.15;

  return {
    provider,
    amountUgx,
    currency: "UGX",
    providerReference,
    transactionType,
    sourceStatusClaim,
    parserVersion: "generic-ug-v1",
    confidence,
    requiresHumanReview: true,
    verificationLevel: "UNVERIFIED",
    providerConfirmed: false
  };
}
