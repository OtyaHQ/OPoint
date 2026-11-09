"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowUpRight, Bell, Boxes, BriefcaseBusiness,
  CheckCircle2, ChevronDown, CircleDollarSign, Command,
  Download, LayoutDashboard, LifeBuoy, Menu, Moon, MoreHorizontal,
  Package, Search, Settings2, ShieldCheck, ShoppingBag,
  Smartphone, Sun, Wallet, X
} from "lucide-react";

type Section = "Overview" | "Retail POS" | "Inventory" | "Fintech Agency" | "Reconciliation" | "Reports" | "Team & Access" | "Settings";

const navigation: { title: string; items: { name: Section; icon: typeof LayoutDashboard }[] }[] = [
  { title: "WORKSPACE", items: [{ name: "Overview", icon: LayoutDashboard }, { name: "Retail POS", icon: ShoppingBag }, { name: "Inventory", icon: Boxes }, { name: "Fintech Agency", icon: Smartphone }] },
  { title: "MANAGEMENT", items: [{ name: "Reconciliation", icon: Activity }, { name: "Reports", icon: BriefcaseBusiness }, { name: "Team & Access", icon: ShieldCheck }, { name: "Settings", icon: Settings2 }] },
];

type ProductView = { name: string; sku: string; category: string; stock: number; status: string };
const initialProducts: ProductView[] = [];

type DashboardProps = { role: string; displayName: string; agentId: string | null };

export default function Home({ role, displayName, agentId }: DashboardProps) {
  const [section, setSection] = useState<Section>("Overview");
  const [dark, setDark] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [inventorySource, setInventorySource] = useState<"unavailable" | "otyapoint-api">("unavailable");

  useEffect(() => {
    if (section !== "Inventory") return;
    let cancelled = false;
    fetch("/api/bridge/products", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || payload.error || "Cloudflare inventory is not connected.");
        if (!Array.isArray(payload.data)) throw new Error("Cloudflare returned an unexpected inventory response.");
        return payload.data as Array<{ name: string; sku: string; category?: string | null; quantityOnHand: number; isActive: boolean }>;
      })
      .then((items) => {
        if (cancelled) return;
        setProducts(items.filter((p) => p.isActive).map((p) => ({ name: p.name, sku: p.sku, category: p.category || "Uncategorised", stock: p.quantityOnHand, status: p.quantityOnHand <= 7 ? "Low stock" : "In stock" })));
        setInventorySource("otyapoint-api");
      })
      .catch(() => {
        if (cancelled) return;
        setProducts([]);
        setInventorySource("unavailable");
        setNotice("Inventory is not connected to the OtyaPoint API yet. No placeholder products are shown.");
      });
    return () => { cancelled = true; };
  }, [section]);
  const filteredProducts = products.filter((p) => [p.name, p.sku, p.category].some((v) => v.toLowerCase().includes(query.toLowerCase())));

  function selectSection(name: Section) {
    setSection(name);
    setMobileNav(false);
    setNotice("");
  }

  return (
    <main className={dark ? "app-shell" : "app-shell light"}>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Command size={22} strokeWidth={2.5} /></div>
          <div><div className="brand-name">OtyaPoint<span>.</span></div><div className="brand-subtitle">BUSINESS OPERATIONS</div></div>
          <button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19}/></button>
        </div>
        <div className="workspace-select">
          <div className="workspace-icon"><BriefcaseBusiness size={17}/></div>
          <div className="workspace-copy"><strong>OtyaPoint workspace</strong><span>Primary shop workspace</span></div>
          <ChevronDown size={15} className="muted-icon"/>
        </div>
        <nav className="nav-groups">
          {navigation.map((group) => <div className="nav-group" key={group.title}>
            <div className="nav-label">{group.title}</div>
            {group.items.map(({name, icon: Icon}) => name === "Inventory" ? <Link key={name} href="/inventory" className={`nav-item ${section === name ? "active" : ""}`}><Icon size={18}/><span>{name}</span><span className="nav-count">API</span></Link> : <button key={name} onClick={() => selectSection(name)} className={`nav-item ${section === name ? "active" : ""}`}><Icon size={18}/><span>{name}</span></button>)}
          </div>)}
        {(role === "MANAGING_DIRECTOR" || role === "CHAIRMAN" || role === "SOVEREIGN") && <div className="nav-group"><div className="nav-label">ACCESS CONTROL</div><Link href="/management/staff" className="nav-item"><ShieldCheck size={18}/><span>Staff onboarding</span></Link></div>}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-card"><div className="security-icon"><ShieldCheck size={17}/></div><div><strong>Provider payments unavailable</strong><span>Shop records remain separate from agency operations.</span></div><CheckCircle2 size={15} className="success-icon"/></div>
          <button className="nav-item support-link" onClick={() => setNotice("Support centre is a prototype placeholder. Connect a support channel before launch.")}><LifeBuoy size={18}/><span>Help & support</span></button>
          <div className="profile-row"><div className="avatar">{displayName.trim().charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{displayName}</strong><span>{role.replaceAll("_", " ")} · {agentId ?? "Staff account"}</span></div><MoreHorizontal size={19} className="muted-icon"/></div>
        </div>
      </aside>

      {mobileNav && <button aria-label="Close navigation overlay" className="nav-overlay" onClick={() => setMobileNav(false)}/>}

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><span>Workspace</span><span className="crumb-slash">/</span><strong>{section}</strong></div>
          <div className="top-actions"><div className="environment-pill"><span/> WORKSPACE SETUP</div><button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("Notifications will appear here when the workspace notification service is connected.")}><Bell size={18}/><i/></button><div className="top-avatar">{displayName.trim().charAt(0).toUpperCase()}</div></div>
        </header>

        <div className="page-content">
          {notice && <div className="notice-banner"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16}/></button></div>}
          {section === "Overview" ? <>
            <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR BUSINESS OVERVIEW</div><h1>Good day, {displayName.split(" ")[0]} <span className="wave">✳</span></h1><p className="page-description">Here’s what’s happening across your business today.</p></div><button className="secondary-button" onClick={() => setNotice("Report export will be enabled when the reporting API is connected.")}><Download size={16}/> Export report</button></div>
            <div className="notice-banner"><span>Welcome to OtyaPoint. Your business records will appear here as the workspace services are connected. Payments are not available from this screen.</span></div>
            <div className="section-heading"><div><h2>Business overview</h2><p>Retail and fintech are tracked independently.</p></div><button className="period-select" onClick={() => setNotice("Date filters will be connected to real reporting data.")}>Today <ChevronDown size={15}/></button></div>
            <div className="metric-grid">
              <Metric icon={<ShoppingBag size={18}/>} label="Retail sales" value="UGX —" detail="No sales are available in this view yet" tone="violet" />
              <Metric icon={<Wallet size={18}/>} label="Agency commissions" value="UGX —" detail="Provider reporting is not connected" tone="blue" />
              <Metric icon={<Boxes size={18}/>} label="Inventory items" value="—" detail="Open Inventory to check the connected catalogue" tone="amber" />
              <Metric icon={<Activity size={18}/>} label="Reconciliation" value="Not started" detail="Awaiting real ledger data" tone="green" />
            </div>
            <div className="dashboard-grid">
              <div className="panel activity-panel"><div className="panel-header"><div><h3>Business activity</h3><p>Transaction activity across both ledgers</p></div><button className="icon-button" aria-label="Activity options" onClick={() => setNotice("Activity options will be available with live data.")}><MoreHorizontal size={19}/></button></div><div className="empty-chart"><div className="chart-icon"><Activity size={22}/></div><strong>No activity to display yet</strong><span>Business activity will appear here once authorized workflows are connected.</span><div className="chart-baseline"><i/><i/><i/><i/><i/><i/><i/></div></div><div className="legend-row"><span><i className="legend-dot retail-dot"/> Retail</span><span><i className="legend-dot fintech-dot"/> Fintech agency</span></div></div>
              <div className="panel split-panel"><div className="panel-header"><div><h3>Ledger separation</h3><p>Two distinct financial records</p></div><ShieldCheck size={19} className="panel-title-icon"/></div><div className="ledger-tile retail-tile"><div className="ledger-tile-icon"><ShoppingBag size={17}/></div><div className="ledger-tile-copy"><strong>Retail ledger</strong><span>Sales · COGS · Tax metadata</span></div><span className="ledger-status">ISOLATED</span></div><div className="ledger-tile fintech-tile"><div className="ledger-tile-icon"><Smartphone size={17}/></div><div className="ledger-tile-copy"><strong>Fintech ledger</strong><span>Float · Cash-in/out · Commission</span></div><span className="ledger-status">ISOLATED</span></div><div className="audit-note"><ShieldCheck size={16}/><span>Privileged actions will require authorization and an audit record.</span></div></div>
            </div>
            <div className="bottom-grid">
              <div className="panel inventory-panel"><div className="panel-header"><div><h3>Inventory watch</h3><p>Products that may need attention</p></div><Link href="/inventory" className="text-link">View inventory <ArrowUpRight size={14}/></Link></div><div className="product-list">{products.filter(p => p.stock <= 7).map(p => <div className="product-row" key={p.sku}><div className="product-icon"><Package size={17}/></div><div className="product-info"><strong>{p.name}</strong><span>{p.sku}</span></div><span className="stock-count">{p.stock} left</span><span className="status-low">Low stock</span></div>)}{products.length === 0 && <div className="empty-chart"><strong>No inventory records to show</strong><span>Connect the OtyaPoint inventory service to see products and stock alerts.</span></div>}</div></div>
              <div className="panel quick-panel"><div className="panel-header"><div><h3>Quick actions</h3><p>Jump into a workflow</p></div></div><button className="quick-action" onClick={() => selectSection("Retail POS")}><div className="quick-icon violet-bg"><ShoppingBag size={17}/></div><span><strong>Open retail POS</strong><small>Start a retail sale workflow</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={() => selectSection("Fintech Agency")}><div className="quick-icon blue-bg"><Smartphone size={17}/></div><span><strong>Agency transaction</strong><small>Record a cash-in or cash-out</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={() => selectSection("Reconciliation")}><div className="quick-icon green-bg"><CircleDollarSign size={17}/></div><span><strong>Reconcile balances</strong><small>Review differences by ledger</small></span><ArrowUpRight size={16}/></button></div>
            </div>
          </> : <SectionView section={section} products={filteredProducts} query={query} setQuery={setQuery} inventorySource={inventorySource} onNotice={setNotice} />}
          <footer className="footer"><span>OtyaPoint <span className="footer-sep">·</span> Part of Otya OS</span><span>Provider payments remain unavailable until the approved integrations are connected.</span></footer>
        </div>
      </section>
    </main>
  );
}

function Metric({icon,label,value,detail,tone}:{icon:React.ReactNode;label:string;value:string;detail:string;tone:string}) {
  return <div className="metric-card"><div className="metric-top"><div className={`metric-icon ${tone}`}>{icon}</div><span className="metric-period">SUMMARY</span></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>;
}

function SectionView({section,products,query,setQuery,inventorySource,onNotice}:{section:Section;products:ProductView[];query:string;setQuery:(s:string)=>void;inventorySource:"unavailable"|"otyapoint-api";onNotice:(s:string)=>void}) {
  const titles:Record<Section,string> = {"Retail POS":"Retail point of sale","Inventory":"Inventory management","Fintech Agency":"Fintech agency desk","Reconciliation":"Daily reconciliation","Reports":"Reports & exports","Team & Access":"Team & access control","Settings":"Workspace settings","Overview":"Overview"};
  const descriptions:Record<Section,string> = {"Retail POS":"Review checkout setup and product availability.","Inventory":"View products and recorded stock levels.","Fintech Agency":"Review mobile-money provider setup and service availability.","Reconciliation":"Review retail cash and agency balances independently.","Reports":"Prepare clear, auditable business reports.","Team & Access":"Manage staff roles and privileged permissions.","Settings":"Configure the OtyaPoint workspace.","Overview":""};
  return <div className="subpage"><div className="welcome-row"><div><div className="eyebrow">OTYAPOINT WORKSPACE</div><h1>{titles[section]}</h1><p className="page-description">{descriptions[section]}</p></div><span className="status-pending">SETUP REQUIRED</span></div>
    <div className="notice-banner"><span>Some workspace services are still being connected. This screen will only show confirmed business records; it will not simulate sales or provider payments.</span></div>
    {section === "Inventory" && <div className="panel table-panel"><div className="panel-header"><div><h3>Product catalogue</h3><p>{inventorySource === "otyapoint-api" ? "Products returned by the OtyaPoint API" : "Inventory connection is not ready; no placeholder products are displayed."}</p></div><span className="status-pending">Product setup required</span></div><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, SKU, category…"/></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>STOCK</th><th>STATUS</th></tr></thead><tbody>{products.map(p=><tr key={p.sku}><td><strong>{p.name}</strong></td><td className="mono">{p.sku}</td><td>{p.category}</td><td>{p.stock}</td><td><span className={p.stock<=7?"status-low":"status-ok"}>{p.status}</span></td></tr>)}</tbody></table></div>{products.length === 0 && <div className="empty-chart"><strong>No products recorded in this view</strong><span>Products will appear here when the OtyaPoint inventory API is connected.</span></div>}</div>}
    {section === "Retail POS" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Retail point of sale</h3><p>Checkout is waiting for the connected product and sales API.</p></div><ShoppingBag size={20} className="panel-title-icon"/></div><div className="empty-chart"><strong>Retail checkout is not connected yet</strong><span>Your actual product catalogue will appear here when the OtyaPoint inventory and sales services are connected. No sale is created from this screen.</span></div></div>}
    {section === "Fintech Agency" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Mobile-money agency</h3><p>Provider operations are not connected</p></div><Smartphone size={20} className="panel-title-icon"/></div><div className="empty-chart"><strong>Provider setup required</strong><span>MTN MoMo, Airtel Money and bill-payment services remain disabled until approved credentials, callback verification, status checks and reconciliation are connected. This screen does not prepare or send a transaction.</span></div></div>}
    {section === "Reconciliation" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Ledger reconciliation</h3><p>Separate checks for each accounting stream</p></div><Activity size={20} className="panel-title-icon"/></div><div className="recon-row"><div className="ledger-tile-icon"><ShoppingBag size={18}/></div><div className="ledger-tile-copy"><strong>Retail cash reconciliation</strong><span>Expected cash vs counted cash · Retail ledger only</span></div><span className="status-pending">NOT STARTED</span></div><div className="recon-row"><div className="ledger-tile-icon"><Smartphone size={18}/></div><div className="ledger-tile-copy"><strong>Agency float reconciliation</strong><span>Cash, provider balances and recorded float movements</span></div><span className="status-pending">NOT STARTED</span></div><button className="secondary-button" onClick={()=>onNotice("Reconciliation needs persisted transactions, counted balances, and provider statements.")}>Review requirements</button></div>}
    {section === "Reports" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Available report templates</h3><p>Reports will be available after verified shop and agency records are connected.</p></div><Download size={20} className="panel-title-icon"/></div><div className="report-item"><div className="quick-icon violet-bg"><ShoppingBag size={18}/></div><div><strong>Retail sales & stock</strong><span>Sales, COGS, stock movements, invoice metadata</span></div><button className="secondary-button" onClick={()=>onNotice("No report generated. The reporting service is not connected yet.")}>Export <Download size={14}/></button></div><div className="report-item"><div className="quick-icon blue-bg"><Wallet size={18}/></div><div><strong>Fintech agency ledger</strong><span>Cash-in/out, float changes, commissions, volumes</span></div><button className="secondary-button" onClick={()=>onNotice("No report generated: provider and ledger data are not connected.")}>Export <Download size={14}/></button></div><div className="report-item"><div className="quick-icon green-bg"><ShieldCheck size={18}/></div><div><strong>Audit trail</strong><span>Privileged actions, approvals and change history</span></div><button className="secondary-button" onClick={()=>onNotice("Audit export will be available after audit storage is implemented.")}>Export <Download size={14}/></button></div></div>}
    {section === "Team & Access" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Access model</h3><p>Staff access is controlled by OtyaPoint memberships and owner approval.</p></div><ShieldCheck size={20} className="panel-title-icon"/></div>{[["Attendant","POS access, permitted service records, own shift"],["Manager","Shift oversight, stock management, approved reversals"],["Managing director","Reports, controls, team and operational oversight"],["Chairman / root admin","Privileged configuration with strong verification and audit"]].map(([role,desc])=><div className="report-item" key={role}><div className="avatar role-avatar">{role[0]}</div><div><strong>{role}</strong><span>{desc}</span></div><span className="status-pending">SETUP REQUIRED</span></div>)}<div className="inline-warning"><ShieldCheck size={17}/><span>Root access must not bypass audit logging. High-risk actions should require re-authentication and, where possible, a second approver.</span></div></div>}
    {section === "Settings" && <div className="panel workflow-panel"><div className="panel-header"><div><h3>Workspace configuration</h3><p>Workspace settings for OtyaPoint</p></div><Settings2 size={20} className="panel-title-icon"/></div>{[["Business identity","OtyaPoint"],["Base currency","UGX — Ugandan shilling"],["Accounting streams","Retail and fintech agency · separate"],["Tax integration","EFRIS integration requires validation"],["Mobile money","MTN / Airtel provider adapters planned"],["Alerts","Telegram notifications require bot configuration"]].map(([k,v])=><div className="setting-row" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>}
  </div>;
}
