"use client";

import { DsShell } from "../ds-shell";
import { DashboardMock, OrderLifecycle } from "../patterns-parts";

export default function MerchantDashboardPage() {
  return (
    <DsShell page="dashboard" crumbs={["Design System", "In Context", "Merchant Dashboard"]}>
      <header className="page-header">
        <div className="page-eyebrow">In Context · Live</div>
        <h1 className="page-title">Merchant dashboard.</h1>
        <p className="page-lede">A full merchant screen assembled entirely from the design system — stat cards, an interactive revenue chart, action queues, and the order lifecycle. Click <b>Add product</b> or <b>Confirm</b> for a little celebration.</p>
      </header>
      <DashboardMock />
      <OrderLifecycle />
    </DsShell>
  );
}
