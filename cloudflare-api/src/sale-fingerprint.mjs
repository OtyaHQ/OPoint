export async function saleRequestFingerprint(paymentMethod, lines, branchId = null) {
  const canonicalPayload = {
    version: 1,
    paymentMethod,
    items: [...lines].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0
    )
  };
  // Preserve the exact legacy fingerprint for company-wide historical sales.
  // New branch-scoped sales bind the selected branch into idempotency.
  if (typeof branchId === "string" && branchId.length > 0) canonicalPayload.branchId = branchId;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalPayload)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
