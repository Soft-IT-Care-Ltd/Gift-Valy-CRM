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
6. **`order_sequences` is the billing record** (FUNNEL_LINER.md). The number of orders created in a Dhaka month is `order_sequences.lastNumber` for that month — the same counter that produces `GV-YYMM-NNNN`. Therefore:
   - every code path that gives an order its `GV-` number calls `generateOrderNumber(tx)` **inside the same transaction** — no order ever gets a hand-made or "last row + 1" number;
   - nothing ever lowers, resets, edits or deletes an `order_sequences` row — not a migration, not a script, not the trash purge, not a "fix";
   - the demo seed is never run on production (it creates orders and moves the counter); production is bootstrapped with `npm run db:bootstrap` (roles + first Admin, no orders);
   - **no test order is ever made on production** — testing happens on staging (`gv-staging.funnelliner.com`, database `giftvaly_staging`).

   Why the counter and not `COUNT(*)` on `orders`: the nightly trash purge **deletes** orders after 30 days, so a row count would shrink, and today's `nextOrderNo()` reads the last existing row, so a purged last order would let its number be issued again. The counter never goes down, and rolls back with a failed transaction, so it has no gaps.
7. **`/go/` and `/_c/` belong to the Funnel Liner proxy.** No page or route in this app starts with them. A test fails if one appears.
8. **Never aim a database-wiping command at a real database.** Never pass `DATABASE_URL` or `DIRECT_URL` to `prisma migrate reset`, `prisma db push --force-reset`, `prisma migrate diff --shadow-database-url`, `DROP SCHEMA`/`DROP DATABASE` or anything like them. The shadow database is **only** `SHADOW_DATABASE_URL` (`giftvaly_shadow`). **Any destructive database command needs the owner's explicit OK first — even on dev.**
9. **Never hardcode a host name.** People's links use `NEXTAUTH_URL` (`https://dashboard.funnelliner.com`); machine callbacks use `INSTANCE_URL` (`https://dashboard.funnelliner.com/_c/giftvaly`).

## Build order
Follow the Phase 1 → 4 plan in SPEC §16. Ship vertical slices; seed demo data; test each role's login scope before marking a phase done.
