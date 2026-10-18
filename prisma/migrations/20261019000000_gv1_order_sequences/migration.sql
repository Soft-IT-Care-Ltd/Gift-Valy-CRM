-- FUNNEL_LINER.md GV-1 / CLAUDE.md rule 6 — the order counter, THE billing
-- record: one row per Dhaka month, last_number = orders created that month.
-- This is the ONLY migration that may ever mention order_sequences (a test
-- enforces it): nothing lowers, resets, edits or deletes a row afterwards.

-- CreateTable
CREATE TABLE "order_sequences" (
    "year_month" VARCHAR(4) NOT NULL,
    "last_number" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("year_month")
);

-- Backfill (dev data only; production starts empty): one row per month from
-- the highest GV-YYMM-NNNN ever issued that month. The trash purge deletes
-- orders, so the live rows alone can under-count — the order.create and
-- purge audit rows still carry orderNo, so the highest of both wins and a
-- purged number is never issued again. Drafts (DRAFT-XXXX) are not orders yet.
INSERT INTO "order_sequences" ("year_month", "last_number", "updated_at")
SELECT substring(n FROM 4 FOR 4), max(substring(n FROM 9)::int), now()
FROM (
    SELECT "order_no" AS n FROM "orders"
    UNION ALL SELECT "after_json" ->> 'orderNo' FROM "audit_logs"
    UNION ALL SELECT "before_json" ->> 'orderNo' FROM "audit_logs"
) issued
WHERE n ~ '^GV-[0-9]{4}-[0-9]{4,}$'
GROUP BY 1
ON CONFLICT ("year_month") DO UPDATE
  SET "last_number" = GREATEST("order_sequences"."last_number", EXCLUDED."last_number");
