-- CORRECTIONS Orders §R5 — manual courier status overrides (correct a shipment
-- status by hand when Steadfast is wrong) + trash an order from ANY status.
-- Seed the permission row only: the RBAC layer grants Admin every existing
-- permission automatically (lib/rbac.ts), so this stays Admin-only until it is
-- explicitly granted to another role or user from the matrix UI.
INSERT INTO "permissions" ("key")
VALUES ('orders.courier_override')
ON CONFLICT ("key") DO NOTHING;
