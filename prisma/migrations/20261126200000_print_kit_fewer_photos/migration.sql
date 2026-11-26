-- Photo print: a kit's photo count is now the frame's MAXIMUM, not a
-- requirement (lib/print-kit.ts kitProgress) — one photo plus every card makes
-- a kit READY. Kits already waiting with fewer photos than the frame holds
-- move to READY now; later changes go through refreshKit as before.
-- Data only, no schema change.
UPDATE "order_print_kits" k
SET "status" = 'READY', "updated_at" = CURRENT_TIMESTAMP
WHERE k."status" = 'PENDING'
  AND k."photo_count" >= 1
  AND k."card_count" >= (
    SELECT count(DISTINCT c)
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(k."spec_snapshot" -> 'cards') = 'array'
           THEN k."spec_snapshot" -> 'cards' ELSE '[]'::jsonb END
    ) AS c
    WHERE c IN ('CARD_1', 'CARD_2')
  );
