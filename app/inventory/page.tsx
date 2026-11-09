import Link from "next/link";
import { Boxes, ArrowLeft, ShieldCheck, PackagePlus, ClipboardList } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth";
import { adjustStockAction, createProductAction } from "./actions";

type PageProps = { searchParams: Promise<{ error?: string; success?: string; q?: string }> };

const managerRoles = new Set(["MANAGER", "MANAGING_DIRECTOR", "CHAIRMAN", "SOVEREIGN"]);

const errors: Record<string, string> = {
  invalid: "Check the SKU, product name, prices, and stock values.",
  "duplicate-sku": "That SKU already exists. Each product must have a unique SKU.",
  "save-failed": "The product was not saved. Check the data and try again.",
  "invalid-adjustment": "Enter a non-zero whole-number stock change and a clear reason.",
  "insufficient-stock": "This adjustment would make stock negative. No change was saved.",
  "product-not-found": "That product is unavailable or inactive.",
  "adjustment-failed": "The stock adjustment could not be completed. Refresh the page and try again.",
};
const successes: Record<string, string> = {
  "product-created": "Product created. The opening stock and audit history were recorded together.",
  "stock-updated": "Stock updated. The adjustment and audit history were recorded together.",
};

export default async function InventoryPage({ searchParams }: PageProps) {
  const staff = await requireStaff();
  const params = await searchParams;
  const canManage = managerRoles.has(staff.role);
  const query = (params.q ?? "").trim().slice(0, 80);

  const products = await prisma.product.findMany({
    where: query ? {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
        { category: { contains: query, mode: "insensitive" } },
      ],
    } : { isActive: true },
    orderBy: [{ quantityOnHand: "asc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true, sku: true, name: true, category: true,
      costPrice: true, sellingPrice: true, quantityOnHand: true,
      reorderLevel: true, updatedAt: true,
    },
  });

  const lowStock = products.filter((product) => product.quantityOnHand <= product.reorderLevel).length;
  const stockUnits = products.reduce((sum, product) => sum + product.quantityOnHand, 0);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <Link href="/" style={styles.back}><ArrowLeft size={15} /> Back to dashboard</Link>
          <div style={styles.eyebrow}><Boxes size={15} /> OMNIPOINT · RETAIL OPERATIONS</div>
          <h1 style={styles.title}>Inventory workspace</h1>
          <p style={styles.muted}>Live product records from OtyaPoint&apos;s database, with auditable stock changes.</p>
        </div>
        <div style={styles.livePill}><span style={styles.dot} /> INVENTORY RECORDS</div>
      </header>

      <div style={styles.notice}>
        <ShieldCheck size={19} />
        <div><strong>Controlled inventory actions</strong><p>Stock updates are recorded with the operator, reason, before/after quantities, and an audit event. Financial and provider transactions are not executed here.</p></div>
      </div>

      {params.error && <p role="alert" style={{ ...styles.message, ...styles.error }}>{errors[params.error] ?? "The request could not be completed."}</p>}
      {params.success && <p role="status" style={{ ...styles.message, ...styles.success }}>{successes[params.success] ?? "Completed."}</p>}

      <section style={styles.stats}>
        <div style={styles.stat}><span>Active products</span><strong>{products.length}{query ? " matching" : ""}</strong></div>
        <div style={styles.stat}><span>Units on hand</span><strong>{stockUnits.toLocaleString("en-UG")}</strong></div>
        <div style={styles.stat}><span>At or below reorder level</span><strong>{lowStock}</strong></div>
      </section>

      {canManage && <section style={styles.card}>
        <div style={styles.cardTitle}><PackagePlus size={19} /><div><h2>Add a product</h2><p>Creating a product and its opening stock history is one atomic operation.</p></div></div>
        <form action={createProductAction} style={styles.formGrid}>
          <label style={styles.label}>Product name<input name="name" required minLength={2} maxLength={120} placeholder="e.g. USB-C fast charger" style={styles.input} /></label>
          <label style={styles.label}>SKU / product code<input name="sku" required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,39}" placeholder="e.g. ACC-1042" style={styles.input} /></label>
          <label style={styles.label}>Category<input name="category" maxLength={80} placeholder="Accessories, phones, electronics…" style={styles.input} /></label>
          <label style={styles.label}>Cost price (UGX)<input name="costPrice" type="number" required min="0" max="999999999999" step="0.01" defaultValue="0" style={styles.input} /></label>
          <label style={styles.label}>Selling price (UGX)<input name="sellingPrice" type="number" required min="0" max="999999999999" step="0.01" defaultValue="0" style={styles.input} /></label>
          <label style={styles.label}>Opening stock<input name="openingStock" type="number" required min="0" max="999999999" step="1" defaultValue="0" style={styles.input} /></label>
          <label style={styles.label}>Reorder alert level<input name="reorderLevel" type="number" required min="0" max="999999999" step="1" defaultValue="3" style={styles.input} /></label>
          <div style={styles.formAction}><button style={styles.primary} type="submit">Save product</button></div>
        </form>
      </section>}

      <section style={styles.card}>
        <div style={styles.cardTitle}><ClipboardList size={19} /><div><h2>Product catalogue</h2><p>Up to 200 active products per view, ordered by stock attention.</p></div></div>
        <form method="get" style={styles.searchForm}>
          <input aria-label="Search products" name="q" defaultValue={query} maxLength={80} placeholder="Search product name, SKU, or category…" style={{ ...styles.input, flex: 1 }} />
          <button type="submit" style={styles.secondary}>Search</button>
          {query && <Link href="/inventory" style={styles.clear}>Clear</Link>}
        </form>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead><tr>{["Product", "SKU", "Category", "Cost (UGX)", "Price (UGX)", "On hand", "Reorder at", ...(canManage ? ["Adjust stock"] : [])].map((heading) => <th key={heading} style={styles.th}>{heading}</th>)}</tr></thead>
            <tbody>
              {products.map((product) => {
                const isLow = product.quantityOnHand <= product.reorderLevel;
                return <tr key={product.id}>
                  <td style={styles.td}><strong>{product.name}</strong><small style={styles.subtle}>Updated {product.updatedAt.toLocaleDateString("en-UG")}</small></td>
                  <td style={styles.td}><code>{product.sku}</code></td>
                  <td style={styles.td}>{product.category ?? "—"}</td>
                  <td style={styles.td}>{Number(product.costPrice).toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td>
                  <td style={styles.td}>{Number(product.sellingPrice).toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td>
                  <td style={styles.td}><span style={isLow ? styles.lowStock : styles.stock}>{product.quantityOnHand}</span></td>
                  <td style={styles.td}>{product.reorderLevel}</td>
                  {canManage && <td style={styles.td}><form action={adjustStockAction} style={styles.adjustForm}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input aria-label={"Quantity change for " + product.name} name="quantityDelta" type="number" step="1" min={-product.quantityOnHand} max="999999999" required placeholder="+/- qty" style={styles.smallInput} />
                    <input aria-label={"Adjustment reason for " + product.name} name="reason" required minLength={4} maxLength={240} placeholder="Reason" style={styles.smallInput} />
                    <button type="submit" style={styles.secondary}>Apply</button>
                  </form></td>}
                </tr>;
              })}
              {products.length === 0 && <tr><td colSpan={canManage ? 8 : 7} style={{ ...styles.td, textAlign: "center", padding: 32 }}>No active products found. {canManage ? "Add the first product above or clear your search." : "Ask a manager to add products."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p style={styles.footnote}>Amounts are shown in UGX. This screen manages inventory records only; it does not create a retail sale or post a financial ledger entry.</p>
      </section>
      <footer style={styles.footer}>OtyaPoint · Retail inventory · Access: {staff.role.replaceAll("_", " ")}</footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "clamp(18px, 3vw, 40px)", background: "#0c1422", color: "#f0f4fa", fontFamily: "'DM Sans', Arial, sans-serif", maxWidth: 1600, margin: "0 auto" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 24 },
  back: { display: "inline-flex", alignItems: "center", gap: 7, color: "#a8b8ff", textDecoration: "none", fontSize: 12, marginBottom: 20 },
  eyebrow: { display: "flex", alignItems: "center", gap: 8, color: "#a8b8ff", fontSize: 10, letterSpacing: 1.4, fontWeight: 700, marginBottom: 10 },
  title: { fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: -1.2, margin: "0 0 8px" },
  muted: { color: "#8d9bb0", margin: 0, lineHeight: 1.6, maxWidth: 720 },
  livePill: { display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid #355e54", background: "#122c29", color: "#79e0b5", padding: "9px 12px", borderRadius: 99, fontSize: 10, fontWeight: 700, letterSpacing: 1 },
  dot: { width: 7, height: 7, borderRadius: "50%", background: "#55d6a3" },
  notice: { display: "flex", gap: 12, alignItems: "flex-start", padding: 16, border: "1px solid #2d4663", background: "#111e30", borderRadius: 12, marginBottom: 22, color: "#a8b8ff" },
  message: { borderRadius: 9, padding: 12, margin: "0 0 18px", fontSize: 13 },
  error: { border: "1px solid #9b3d4b", background: "#3a1c29", color: "#ffc3cc" },
  success: { border: "1px solid #2d7659", background: "#102c24", color: "#a8f0cf" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 },
  stat: { display: "grid", gap: 10, border: "1px solid #243249", background: "#111e30", padding: 18, borderRadius: 12 },
  card: { border: "1px solid #243249", background: "#111e30", borderRadius: 14, padding: "clamp(14px, 2vw, 22px)", marginBottom: 20, minWidth: 0 },
  cardTitle: { display: "flex", alignItems: "flex-start", gap: 11, color: "#a8b8ff", marginBottom: 18 },
  label: { display: "grid", gap: 7, color: "#aab6c9", fontSize: 12 },
  input: { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "11px 12px", border: "1px solid #34445c", background: "#0c1422", color: "#f0f4fa", borderRadius: 8, outlineOffset: 2 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 },
  formAction: { display: "flex", alignItems: "end" },
  primary: { border: 0, background: "#8c8bff", color: "#0c1422", fontWeight: 800, borderRadius: 8, padding: "12px 17px", cursor: "pointer" },
  secondary: { border: "1px solid #35465f", background: "#172438", color: "#eaf0fa", borderRadius: 8, padding: "10px 12px", cursor: "pointer", whiteSpace: "nowrap" },
  searchForm: { display: "flex", gap: 9, marginBottom: 16, alignItems: "center" },
  clear: { color: "#a8b8ff", textDecoration: "none", fontSize: 12 },
  table: { width: "100%", minWidth: 980, borderCollapse: "collapse", textAlign: "left" },
  th: { padding: "12px 10px", borderBottom: "1px solid #34445c", color: "#8d9bb0", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, whiteSpace: "nowrap" },
  td: { padding: "13px 10px", borderBottom: "1px solid #243249", fontSize: 12, verticalAlign: "middle" },
  subtle: { display: "block", color: "#68778e", fontSize: 10, marginTop: 4 },
  lowStock: { display: "inline-block", color: "#ffd58d", background: "#49371d", border: "1px solid #6a4e22", borderRadius: 6, padding: "4px 7px", fontWeight: 700 },
  stock: { display: "inline-block", color: "#a8f0cf", background: "#14362b", border: "1px solid #285e49", borderRadius: 6, padding: "4px 7px", fontWeight: 700 },
  adjustForm: { display: "grid", gridTemplateColumns: "90px minmax(100px, 1fr) auto", gap: 6, minWidth: 310 },
  smallInput: { width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #34445c", borderRadius: 6, padding: "8px", background: "#0c1422", color: "#f0f4fa" },
  footnote: { color: "#68778e", fontSize: 11, lineHeight: 1.6, margin: "16px 0 0" },
  footer: { color: "#68778e", fontSize: 11, padding: "8px 2px 20px" },
};
