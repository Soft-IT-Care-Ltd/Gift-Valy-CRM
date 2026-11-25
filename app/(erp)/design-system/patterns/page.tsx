"use client";

import { DsShell } from "../ds-shell";
import { DashboardMock, OrderLifecycle, BanglaSection } from "../patterns-parts";

export default function PatternsPage() {
  return (
    <DsShell page="patterns" crumbs={["Design System", "Patterns"]}>
      <header className="page-header">
        <div className="page-eyebrow">Patterns</div>
        <h1 className="page-title">Components in context.</h1>
        <p className="page-lede">How the system composes into real merchant screens — a live dashboard, the order lifecycle, and a Bangla-first showcase.</p>
      </header>
      <DashboardMock />
      <OrderLifecycle />
      <BanglaSection />
    </DsShell>
  );
}
