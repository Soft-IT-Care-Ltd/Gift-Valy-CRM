"use client";

import { DsShell } from "../ds-shell";
import { BanglaSection } from "../patterns-parts";

export default function BanglaTypePage() {
  return (
    <DsShell page="bangla" crumbs={["Design System", "In Context", "Bangla Type"]}>
      <header className="page-header">
        <div className="page-eyebrow">In Context · বাংলা</div>
        <h1 className="page-title">Bangla-first, by design.</h1>
        <p className="page-lede">Hind Siliguri sits beside Inter as a first-class typeface. Numerals, currency, and bilingual pairings are built into the tokens — never patched in later.</p>
      </header>
      <BanglaSection />
    </DsShell>
  );
}
