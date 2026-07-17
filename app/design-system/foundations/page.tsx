"use client";

import type { CSSProperties } from "react";
import { DsShell } from "../ds-shell";
import { FMT } from "../lib/format";

const ColorRamp = ({ name, tokens }: { name: string; tokens: [string, string][] }) => (
  <div className="ramp">
    <div className="ramp-label">{name}</div>
    <div className="ramp-row">
      {tokens.map(([k, v]) => (
        <div key={k} className="swatch" style={{ background: v }}>
          <div className="swatch-overlay">
            <div className="sw-k mono">{k}</div>
            <div className="sw-v mono">{v}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default function FoundationsPage() {
  return (
    <DsShell page="foundations" crumbs={["Design System", "Foundations"]}>
      <header className="page-header">
        <div className="page-eyebrow">Foundations</div>
        <h1 className="page-title">The tokens.</h1>
        <p className="page-lede">Color, type, spacing, radii, and shadows — the atomic decisions every component inherits.</p>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Brand purple</h2>
            <p className="section-sub">The core signal. 50 is for subtle backgrounds; 600 is the CTA; 900 for deep emphasis.</p>
          </div>
          <span className="section-tag">color/purple</span>
        </div>
        <ColorRamp
          name="Purple"
          tokens={[
            ["50", "#f5f3ff"],
            ["100", "#ede9fe"],
            ["200", "#ddd6fe"],
            ["300", "#c4b5fd"],
            ["400", "#a78bfa"],
            ["500", "#8b5cf6"],
            ["600", "#7c3aed"],
            ["700", "#6d28d9"],
            ["800", "#5b21b6"],
            ["900", "#4c1d95"],
          ]}
        />

        <div className="section-head" style={{ marginTop: 36 }}>
          <div>
            <h2 className="section-title">Accents</h2>
            <p className="section-sub">Teal for trust, lime for success, sun for warnings, tangerine for urgency.</p>
          </div>
        </div>
        <div className="accent-grid">
          <div className="accent-card" style={{ background: "#14b8a6" }}>
            <div>
              <b>Teal</b>
              <br />
              <span className="mono">#14b8a6</span>
            </div>
          </div>
          <div className="accent-card" style={{ background: "#84cc16" }}>
            <div>
              <b>Lime</b>
              <br />
              <span className="mono">#84cc16</span>
            </div>
          </div>
          <div className="accent-card" style={{ background: "#eab308", color: "#000" }}>
            <div>
              <b>Sun</b>
              <br />
              <span className="mono">#eab308</span>
            </div>
          </div>
          <div className="accent-card" style={{ background: "#f97316" }}>
            <div>
              <b>Tangerine</b>
              <br />
              <span className="mono">#f97316</span>
            </div>
          </div>
          <div className="accent-card" style={{ background: "#f43f5e" }}>
            <div>
              <b>Rose</b>
              <br />
              <span className="mono">#f43f5e</span>
            </div>
          </div>
          <div className="accent-card" style={{ background: "#0ea5e9" }}>
            <div>
              <b>Sky</b>
              <br />
              <span className="mono">#0ea5e9</span>
            </div>
          </div>
        </div>

        <div className="section-head" style={{ marginTop: 36 }}>
          <div>
            <h2 className="section-title">Payment &amp; courier brands</h2>
            <p className="section-sub">Adopted exactly from source brands for trust and recognition.</p>
          </div>
        </div>
        <div className="brand-grid">
          <div className="brand-card" style={{ "--c": "#e2136e" } as CSSProperties}>
            <div className="brand-sw" />
            <b>bKash</b>
            <span className="mono">#e2136e</span>
          </div>
          <div className="brand-card" style={{ "--c": "#f36c21" } as CSSProperties}>
            <div className="brand-sw" />
            <b>Nagad</b>
            <span className="mono">#f36c21</span>
          </div>
          <div className="brand-card" style={{ "--c": "#004c8c" } as CSSProperties}>
            <div className="brand-sw" />
            <b>SSLCommerz</b>
            <span className="mono">#004c8c</span>
          </div>
          <div className="brand-card" style={{ "--c": "#0f766e" } as CSSProperties}>
            <div className="brand-sw" style={{ backgroundColor: "rgb(0, 60, 55)" }} />
            <b>Steadfast</b>
            <span className="mono">#0f766e</span>
          </div>
          <div className="brand-card" style={{ "--c": "#e11d48" } as CSSProperties}>
            <div className="brand-sw" />
            <b>Pathao</b>
            <span className="mono">#e11d48</span>
          </div>
          <div className="brand-card" style={{ "--c": "#dc2626" } as CSSProperties}>
            <div className="brand-sw" />
            <b>RedX</b>
            <span className="mono">#dc2626</span>
          </div>
        </div>

        <div className="section-head" style={{ marginTop: 36 }}>
          <div>
            <h2 className="section-title">Gradients</h2>
            <p className="section-sub">Purple→teal is our signature. Used sparingly: hero CTAs, AI surfaces, plan upgrades.</p>
          </div>
        </div>
        <div className="grad-grid">
          <div className="grad-card" style={{ background: "linear-gradient(135deg,#7c3aed,#14b8a6)" }}>
            <b>Signature</b>
            <span>purple → teal</span>
          </div>
          <div className="grad-card" style={{ background: "linear-gradient(135deg,#f97316,#eab308)" }}>
            <b>Sunset</b>
            <span>tangerine → sun</span>
          </div>
          <div className="grad-card" style={{ background: "linear-gradient(135deg,#f5f3ff,#ecfeff)", color: "var(--ink)" }}>
            <b>Brand soft</b>
            <span>Backgrounds</span>
          </div>
          <div className="grad-card" style={{ background: "linear-gradient(135deg,#f97316,#eab308,#84cc16,#14b8a6,#7c3aed)" }}>
            <b>Spectrum</b>
            <span>Pro plan badge</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Typography</h2>
            <p className="section-sub">Space Grotesk for display, Inter for UI, Hind Siliguri for Bangla, JetBrains Mono for numbers.</p>
          </div>
          <span className="section-tag">type/ramp</span>
        </div>
        <div className="type-ramp">
          <div className="type-row">
            <div className="type-label">
              <b>Display XL</b>
              <span className="mono">64 / 800 / -3%</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 64, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>Commerce built for Bangladesh</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Display L</b>
              <span className="mono">44 / 800</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.05 }}>Every merchant, every morning</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Heading 1</b>
              <span className="mono">32 / 700</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>Order fulfilled in 60 seconds</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Heading 2</b>
              <span className="mono">22 / 700</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>Payment &amp; courier integrations</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Body L</b>
              <span className="mono">17 / 400</span>
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ink-muted)" }}>A design system crafted for Bangladeshi merchants.</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Body</b>
              <span className="mono">14 / 400</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>From bKash to Steadfast, every component is forged for the realities of local commerce.</div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Mono</b>
              <span className="mono">13 / 500</span>
            </div>
            <div className="mono" style={{ fontSize: 13 }}>
              {FMT.money(124500)} · #SC-00847 · {FMT.phone("1712345678")}
            </div>
          </div>
          <div className="type-row">
            <div className="type-label">
              <b>Bangla</b>
              <span className="mono">17 / 500</span>
            </div>
            <div className="bangla" style={{ fontSize: 17, fontWeight: 500 }}>
              বাংলাদেশী উদ্যোক্তার পাশে, প্রতিদিন।
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Spacing &amp; radii</h2>
            <p className="section-sub">4px base. Generous radii for friendly surfaces.</p>
          </div>
          <span className="section-tag">space/radii</span>
        </div>
        <div className="space-grid">
          <div>
            <div className="sub-label">Spacing scale</div>
            <div className="space-stack">
              {([[4, "xs"], [8, "sm"], [12, "md"], [16, "base"], [24, "lg"], [32, "xl"], [48, "2xl"], [64, "3xl"]] as [number, string][]).map(([s, n]) => (
                <div key={s} className="space-row">
                  <div>
                    <b>{n}</b> · <span className="mono">{s}px</span>
                  </div>
                  <div className="space-bar" style={{ width: s * 2 }} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="sub-label">Radii</div>
            <div className="radii-row">
              {([[4, "xs"], [6, "sm"], [10, "md"], [14, "lg"], [20, "xl"], [28, "2xl"]] as [number, string][]).map(([r, n]) => (
                <div key={r} className="radii-cell">
                  <div style={{ width: 68, height: 68, borderRadius: r, background: "var(--grad-purple-teal)" }} />
                  <div>
                    <b>{n}</b>
                    <br />
                    <span className="mono">{r}px</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Shadows</h2>
            <p className="section-sub">Five levels. Glow is reserved for focus and hover-pop emphasis.</p>
          </div>
          <span className="section-tag">elevation</span>
        </div>
        <div className="shadow-grid">
          {([["xs", "var(--shadow-xs)"], ["sm", "var(--shadow-sm)"], ["md", "var(--shadow-md)"], ["soft", "var(--shadow-soft)"], ["pop", "var(--shadow-pop)"]] as [string, string][]).map(([n, v]) => (
            <div key={n} className="shadow-card" style={{ boxShadow: v }}>
              <b>{n}</b>
              <span className="mono">--shadow-{n}</span>
            </div>
          ))}
          <div className="shadow-card" style={{ boxShadow: "var(--shadow-glow)", borderColor: "var(--purple-300)" }}>
            <b>glow</b>
            <span className="mono">--shadow-glow</span>
          </div>
        </div>
      </section>
    </DsShell>
  );
}
