import { applySettingsPush } from "./settings-push";
import {
  PLATFORM_BILLING_KEY,
  parseStoredBilling,
  type BillingSnapshot,
} from "./state-shape";
import type { Db } from "./tx";

// FUNNEL_LINER.md GV-4 — the billing snapshot Funnel Liner pushes (plan,
// last ≤12 invoices, how to pay), stored whole under one settings key and
// replaced by each newer push. The Billing page (GV-8) reads it; amounts never
// leave through any API without billing.view.

export const PLATFORM_BILLING_AUDIT_ACTION = "platform.billing";

export async function readBillingSnapshot(db: Db): Promise<BillingSnapshot | null> {
  const row = await db.setting.findUnique({ where: { key: PLATFORM_BILLING_KEY } });
  return parseStoredBilling(row?.value);
}

/** Store a snapshot. An older sentAt is ignored: { applied: false }. */
export async function applyBillingSnapshot(
  db: Db,
  snapshot: BillingSnapshot
): Promise<{ applied: boolean }> {
  const { applied } = await applySettingsPush<BillingSnapshot>(db, {
    key: PLATFORM_BILLING_KEY,
    action: PLATFORM_BILLING_AUDIT_ACTION,
    pushSentAt: snapshot.sentAt,
    parse: parseStoredBilling,
    build: () => ({ ...snapshot, sentAt: new Date(snapshot.sentAt).toISOString() }),
  });
  return { applied };
}
