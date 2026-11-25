"use client";

import Link from "next/link";
import { DsShell } from "./ds-shell";
import { Icon } from "./lib/icons";

export default function OverviewPage() {
  return (
    <DsShell page="overview" crumbs={["Design System", "Overview"]}>
      <div className="hero">
        <div className="hero-inner">
          <div className="hero-eyebrow">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--purple-600)" }} />
            Soft IT Care Design System · v1.0
          </div>
          <h1 className="hero-title">
            Commerce that feels
            <br />
            <span className="accent">local, human, and fast.</span>
          </h1>
          <p className="hero-lede">
            A design system crafted for Bangladeshi commerce. From bKash to Steadfast, from Bangla-first UI to sub-60-second setup — every component is forged for the realities of local commerce.
          </p>
          <div className="hero-actions">
            <Link href="/design-system/foundations" className="btn btn-primary btn-lg">
              Explore foundations <Icon name="arrowRight" />
            </Link>
            <Link href="/design-system/components" className="btn btn-secondary btn-lg">
              Browse components
            </Link>
            <Link href="/design-system/merchant-dashboard" className="btn btn-ghost btn-lg">
              See live dashboard
            </Link>
          </div>
          <div className="hero-meta">
            <span>
              <Icon name="check" size={12} /> 120+ components
            </span>
            <span>
              <Icon name="check" size={12} /> Light · Dark · Auto
            </span>
            <span>
              <Icon name="check" size={12} /> Bangla-first
            </span>
            <span>
              <Icon name="check" size={12} /> WCAG AA
            </span>
          </div>
        </div>
        <div className="hero-art">
          <div className="hero-art-card card-a">
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-subtle)" }}>
              REVENUE TODAY
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
              1,24,500 Tk
            </div>
            <div style={{ fontSize: 11, color: "var(--teal)", fontWeight: 600, marginTop: 4 }}>▲ +18.2%</div>
          </div>
          <div className="hero-art-card card-b">
            <span className="badge badge-pending" style={{ alignSelf: "flex-start" }}>
              <span className="badge-dot pulse" /> Pending
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>#SC-00847</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-subtle)", marginTop: 2 }}>
              Rahima · 3,450 Tk
            </div>
          </div>
          <div className="hero-art-card card-c" style={{ background: "var(--grad-purple-teal)", color: "#fff", border: "none" }}>
            <Icon name="sparkles" size={18} />
            <div style={{ fontSize: 12, marginTop: 8, fontWeight: 600 }}>AI Assistant</div>
            <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>Chittagong +46% this week</div>
          </div>
          <div className="hero-art-card card-d">
            <div className="bangla" style={{ fontSize: 20, fontWeight: 700 }}>
              আনন্দের বাণিজ্য
            </div>
            <div className="bangla" style={{ fontSize: 11, color: "var(--ink-subtle)", marginTop: 4 }}>
              বাংলাদেশী উদ্যোক্তা
            </div>
          </div>
        </div>
      </div>

      <div className="stats-hero">
        <div className="stat-hero-card">
          <div className="stat-hero-label">Components</div>
          <div className="stat-hero-value mono">120+</div>
          <div className="stat-hero-sub">Buttons to dashboards</div>
        </div>
        <div className="stat-hero-card">
          <div className="stat-hero-label">Design tokens</div>
          <div className="stat-hero-value mono">80+</div>
          <div className="stat-hero-sub">Colour · type · space</div>
        </div>
        <div className="stat-hero-card">
          <div className="stat-hero-label">Themes</div>
          <div className="stat-hero-value mono">3</div>
          <div className="stat-hero-sub">Light · Dark · Auto</div>
        </div>
        <div className="stat-hero-card">
          <div className="stat-hero-label">Languages</div>
          <div className="stat-hero-value mono">2</div>
          <div className="stat-hero-sub">English · বাংলা</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Design principles</h2>
            <p className="section-sub">Four commitments that shape every decision in the system.</p>
          </div>
        </div>
        <div className="philo-grid">
          <div className="philo-card">
            <div className="philo-num">01</div>
            <h3 className="philo-title">Bangla-first, not Bangla-added</h3>
            <p className="philo-body">Hind Siliguri sits beside Inter as a first-class citizen. Bangla numerals, bilingual pairings, and merchant-colloquial copy are built into the tokens — not patched in later.</p>
          </div>
          <div className="philo-card">
            <div className="philo-num">02</div>
            <h3 className="philo-title">Commerce lives in the dashboard</h3>
            <p className="philo-body">Pending orders, COD holds, Steadfast pickups, bKash confirmations. Every badge and icon is named after the workflow a merchant actually runs every morning.</p>
          </div>
          <div className="philo-card">
            <div className="philo-num">03</div>
            <h3 className="philo-title">Soft confidence, zero sloppy</h3>
            <p className="philo-body">Purple as a signal of craft. Teal as a signal of trust. Radii generous enough to feel friendly, type tight enough to feel sharp.</p>
          </div>
          <div className="philo-card">
            <div className="philo-num">04</div>
            <h3 className="philo-title">Built for 3G, not fiber</h3>
            <p className="philo-body">Weights tuned for slow networks. Low-data states, skeleton loaders, and icon-first labels so a merchant on a spotty connection can still run their store.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">The stack</h2>
            <p className="section-sub">What powers every pixel in the system.</p>
          </div>
        </div>
        <div className="stack-grid">
          <div className="stack-card">
            <div className="stack-icon">
              <Icon name="type" size={18} />
            </div>
            <div className="stack-title">Typography</div>
            <div className="stack-sub">Space Grotesk · Inter · Hind Siliguri · JetBrains Mono</div>
          </div>
          <div className="stack-card">
            <div className="stack-icon" style={{ background: "var(--grad-purple-teal)" }}>
              <Icon name="palette" size={18} />
            </div>
            <div className="stack-title">Color</div>
            <div className="stack-sub">Purple ramp · 6 accents · 6 brand partners</div>
          </div>
          <div className="stack-card">
            <div className="stack-icon" style={{ background: "linear-gradient(135deg,#f97316,#eab308)" }}>
              <Icon name="layers" size={18} />
            </div>
            <div className="stack-title">Elevation</div>
            <div className="stack-sub">5 shadow levels + glow for focus</div>
          </div>
          <div className="stack-card">
            <div className="stack-icon" style={{ background: "var(--teal)" }}>
              <Icon name="grid" size={18} />
            </div>
            <div className="stack-title">Spacing</div>
            <div className="stack-sub">4px base · 8 steps · 6 radii</div>
          </div>
          <div className="stack-card">
            <div className="stack-icon" style={{ background: "var(--tangerine)" }}>
              <Icon name="zap" size={18} />
            </div>
            <div className="stack-title">Motion</div>
            <div className="stack-sub">160ms / 240ms / 400ms · cubic spring</div>
          </div>
          <div className="stack-card">
            <div className="stack-icon" style={{ background: "var(--info)" }}>
              <Icon name="moon" size={18} />
            </div>
            <div className="stack-title">Theming</div>
            <div className="stack-sub">Light · Dark · Auto · bi-lingual toggle</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Built for the Bangladesh commerce stack</h2>
            <p className="section-sub">First-class support for local payment and logistics partners.</p>
          </div>
        </div>
        <div className="partners-grid">
          <div className="partner-card">
            <div className="partner-label">Payment gateways</div>
            <div className="pill-row" style={{ border: "none", padding: 0, background: "transparent" }}>
              <span className="pay-pill" style={{ "--c": "#e2136e" } as React.CSSProperties}>
                <span className="pay-logo">bKash</span>
              </span>
              <span className="pay-pill" style={{ "--c": "#f36c21" } as React.CSSProperties}>
                <span className="pay-logo">Nagad</span>
              </span>
              <span className="pay-pill" style={{ "--c": "#004c8c" } as React.CSSProperties}>
                <span className="pay-logo">
                  SSL<span style={{ opacity: 0.6 }}>COMMERZ</span>
                </span>
              </span>
              <span className="pay-pill" style={{ "--c": "var(--ink-muted)" } as React.CSSProperties}>
                <Icon name="package" size={12} /> <span>COD</span>
              </span>
            </div>
          </div>
          <div className="partner-card">
            <div className="partner-label">Logistics couriers</div>
            <div className="pill-row" style={{ border: "none", padding: 0, background: "transparent" }}>
              <span className="courier-pill" style={{ "--c": "#0f766e" } as React.CSSProperties}>
                <span className="courier-dot" style={{ background: "#0f766e" }} />
                Steadfast
              </span>
              <span className="courier-pill" style={{ "--c": "#e11d48" } as React.CSSProperties}>
                <span className="courier-dot" style={{ background: "#e11d48" }} />
                Pathao
              </span>
              <span className="courier-pill" style={{ "--c": "#dc2626" } as React.CSSProperties}>
                <span className="courier-dot" style={{ background: "#dc2626" }} />
                RedX
              </span>
              <span className="courier-pill" style={{ "--c": "#f59e0b" } as React.CSSProperties}>
                <span className="courier-dot" style={{ background: "#f59e0b" }} />
                Carrybee
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">What&apos;s inside</h2>
            <p className="section-sub">Every page is live and interactive.</p>
          </div>
        </div>
        <div className="whats-inside">
          <Link className="inside-card" href="/design-system/foundations">
            <div className="inside-icon">
              <Icon name="palette" size={20} />
            </div>
            <h3 className="inside-title">Foundations</h3>
            <p className="inside-body">Color tokens, type ramp, spacing, radii, shadows, and the gradient palette that ties it all together.</p>
            <span className="inside-count">80+ tokens →</span>
          </Link>
          <Link className="inside-card" href="/design-system/components">
            <div className="inside-icon" style={{ background: "linear-gradient(135deg,#f97316,#eab308)" }}>
              <Icon name="grid" size={20} />
            </div>
            <h3 className="inside-title">Components</h3>
            <p className="inside-body">Buttons, inputs, badges, cards, tables, feedback — every state, every variant, every theme.</p>
            <span className="inside-count">120+ variants →</span>
          </Link>
          <Link className="inside-card" href="/design-system/patterns">
            <div className="inside-icon" style={{ background: "var(--teal)" }}>
              <Icon name="layers" size={20} />
            </div>
            <h3 className="inside-title">Patterns</h3>
            <p className="inside-body">A live merchant dashboard with interactive chart, the order lifecycle, and a Bangla-first showcase.</p>
            <span className="inside-count">3 live patterns →</span>
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Changelog</h2>
            <p className="section-sub">Every release shipped to production.</p>
          </div>
        </div>
        <div className="changelog">
          <div className="cl-row">
            <div className="cl-version mono">v1.0.0</div>
            <div className="cl-meta mono">20 Apr, 2026</div>
            <div className="cl-body">
              <b>Initial release.</b> 120+ components, 3 themes, Bangla-first typography, dashboard pattern.
            </div>
          </div>
          <div className="cl-row">
            <div className="cl-version mono">v0.9.4</div>
            <div className="cl-meta mono">14 Apr, 2026</div>
            <div className="cl-body">Payment &amp; courier pills finalized. Live chart tooltip. Confetti primitive added.</div>
          </div>
          <div className="cl-row">
            <div className="cl-version mono">v0.9.0</div>
            <div className="cl-meta mono">2 Apr, 2026</div>
            <div className="cl-body">Dark mode across all components. Drawer + modal animations. 48 new icons.</div>
          </div>
          <div className="cl-row">
            <div className="cl-version mono">v0.8.2</div>
            <div className="cl-meta mono">18 Mar, 2026</div>
            <div className="cl-body">Hind Siliguri weights 300–700. Bangla numeral formatter. Bilingual nav pattern.</div>
          </div>
        </div>
      </section>
    </DsShell>
  );
}
