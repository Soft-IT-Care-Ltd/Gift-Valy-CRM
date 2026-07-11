"use client";

import { useState, type CSSProperties } from "react";
import { DsShell } from "../ds-shell";
import { Icon } from "../lib/icons";
import { FMT } from "../lib/format";
import { FilterBox } from "../filter-box";

const ButtonShow = () => {
  const [loading, setLoading] = useState(false);
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Buttons</h2>
          <p className="section-sub">Primary, secondary, ghost, destructive, AI.</p>
        </div>
        <span className="section-tag">components/button</span>
      </div>
      <div className="comp-demo">
        <button className="btn btn-primary">Create store</button>
        <button className="btn btn-secondary">Cancel</button>
        <button className="btn btn-ghost">Learn more</button>
        <button className="btn btn-destructive">Delete</button>
        <button className="btn btn-ai">
          <Icon name="sparkles" /> Generate with AI
        </button>
      </div>
      <div className="comp-demo" style={{ marginTop: 10 }}>
        <button className="btn btn-primary btn-xs">XS</button>
        <button className="btn btn-primary btn-sm">Small</button>
        <button className="btn btn-primary">Default</button>
        <button className="btn btn-primary btn-lg">Large</button>
        <button className="btn btn-primary btn-xl">
          Hero CTA <Icon name="arrowRight" />
        </button>
      </div>
      <div className="comp-demo" style={{ marginTop: 10 }}>
        <button className="btn btn-primary">
          <Icon name="plus" /> New product
        </button>
        <button className="btn btn-secondary btn-icon">
          <Icon name="settings" />
        </button>
        <button className="btn btn-primary" disabled>
          Disabled
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1800);
          }}
        >
          {loading ? (
            <>
              <span className="btn-spinner" /> Processing…
            </>
          ) : (
            "Click to load"
          )}
        </button>
      </div>
    </section>
  );
};

const InputShow = () => {
  const [phone, setPhone] = useState("01712345678");
  const [price, setPrice] = useState("1499.00");
  const [pw, setPw] = useState("");
  const [check, setCheck] = useState<{ a: boolean; b: boolean; c: boolean }>({ a: true, b: false, c: true });
  const [radio, setRadio] = useState("card");
  const [toggle, setToggle] = useState(true);
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Inputs</h2>
          <p className="section-sub">Soft borders, purple focus ring, 11-digit BD phone.</p>
        </div>
        <span className="section-tag">components/input</span>
      </div>
      <div className="input-grid">
        <div className="field">
          <label className="field-label">Store name</label>
          <input className="input" defaultValue="Dhaka Denim Co." />
          <div className="field-help">Shown on storefront header.</div>
        </div>
        <div className="field">
          <label className="field-label">
            Email <span className="field-req">*</span>
          </label>
          <input className="input input-error" defaultValue="raihan@" />
          <div className="field-help error">
            <Icon name="x" size={12} /> Enter a valid email
          </div>
        </div>
        <div className="field">
          <label className="field-label">Domain</label>
          <input className="input input-success" defaultValue="dhakadenim" />
          <div className="field-help success">
            <Icon name="check" size={12} /> dhakadenim.softitcare.com
          </div>
        </div>
        <div className="field">
          <label className="field-label">Phone number</label>
          <div className="input-group">
            <div className="input-addon">
              <span className="bd-flag">BD</span>
              <span className="mono" style={{ fontSize: 13 }}>
                11 digit
              </span>
            </div>
            <input className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="field-label">Price</label>
          <div className="input-group">
            <div className="input-addon" style={{ fontWeight: 700 }}>
              Tk
            </div>
            <input className="input mono" value={price} onChange={(e) => setPrice(e.target.value)} />
            <div className="input-addon-right">BDT</div>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Password</label>
          <input className="input mono" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label className="field-label">Description</label>
          <textarea className="input textarea" rows={3} defaultValue="Premium selvedge denim, handcrafted in Dhaka." />
        </div>
      </div>

      <div className="controls-grid" style={{ marginTop: 16 }}>
        <div className="controls-col">
          <div className="controls-col-label">Checkbox</div>
          {([{ k: "a", l: "Send SMS notifications" }, { k: "b", l: "Email updates" }, { k: "c", l: "WhatsApp order confirmations" }] as const).map((x) => (
            <label key={x.k} className="check">
              <input type="checkbox" checked={check[x.k]} onChange={() => setCheck({ ...check, [x.k]: !check[x.k] })} />
              <span className="check-box">
                <Icon name="check" size={12} />
              </span>
              <span className="check-label">{x.l}</span>
            </label>
          ))}
        </div>
        <div className="controls-col">
          <div className="controls-col-label">Radio — payment</div>
          {[{ k: "card", l: "Credit/debit card" }, { k: "bkash", l: "bKash" }, { k: "cod", l: "Cash on delivery" }].map((x) => (
            <label key={x.k} className="radio">
              <input type="radio" name="pm" checked={radio === x.k} onChange={() => setRadio(x.k)} />
              <span className="radio-dot" />
              <span className="check-label">{x.l}</span>
            </label>
          ))}
        </div>
        <div className="controls-col">
          <div className="controls-col-label">Toggle</div>
          <label className="toggle-row">
            <span className="check-label">Store is live</span>
            <button className={`toggle ${toggle ? "on" : ""}`} onClick={() => setToggle(!toggle)}>
              <span className="toggle-thumb" />
            </button>
          </label>
          <label className="toggle-row">
            <span className="check-label">Auto-confirm COD</span>
            <button className="toggle on">
              <span className="toggle-thumb" />
            </button>
          </label>
          <label className="toggle-row">
            <span className="check-label">Out-of-stock orders</span>
            <button className="toggle">
              <span className="toggle-thumb" />
            </button>
          </label>
        </div>
      </div>
    </section>
  );
};

const FilterShow = () => {
  const [range1, setRange1] = useState("today");
  const [range2, setRange2] = useState("month");
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Date range filter</h2>
          <p className="section-sub">Reusable filter box with 6 presets — Today, Yesterday, This Week, This Month, Last Month, Custom Date. Drop it in any dashboard, report, or list screen.</p>
        </div>
        <span className="section-tag">components/filter-box</span>
      </div>

      <div style={{ padding: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-subtle)", marginBottom: 10 }}>Default · with label</div>
        <FilterBox value={range1} onChange={setRange1} />

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-subtle)", marginTop: 24, marginBottom: 10 }}>Compact · inline in a filter bar</div>
        <div className="fb-bar">
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)", paddingLeft: 4 }}>Filter by:</span>
          <FilterBox compact value={range2} onChange={setRange2} />
          <div style={{ width: 1, height: 22, background: "var(--border)" }} />
          <button className="btn btn-secondary btn-sm">
            <Icon name="arrowRight" size={12} style={{ transform: "rotate(90deg)" }} /> All statuses
          </button>
          <button className="btn btn-secondary btn-sm">All couriers</button>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-subtle)" }}>127 results</div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-subtle)", marginTop: 24, marginBottom: 10 }}>Custom date — expanded state</div>
        <FilterBox value="custom" onChange={() => {}} label="Period" />
        <div style={{ fontSize: 11, color: "var(--ink-subtle)", marginTop: 8 }}>
          Click the box above to open the menu and select <b>Custom Date</b> to reveal the From / To picker.
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-subtle)", marginTop: 24, marginBottom: 10 }}>Usage</div>
        <pre style={{ margin: 0, padding: 14, background: "var(--surface-2)", borderRadius: "var(--r-md)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--ink-2)", overflowX: "auto" }}>
{`const [range, setRange] = useState("today");
<FilterBox value={range} onChange={setRange} label="Date range"/>
// Use <FilterBox compact/> for toolbars
// IDs: today | yesterday | week | month | lastmonth | custom`}
        </pre>
      </div>
    </section>
  );
};

const BadgeShow = () => (
  <section className="section">
    <div className="section-head">
      <div>
        <h2 className="section-title">Status badges &amp; pills</h2>
        <p className="section-sub">Order lifecycle, payment methods, couriers, customer tags.</p>
      </div>
      <span className="section-tag">components/badge</span>
    </div>
    <div className="badge-row">
      <span className="badge badge-pending">
        <span className="badge-dot pulse" /> Pending
      </span>
      <span className="badge badge-confirmed">
        <span className="badge-dot" /> Confirmed
      </span>
      <span className="badge badge-processing">
        <span className="badge-spinner" /> Processing
      </span>
      <span className="badge badge-shipped">
        <Icon name="truck" size={12} /> Shipped
      </span>
      <span className="badge badge-delivered">
        <Icon name="check" size={12} /> Delivered
      </span>
      <span className="badge badge-cancelled">
        <Icon name="x" size={12} /> Cancelled
      </span>
      <span className="badge badge-fraud">
        <Icon name="zap" size={12} /> Fraud flag
      </span>
    </div>
    <div className="pill-row" style={{ marginTop: 10 }}>
      <span className="pay-pill" style={{ "--c": "var(--bkash)" } as CSSProperties}>
        bKash
      </span>
      <span className="pay-pill" style={{ "--c": "var(--nagad)" } as CSSProperties}>
        Nagad
      </span>
      <span className="pay-pill" style={{ "--c": "var(--ssl)" } as CSSProperties}>
        SSLCommerz
      </span>
      <span className="pay-pill" style={{ "--c": "var(--cod)" } as CSSProperties}>
        <Icon name="package" size={12} /> COD
      </span>
    </div>
    <div className="pill-row" style={{ marginTop: 10 }}>
      {([["Steadfast", "var(--steadfast)"], ["Pathao", "var(--pathao)"], ["RedX", "var(--redx)"], ["Carrybee", "var(--carrybee)"]] as [string, string][]).map(([n, c]) => (
        <span key={n} className="courier-pill" style={{ "--c": c } as CSSProperties}>
          <span className="courier-dot" style={{ background: c }} />
          {n}
        </span>
      ))}
      <span className="tag-pill tag-vip">★ VIP customer</span>
      <span className="tag-pill tag-returning">Returning</span>
      <span className="tag-pill tag-new">New</span>
      <span className="plan-pill plan-growth">GROWTH</span>
      <span className="plan-pill plan-pro">PRO</span>
    </div>
  </section>
);

const CardShow = () => (
  <section className="section">
    <div className="section-head">
      <div>
        <h2 className="section-title">Cards</h2>
        <p className="section-sub">Stat, product, order, empty state, AI CTA.</p>
      </div>
      <span className="section-tag">components/card</span>
    </div>
    <div className="stat-row">
      <div className="stat-card">
        <div className="stat-card-label">Revenue today</div>
        <div className="stat-card-value mono">{FMT.money(124500)}</div>
        <div className="stat-card-delta up">
          <Icon name="trendUp" size={12} /> +18.2%
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-card-label">Orders</div>
        <div className="stat-card-value mono">1,247</div>
        <div className="stat-card-delta up">
          <Icon name="trendUp" size={12} /> +12.4%
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-card-label">Conversion</div>
        <div className="stat-card-value mono">3.42%</div>
        <div className="stat-card-delta down">
          <Icon name="trendDown" size={12} /> −0.8%
        </div>
      </div>
      <div className="stat-card stat-hero">
        <div className="stat-card-label" style={{ opacity: 0.95 }}>
          This month
        </div>
        <div className="stat-card-value mono" style={{ color: "#fff" }}>
          {FMT.lakh(2840000)}
        </div>
        <div className="stat-card-delta" style={{ color: "rgba(255,255,255,0.9)" }}>
          <Icon name="trendUp" size={12} /> +34%
        </div>
      </div>
    </div>
    <div className="cards-grid" style={{ marginTop: 12 }}>
      <div className="product-card">
        <div className="product-img">
          <div className="product-img-placeholder" style={{ background: "linear-gradient(135deg,#fce7f3,#fbcfe8)" }}>
            <Icon name="shoppingBag" size={32} />
          </div>
          <span className="product-tag">−20%</span>
        </div>
        <div className="product-body">
          <div className="product-title">Selvedge Denim Jacket</div>
          <div className="product-cat">Fashion · Women</div>
          <div className="product-prices">
            <span className="product-price mono">{FMT.money(2499)}</span>
            <span className="product-old mono">{FMT.money(3120)}</span>
          </div>
          <div className="product-stock">
            <span className="stock-dot" style={{ background: "var(--lime)" }} />
            48 in stock
          </div>
        </div>
      </div>
      <div className="order-card">
        <div className="order-head">
          <div>
            <div className="order-id mono">#SC-00847</div>
            <div className="order-time">2 min ago</div>
          </div>
          <span className="badge badge-pending">
            <span className="badge-dot pulse" /> Pending
          </span>
        </div>
        <div className="order-customer">
          <div className="order-avatar">RA</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="order-cust-name">Rahima Akhtar</div>
            <div className="order-cust-meta mono">{FMT.phoneMasked("17123456780")} · Dhaka</div>
          </div>
          <div className="order-amount mono">{FMT.money(3450)}</div>
        </div>
        <div className="order-items">3 items · Denim jacket, Scarf, Tote bag</div>
        <div className="order-actions">
          <button className="btn btn-primary btn-sm">Confirm</button>
          <button className="btn btn-secondary btn-sm">Call</button>
        </div>
      </div>
      <div className="empty-card">
        <div className="empty-illus">
          <svg width="90" height="70" viewBox="0 0 100 80" fill="none">
            <rect x="18" y="30" width="64" height="44" rx="6" fill="var(--purple-50)" stroke="var(--purple-300)" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx="70" cy="20" r="8" fill="var(--purple-600)" />
            <path d="M70 16v8M66 20h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="empty-title">No products yet</div>
        <div className="empty-body">Add your first product to start selling.</div>
        <button className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} /> Add product
        </button>
      </div>
      <div className="cta-card">
        <div className="cta-pattern" />
        <div className="cta-inner">
          <div className="cta-icon">
            <Icon name="sparkles" size={22} />
          </div>
          <div className="cta-title">Build your store in 60s</div>
          <div className="cta-body">AI writes copy, picks layout, matches your brand.</div>
          <button className="btn btn-ai">
            <Icon name="sparkles" size={14} /> Try AI builder
          </button>
        </div>
      </div>
    </div>
  </section>
);

type Row = { id: string; cust: string; loc: string; items: number; amt: number; pay: string; cour: string; status: string };
const TableShow = () => {
  const [sel, setSel] = useState<Set<number>>(new Set([2]));
  const rows: Row[] = [
    { id: "#SC-00847", cust: "Rahima Akhtar", loc: "Dhaka", items: 3, amt: 3450, pay: "bkash", cour: "steadfast", status: "pending" },
    { id: "#SC-00846", cust: "Karim Uddin", loc: "Chittagong", items: 1, amt: 1299, pay: "cod", cour: "pathao", status: "confirmed" },
    { id: "#SC-00845", cust: "Tania Rahman", loc: "Sylhet", items: 2, amt: 2100, pay: "nagad", cour: "redx", status: "processing" },
    { id: "#SC-00844", cust: "Siam Hossain", loc: "Dhaka", items: 5, amt: 8900, pay: "ssl", cour: "steadfast", status: "shipped" },
    { id: "#SC-00843", cust: "Nusrat Jahan", loc: "Khulna", items: 2, amt: 4299, pay: "bkash", cour: "carrybee", status: "delivered" },
  ];
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const toggleAll = () => setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))));
  const payBrand: Record<string, [string, string]> = { bkash: ["bKash", "var(--bkash)"], nagad: ["Nagad", "var(--nagad)"], cod: ["COD", "var(--cod)"], ssl: ["SSL", "var(--ssl)"] };
  const courBrand: Record<string, [string, string]> = { steadfast: ["Steadfast", "var(--steadfast)"], pathao: ["Pathao", "var(--pathao)"], redx: ["RedX", "var(--redx)"], carrybee: ["Carrybee", "var(--carrybee)"] };
  const statusLabel: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", processing: "Processing", shipped: "Shipped", delivered: "Delivered" };
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Data table</h2>
          <p className="section-sub">Selectable, sortable, inline brand pills.</p>
        </div>
        <span className="section-tag">components/table</span>
      </div>
      <div className="table-wrap">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            {sel.size > 0 ? (
              <>
                <span className="table-sel-count">{sel.size} selected</span>
                <button className="btn btn-sm btn-secondary">Confirm</button>
                <button className="btn btn-sm btn-secondary">Ship</button>
              </>
            ) : (
              <>
                <span className="filter-chip active">
                  All <span className="filter-count">1,247</span>
                </span>
                <span className="filter-chip">
                  Pending <span className="filter-count">48</span>
                </span>
                <span className="filter-chip">
                  Processing <span className="filter-count">24</span>
                </span>
                <span className="filter-chip">
                  Shipped <span className="filter-count">135</span>
                </span>
              </>
            )}
          </div>
          <div className="table-toolbar-right">
            <button className="btn btn-sm btn-secondary">
              <Icon name="search" size={13} /> Search
            </button>
            <button className="btn btn-sm btn-secondary">Export</button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <label className="check" style={{ display: "inline-flex" }}>
                    <input type="checkbox" checked={sel.size === rows.length} onChange={toggleAll} />
                    <span className="check-box">
                      <Icon name="check" size={12} />
                    </span>
                  </label>
                </th>
                <th>Order</th>
                <th>Customer</th>
                <th>Items</th>
                <th className="num">Amount</th>
                <th>Payment</th>
                <th>Courier</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={sel.has(i) ? "selected" : ""}>
                  <td>
                    <label className="check" style={{ display: "inline-flex" }}>
                      <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} />
                      <span className="check-box">
                        <Icon name="check" size={12} />
                      </span>
                    </label>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      {r.id}
                    </span>
                  </td>
                  <td>
                    <div className="table-cust-name">{r.cust}</div>
                    <div className="table-cust-sub">{r.loc}</div>
                  </td>
                  <td style={{ color: "var(--ink-muted)" }}>{r.items}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>
                    {FMT.money(r.amt)}
                  </td>
                  <td>
                    <span className="mini-pay" style={{ "--c": payBrand[r.pay][1] } as CSSProperties}>
                      {payBrand[r.pay][0]}
                    </span>
                  </td>
                  <td>
                    <span className="mini-cour">
                      <span className="mini-cour-dot" style={{ background: courBrand[r.cour][1] }} />
                      {courBrand[r.cour][0]}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${r.status}`}>
                      {r.status === "pending" && <span className="badge-dot pulse" />}
                      {r.status === "processing" && <span className="badge-spinner" />}
                      {statusLabel[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <div className="table-page-info">
            Showing <b>1–5</b> of <b className="mono">1,247</b>
          </div>
          <div className="table-page-controls">
            <button className="btn btn-xs btn-secondary" disabled>
              Previous
            </button>
            <button className="btn btn-xs btn-primary">1</button>
            <button className="btn btn-xs btn-ghost">2</button>
            <button className="btn btn-xs btn-ghost">3</button>
            <button className="btn btn-xs btn-secondary">Next</button>
          </div>
        </div>
      </div>
    </section>
  );
};

type Toast = { id: number; v: string; t: string; b: string };
const FeedbackShow = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [seq, setSeq] = useState(0);
  const fire = (v: string) => {
    const id = seq + 1;
    setSeq(id);
    const msgs: Record<string, [string, string]> = {
      success: ["Order delivered!", "#SC-00845 confirmed by Steadfast."],
      warning: ["Stock low", "Denim jacket: 3 left."],
      error: ["Payment failed", "bKash gateway timed out."],
      info: ["AI feature live", "Page builder in beta."],
    };
    setToasts((ts) => [...ts, { id, v, t: msgs[v][0], b: msgs[v][1] }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  };
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Feedback</h2>
          <p className="section-sub">Alerts, toasts.</p>
        </div>
        <span className="section-tag">components/feedback</span>
      </div>
      <div className="alerts-stack">
        <div className="alert alert-success">
          <Icon name="check" size={18} />
          <div className="alert-body">
            <div className="alert-title">Payout sent</div>
            <div className="alert-msg">{FMT.money(48250)} deposited to your bKash wallet.</div>
          </div>
        </div>
        <div className="alert alert-warning">
          <Icon name="zap" size={18} />
          <div className="alert-body">
            <div className="alert-title">5 orders need confirmation</div>
            <div className="alert-msg">COD orders over {FMT.money(5000)} require phone verification.</div>
          </div>
        </div>
        <div className="alert alert-error">
          <Icon name="zap" size={18} />
          <div className="alert-body">
            <div className="alert-title">Steadfast API is down</div>
            <div className="alert-msg">New shipments queued until service is restored.</div>
          </div>
        </div>
      </div>
      <div className="comp-demo" style={{ marginTop: 16 }}>
        <button className="btn btn-sm btn-secondary" onClick={() => fire("success")}>
          Success toast
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => fire("warning")}>
          Warning toast
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => fire("error")}>
          Error toast
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => fire("info")}>
          Info toast
        </button>
      </div>
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.v}`}>
            <div className="toast-icon">
              <Icon name={t.v === "success" ? "check" : t.v === "info" ? "sparkles" : "zap"} size={16} />
            </div>
            <div>
              <div className="toast-title">{t.t}</div>
              <div className="toast-msg">{t.b}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default function ComponentsPage() {
  return (
    <DsShell page="components" crumbs={["Design System", "Components"]}>
      <header className="page-header">
        <div className="page-eyebrow">Components</div>
        <h1 className="page-title">Every piece, every state.</h1>
        <p className="page-lede">Forged from tokens — 100+ variants with light/dark theming, live states, real interactions.</p>
      </header>
      <ButtonShow />
      <InputShow />
      <FilterShow />
      <BadgeShow />
      <CardShow />
      <TableShow />
      <FeedbackShow />
    </DsShell>
  );
}
