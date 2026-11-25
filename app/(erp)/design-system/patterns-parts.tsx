"use client";

import { useEffect, useState, type CSSProperties, Fragment } from "react";
import { Icon } from "./lib/icons";
import { FMT, banglaNumerals } from "./lib/format";

type CSSVars = CSSProperties & Record<string, string | number>;

/* ---------------- Live revenue chart ---------------- */
export const LiveChart = () => {
  const [range, setRange] = useState("7d");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const datasets: Record<string, { labels: string[]; data: number[]; total: number; grow: number }> = {
    "24h": { labels: ["00", "04", "08", "12", "16", "20", "24"], data: [12, 8, 22, 45, 68, 52, 38], total: 1247, grow: 12.4 },
    "7d": { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], data: [180, 240, 200, 280, 160, 320, 290], total: 8670, grow: 18.2 },
    "30d": { labels: ["W1", "W2", "W3", "W4"], data: [1240, 1680, 1950, 2400], total: 28400, grow: 34.1 },
    "90d": { labels: ["Jan", "Feb", "Mar"], data: [18000, 24500, 28400], total: 70900, grow: 56.7 },
  };
  const d = datasets[range];
  const max = Math.max(...d.data) * 1.1;
  const points = d.data.map((v, i) => [(i / (d.data.length - 1)) * 100, 100 - (v / max) * 88]);
  const pathLine = "M" + points.map((p) => `${p[0]},${p[1]}`).join(" L");
  const pathArea = pathLine + ` L100,100 L0,100 Z`;
  return (
    <div className="live-chart-card">
      <div className="live-chart-head">
        <div>
          <div className="live-chart-label">Revenue</div>
          <div className="live-chart-total mono">{FMT.money(d.total * 100)}</div>
          <div className="live-chart-grow">
            <Icon name="trendUp" size={12} /> +{d.grow}% vs previous period
          </div>
        </div>
        <div className="pill-tabs" style={{ padding: 3 }}>
          {["24h", "7d", "30d", "90d"].map((r) => (
            <button key={r} className={`pill-tab ${range === r ? "active" : ""}`} onClick={() => setRange(r)} style={{ padding: "5px 11px", fontSize: 12 }}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="live-chart-svg-wrap">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="live-chart-svg"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rx = ((e.clientX - rect.left) / rect.width) * 100;
            setHoverIdx(Math.max(0, Math.min(d.data.length - 1, Math.round((rx / 100) * (d.data.length - 1)))));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="lc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--purple-600)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--purple-600)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 25, 50, 75].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--border)" strokeWidth="0.2" strokeDasharray="1 1" />
          ))}
          <path d={pathArea} fill="url(#lc-area)" />
          <path d={pathLine} fill="none" stroke="var(--purple-600)" strokeWidth="0.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {points.map(([x, y], i) => (
            <g key={i}>
              {hoverIdx === i && <line x1={x} y1="0" x2={x} y2="100" stroke="var(--purple-600)" strokeWidth="0.3" strokeDasharray="2 2" />}
              <circle cx={x} cy={y} r={hoverIdx === i ? 1.5 : 0.8} fill="var(--surface)" stroke="var(--purple-600)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {hoverIdx !== null && (
          <div className="live-chart-tip" style={{ left: `${points[hoverIdx][0]}%` }}>
            <div className="tip-label">{d.labels[hoverIdx]}</div>
            <div className="tip-value mono">{FMT.money(d.data[hoverIdx] * 100)}</div>
          </div>
        )}
      </div>
      <div className="live-chart-axis">
        {d.labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
};

/* ---------------- Confetti ---------------- */
type Piece = { id: number; x: number; ax: number; ay: number; rot: number; color: string; delay: number; size: number };
export const Confetti = ({ fire }: { fire: number }) => {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    if (!fire) return;
    const colors = ["#f97316", "#eab308", "#84cc16", "#14b8a6", "#7c3aed", "#a78bfa"];
    const ps: Piece[] = Array.from({ length: 40 }, (_, i) => ({
      id: fire * 1000 + i,
      x: 50 + (Math.random() - 0.5) * 20,
      ax: (Math.random() - 0.5) * 300,
      ay: -200 - Math.random() * 150,
      rot: Math.random() * 720,
      color: colors[i % colors.length],
      delay: Math.random() * 80,
      size: 6 + Math.random() * 5,
    }));
    setPieces(ps);
    const t = setTimeout(() => setPieces([]), 1800);
    return () => clearTimeout(t);
  }, [fire]);
  return (
    <div className="confetti-root">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{ left: `${p.x}%`, background: p.color, width: p.size, height: p.size * 1.4, "--ax": `${p.ax}px`, "--ay": `${p.ay}px`, "--rot": `${p.rot}deg`, animationDelay: `${p.delay}ms` } as CSSVars}
        />
      ))}
    </div>
  );
};

/* ---------------- Merchant dashboard mock ---------------- */
export const DashboardMock = () => {
  const [fire, setFire] = useState(0);
  return (
    <section className="section" id="dashboard">
      <div className="section-head">
        <div>
          <h2 className="section-title">Merchant dashboard</h2>
          <p className="section-sub">Live product mock — real components composed into a full screen.</p>
        </div>
        <span className="section-tag">patterns/dashboard</span>
      </div>
      <div className="dash-mock">
        <div className="dash-greet">
          <div>
            <div className="hand" style={{ fontSize: 22, color: "var(--purple-600)" }}>
              Assalamu alaikum,
            </div>
            <h3 className="dash-greet-title">Good morning, Raihan.</h3>
            <div className="dash-greet-meta">
              <span className="mono">{FMT.date(new Date(2026, 3, 20, 10, 24))} · 10:24 AM</span>
              <span style={{ color: "var(--ink-faint)" }}>·</span>
              <span className="bangla">সোমবার সকাল</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm">
              <Icon name="megaphone" size={13} /> Bulk SMS
            </button>
            <button className="btn btn-ai btn-sm">
              <Icon name="sparkles" size={13} /> AI assistant
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setFire((n) => n + 1)}>
              <Icon name="plus" size={13} /> Add product
            </button>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-card-label">Orders today</div>
            <div className="stat-card-value mono">247</div>
            <div className="stat-card-delta up">
              <Icon name="trendUp" size={12} /> +12.4%
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Revenue today</div>
            <div className="stat-card-value mono">{FMT.money(124500)}</div>
            <div className="stat-card-delta up">
              <Icon name="trendUp" size={12} /> +18.2%
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
              Month-to-date
            </div>
            <div className="stat-card-value mono" style={{ color: "#fff" }}>
              {FMT.lakh(2840000)}
            </div>
            <div className="stat-card-delta" style={{ color: "rgba(255,255,255,0.9)" }}>
              <Icon name="trendUp" size={12} /> +34%
            </div>
          </div>
        </div>
        <div className="dash-row2">
          <LiveChart />
          <div className="dash-side">
            <div className="dash-side-card">
              <div className="dash-side-head">
                <span className="dash-side-title">Needs action</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--tangerine)" }}>
                  5 urgent
                </span>
              </div>
              <div className="action-item">
                <span className="action-dot" style={{ background: "var(--tangerine)" }} />
                <span className="action-text">3 COD orders over {FMT.money(5000)}</span>
                <Icon name="chevronRight" size={14} />
              </div>
              <div className="action-item">
                <span className="action-dot" style={{ background: "var(--sun)" }} />
                <span className="action-text">Denim Jacket: 3 units left</span>
                <Icon name="chevronRight" size={14} />
              </div>
              <div className="action-item">
                <span className="action-dot" style={{ background: "var(--error)" }} />
                <span className="action-text">Steadfast pickup delayed</span>
                <Icon name="chevronRight" size={14} />
              </div>
            </div>
            <div className="dash-side-card" style={{ background: "var(--grad-brand-soft)", borderColor: "var(--purple-200)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", background: "var(--grad-purple-teal)", display: "grid", placeItems: "center", color: "#fff" }}>
                  <Icon name="sparkles" size={14} />
                </div>
                <div className="dash-side-title">AI Insight</div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                Orders from <b>Chittagong</b> are up <b>46%</b> this week. Consider running a targeted Facebook ad or partnering with a local influencer.
              </div>
              <button className="btn btn-sm btn-secondary" style={{ marginTop: 12 }}>
                View analysis <Icon name="arrowRight" size={12} />
              </button>
            </div>
          </div>
        </div>
        <div className="dash-orders">
          <div className="section-head" style={{ marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent orders</h3>
              <p className="section-sub" style={{ marginTop: 2, fontSize: 12 }}>
                Latest 4
              </p>
            </div>
            <span className="link-btn">View all 247 →</span>
          </div>
          <div className="cards-grid">
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
                  <div className="order-cust-meta mono">Dhaka · bKash</div>
                </div>
                <div className="order-amount mono">{FMT.money(3450)}</div>
              </div>
              <div className="order-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setFire((n) => n + 1)}>
                  Confirm
                </button>
                <button className="btn btn-secondary btn-sm">Call</button>
              </div>
            </div>
            <div className="order-card">
              <div className="order-head">
                <div>
                  <div className="order-id mono">#SC-00846</div>
                  <div className="order-time">8 min ago</div>
                </div>
                <span className="badge badge-confirmed">
                  <span className="badge-dot" /> Confirmed
                </span>
              </div>
              <div className="order-customer">
                <div className="order-avatar" style={{ background: "linear-gradient(135deg,#f97316,#eab308)" }}>
                  KU
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="order-cust-name">Karim Uddin</div>
                  <div className="order-cust-meta mono">Chittagong · COD</div>
                </div>
                <div className="order-amount mono">{FMT.money(1299)}</div>
              </div>
              <div className="order-actions">
                <button className="btn btn-primary btn-sm">Pack &amp; ship</button>
                <button className="btn btn-ghost btn-sm">Details</button>
              </div>
            </div>
            <div className="order-card">
              <div className="order-head">
                <div>
                  <div className="order-id mono">#SC-00845</div>
                  <div className="order-time">22 min ago</div>
                </div>
                <span className="badge badge-shipped">
                  <Icon name="truck" size={12} /> Shipped
                </span>
              </div>
              <div className="order-customer">
                <div className="order-avatar" style={{ background: "linear-gradient(135deg,#14b8a6,#84cc16)" }}>
                  TR
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="order-cust-name">Tania Rahman</div>
                  <div className="order-cust-meta mono">Sylhet · Steadfast</div>
                </div>
                <div className="order-amount mono">{FMT.money(2100)}</div>
              </div>
              <div className="order-actions">
                <button className="btn btn-secondary btn-sm">Track</button>
                <button className="btn btn-ghost btn-sm">Details</button>
              </div>
            </div>
            <div className="order-card">
              <div className="order-head">
                <div>
                  <div className="order-id mono">#SC-00843</div>
                  <div className="order-time">1 hr ago</div>
                </div>
                <span className="badge badge-delivered">
                  <Icon name="check" size={12} /> Delivered
                </span>
              </div>
              <div className="order-customer">
                <div className="order-avatar" style={{ background: "linear-gradient(135deg,#7c3aed,#f97316)" }}>
                  NJ
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="order-cust-name">Nusrat Jahan</div>
                  <div className="order-cust-meta mono">Khulna · Carrybee</div>
                </div>
                <div className="order-amount mono">{FMT.money(4299)}</div>
              </div>
              <div className="order-actions">
                <button className="btn btn-secondary btn-sm">Review</button>
                <button className="btn btn-ghost btn-sm">Details</button>
              </div>
            </div>
          </div>
        </div>
        <Confetti fire={fire} />
      </div>
    </section>
  );
};

/* ---------------- Order lifecycle ---------------- */
export const OrderLifecycle = () => {
  const steps: { l: string; i: string; c: string; active?: boolean }[] = [
    { l: "Placed", i: "shoppingBag", c: "var(--purple-600)" },
    { l: "Confirmed", i: "check", c: "var(--info)" },
    { l: "Packed", i: "package", c: "var(--purple-600)" },
    { l: "Picked", i: "truck", c: "var(--tangerine)" },
    { l: "Out for delivery", i: "truck", c: "var(--sun)", active: true },
    { l: "Delivered", i: "check", c: "var(--teal)" },
  ];
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Order lifecycle</h2>
          <p className="section-sub">Placement to delivery — the core flow merchants live in.</p>
        </div>
        <span className="section-tag">patterns/order-flow</span>
      </div>
      <div className="lifecycle-track">
        {steps.map((s, i, a) => (
          <Fragment key={i}>
            <div className={`lc-step ${s.active ? "active" : i < 4 ? "done" : ""}`}>
              <div className="lc-bubble" style={{ "--c": s.c } as CSSVars}>
                <Icon name={s.i} size={18} />
              </div>
              <div className="lc-label">{s.l}</div>
            </div>
            {i < a.length - 1 && <div className={`lc-line ${i < 4 ? "done" : ""}`} />}
          </Fragment>
        ))}
      </div>
    </section>
  );
};

/* ---------------- Bangla-first showcase ---------------- */
export const BanglaSection = () => (
  <section className="section" id="bangla">
    <div className="section-head">
      <div>
        <h2 className="section-title">Bangla-first UI</h2>
        <p className="section-sub">Hind Siliguri typography, Bangla numerals, bilingual pairings.</p>
      </div>
      <span className="section-tag bangla">বাংলা/UI</span>
    </div>
    <div className="bangla-grid">
      <div className="bangla-card bangla-type">
        <div className="bangla-card-label">Type ramp · Hind Siliguri</div>
        <div className="bangla" style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.1, marginBottom: 6 }}>
          আনন্দের বাণিজ্য
        </div>
        <div className="bangla" style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          বিক্রয় বাড়ান
        </div>
        <div className="bangla" style={{ fontSize: 17, color: "var(--ink-muted)", lineHeight: 1.6 }}>
          ৫০০+ বাংলাদেশী উদ্যোক্তার পাশে, ১০ হাজার+ অর্ডার প্রতিদিন।
        </div>
      </div>
      <div className="bangla-card">
        <div className="bangla-card-label">Numerals</div>
        <div className="bangla-num-row">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <div key={n} className="bangla-num-cell">
              <div className="bangla" style={{ fontSize: 26, fontWeight: 600 }}>
                {"০১২৩৪৫৬৭৮৯"[n]}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-subtle)" }}>
                {n}
              </div>
            </div>
          ))}
        </div>
        <div className="bangla-price-sample">
          <div className="mono" style={{ fontSize: 14, color: "var(--ink-subtle)" }}>
            {FMT.money(124500)}
          </div>
          <Icon name="arrowRight" size={14} style={{ color: "var(--ink-faint)" }} />
          <div className="bangla" style={{ fontSize: 16, fontWeight: 600 }}>
            ১,২৪,৫০০ ৳
          </div>
        </div>
      </div>
      <div className="bangla-card bangla-card-wide">
        <div className="bangla-card-label">Bilingual order card</div>
        <div className="order-card" style={{ marginTop: 10 }}>
          <div className="order-head">
            <div>
              <div className="order-id mono">#SC-00847</div>
              <div className="order-time">
                <span className="bangla">রহিমা আক্তার</span> · <span className="bangla">ঢাকা</span>
              </div>
            </div>
            <span className="badge badge-pending">
              <span className="badge-dot pulse" /> <span className="bangla">অপেক্ষমাণ</span>
            </span>
          </div>
          <div className="order-customer">
            <div className="order-avatar">রআ</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="order-cust-name bangla">রহিমা আক্তার</div>
              <div className="order-cust-meta mono">+৮৮০ ১৭১২৩৪৫৬৭৮</div>
            </div>
            <div className="order-amount bangla">Tk ৩,৪৫০</div>
          </div>
          <div className="order-actions">
            <button className="btn btn-primary btn-sm bangla">নিশ্চিত করুন</button>
            <button className="btn btn-secondary btn-sm bangla">কল করুন</button>
          </div>
        </div>
      </div>
      <div className="bangla-card">
        <div className="bangla-card-label">Bilingual navigation</div>
        <div className="bangla-nav">
          {[
            { en: "Orders", bn: "অর্ডার", c: 247 },
            { en: "Products", bn: "পণ্য", c: 84 },
            { en: "Customers", bn: "গ্রাহক", c: 3421 },
            { en: "Analytics", bn: "বিশ্লেষণ", c: undefined as number | undefined },
          ].map((it, i) => (
            <div key={i} className={`bangla-nav-item ${i === 0 ? "active" : ""}`}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.en}</div>
                <div className="bangla" style={{ fontSize: 12, color: "var(--ink-subtle)", marginTop: 2 }}>
                  {it.bn}
                </div>
              </div>
              {it.c && <span className="count">{banglaNumerals(it.c)}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="bangla-card bangla-card-wide">
        <div className="bangla-card-label">Weight showcase · 300–700</div>
        <div className="bangla-weights">
          {[300, 400, 500, 600, 700].map((w) => (
            <div key={w} className="bangla-weight-row">
              <div className="bangla" style={{ fontSize: 22, fontWeight: w }}>
                সফট আইটি কেয়ার — বাংলাদেশের জন্য
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-subtle)" }}>
                {w}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);
