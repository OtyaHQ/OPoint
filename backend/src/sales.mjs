const MAX_UGX = 1_000_000_000_000;
const cleanId = value => typeof value === "string" ? value.trim().slice(0, 80) : "";

export function calculateSaleAmounts(items, taxAmount = 0) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    return { ok: false, error: "sale_requires_1_to_100_lines" };
  }
  if (!Number.isSafeInteger(taxAmount) || taxAmount < 0 || taxAmount > MAX_UGX) {
    return { ok: false, error: "tax_must_be_whole_ugx" };
  }

  let subtotalAmount = 0;
  let discountAmount = 0;
  let costAmount = 0;
  const lines = [];

  for (const item of items) {
    const productId = cleanId(item?.productId);
    const quantity = item?.quantity;
    const unitPriceAmount = item?.unitPriceAmount;
    const unitCostAmount = item?.unitCostAmount;
    const lineDiscountAmount = item?.discountAmount ?? 0;

    if (!productId) return { ok: false, error: "product_id_required" };
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
      return { ok: false, error: "quantity_must_be_positive_integer" };
    }
    for (const amount of [unitPriceAmount, unitCostAmount, lineDiscountAmount]) {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_UGX) {
        return { ok: false, error: "amounts_must_be_whole_ugx" };
      }
    }

    const gross = quantity * unitPriceAmount;
    const lineCost = quantity * unitCostAmount;
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(lineCost)
      || gross > MAX_UGX || lineCost > MAX_UGX) {
      return { ok: false, error: "sale_line_total_out_of_range" };
    }
    if (lineDiscountAmount > gross) return { ok: false, error: "line_discount_exceeds_gross" };
    const lineTotalAmount = gross - lineDiscountAmount;
    subtotalAmount += gross;
    discountAmount += lineDiscountAmount;
    costAmount += lineCost;
    if (![subtotalAmount, discountAmount, costAmount].every(Number.isSafeInteger)
      || subtotalAmount > MAX_UGX || discountAmount > MAX_UGX || costAmount > MAX_UGX) {
      return { ok: false, error: "sale_total_out_of_range" };
    }
    lines.push({
      productId,
      quantity,
      unitPriceAmount,
      unitCostAmount,
      discountAmount: lineDiscountAmount,
      lineTotalAmount,
    });
  }

  const totalAmount = subtotalAmount - discountAmount + taxAmount;
  if (!Number.isSafeInteger(totalAmount) || totalAmount > MAX_UGX) {
    return { ok: false, error: "sale_total_out_of_range" };
  }
  return {
    ok: true,
    value: {
      currency: "UGX",
      lines,
      subtotalAmount,
      discountAmount,
      taxAmount,
      totalAmount,
      costAmount,
    },
  };
}
