-- FUNNEL_LINER.md GV-8 — who sees the Funnel Liner bill: Admin and Accounts.
-- Admin holds every permission automatically (lib/rbac.ts); Accounts gets it
-- here so existing databases match the seed matrix (lib/permissions.ts).
INSERT INTO "permissions" ("key")
VALUES ('billing.view')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE r."name" = 'Accounts' AND p."key" = 'billing.view'
ON CONFLICT DO NOTHING;
