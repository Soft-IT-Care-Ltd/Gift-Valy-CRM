-- FUNNEL_LINER.md GV-5 — a staff phone becomes a sign-in identifier, so it is
-- stored in one form and is unique among users.

-- 1. Normalise every stored phone exactly as lib/user-phone.ts does:
--    BD mobile in any spelling → 01XXXXXXXXX; other 8–15 digit numbers →
--    +<digits>; anything else (not a phone) → NULL.
WITH d AS (
  SELECT id,
         CASE WHEN regexp_replace(phone, '\D', '', 'g') LIKE '00%'
              THEN substr(regexp_replace(phone, '\D', '', 'g'), 3)
              ELSE regexp_replace(phone, '\D', '', 'g') END AS digits
    FROM "users"
   WHERE phone IS NOT NULL
), n AS (
  SELECT id, digits,
         CASE WHEN digits LIKE '880%' THEN substr(digits, 3) ELSE digits END AS bd
    FROM d
)
UPDATE "users" u
   SET phone = CASE
         WHEN n.bd ~ '^01[3-9][0-9]{8}$' THEN n.bd
         WHEN n.digits LIKE '0%' THEN NULL
         WHEN length(n.digits) BETWEEN 8 AND 15 THEN '+' || n.digits
         ELSE NULL
       END
  FROM n
 WHERE u.id = n.id;

-- 2. Duplicates (owner, 18 Oct 2026): the oldest active user keeps the phone;
--    every other holder is set to NULL. (Dev had no phones; production starts empty.)
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY phone ORDER BY is_active DESC, created_at, id) AS rn
    FROM "users"
   WHERE phone IS NOT NULL
)
UPDATE "users" u SET phone = NULL FROM ranked r WHERE u.id = r.id AND r.rn > 1;

-- 3. CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
