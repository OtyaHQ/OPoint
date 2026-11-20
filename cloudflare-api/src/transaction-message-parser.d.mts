export type ProviderCode = "AIRTEL_MONEY" | "MTN_MOMO" | "INTERSWITCH_QUICKTELLER";
export type TransactionType =
  | "CASH_IN" | "CASH_OUT" | "AIRTIME" | "DATA" | "BILL_PAYMENT"
  | "MERCHANT_PAYMENT" | "REVERSAL" | "OTHER";
export interface ParsedTransactionMessage {
  provider: ProviderCode;
  amountUgx: number | null;
  currency: "UGX";
  providerReference: string | null;
  transactionType: TransactionType;
  sourceStatusClaim: "SUCCESS_REPORTED" | "FAILED_REPORTED" | "REVERSED_REPORTED" | "UNKNOWN";
  parserVersion: string;
  confidence: number;
  requiresHumanReview: true;
  verificationLevel: "UNVERIFIED";
  providerConfirmed: false;
}
export function parseTransactionMessage(messageText: string, provider: ProviderCode): ParsedTransactionMessage;
