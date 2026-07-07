# Gift Valy ERP — Claude Code Instructions

## Source of truth
Read `GIFT_VALY_SOFTWARE_SPEC.md` before any work. It defines every module, field, business rule, DB table, and the phased build plan. Never invent fields or flows that contradict it.

## Stack (fixed)
Next.js (App Router, TypeScript) · PostgreSQL + Prisma · NextAuth credentials + RBAC · Tailwind + shadcn/ui · Recharts · PDF invoices with Bangla font support (Noto Sans Bengali).

## Non-negotiable rules
1. **Field-level security:** Sales Executives must never receive cost/profit fields in any API response — strip in the service layer, not just the UI.
2. **Money integrity:** `due_amount` recomputed on every payment write; `transaction_id` unique; stock cache + `stock_movements` in one transaction; `unit_cost_snapshot` frozen at PACKED.
3. **Audit log** every sensitive mutation (order edit/cancel, stock adjust, payment edit).
4. All money is BDT `DECIMAL(12,2)`. Timezone: Asia/Dhaka.
5. Every order stores TWO phone numbers: customer (foreign) + recipient (Bangladesh).

## Build order
Follow the Phase 1 → 4 plan in SPEC §16. Ship vertical slices; seed demo data; test each role's login scope before marking a phase done.
