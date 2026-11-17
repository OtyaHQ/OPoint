export interface SaleFingerprintLine {
  productId: string;
  quantity: number;
}
export function saleRequestFingerprint(
  paymentMethod: string,
  lines: SaleFingerprintLine[],
  branchId?: string | null
): Promise<string>;
