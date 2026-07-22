-- CORRECTIONS Round 2 §2.7 — COD payout justification + auto-COMPLETE engine.
-- Per-consignment reconcile verdict on steadfast_payment_items: our expected
-- net receivable vs Steadfast's paid figures; mismatches go to a discrepancy
-- list resolved by Admin/Accounts (accept with a reason, or dispute).

CREATE TYPE "steadfast_reconcile_status" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH', 'ACCEPTED', 'DISPUTED');

ALTER TABLE "steadfast_payment_items"
  ADD COLUMN "reconcile_status" "steadfast_reconcile_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "expected_net" DECIMAL(12,2),
  ADD COLUMN "paid_net" DECIMAL(12,2),
  ADD COLUMN "resolved_by" INTEGER,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolve_note" TEXT;

CREATE INDEX "steadfast_payment_items_reconcile_status_idx" ON "steadfast_payment_items"("reconcile_status");
