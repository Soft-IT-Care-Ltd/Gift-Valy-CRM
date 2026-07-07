# Gift Valy — Business Management Software

ERP/CRM for Gift Valy, built against [GIFT_VALY_SOFTWARE_SPEC.md](./GIFT_VALY_SOFTWARE_SPEC.md).

**Stack:** Next.js (App Router, TypeScript) · PostgreSQL (Neon) + Prisma · NextAuth (credentials) + RBAC · Tailwind + shadcn/ui

## Build status (SPEC §16 Phase 1)

- [x] 1. Scaffold: Next.js + Prisma + Postgres + auth + RBAC (roles/permissions seed)
- [x] 2. Users/Teams CRUD (Admin) — incl. permission matrix UI, per-user overrides, audit log
- [ ] 3. Product, category, package + BOM CRUD
- [ ] 4. Customer + Order entry
- [ ] 5. Payments on order
- [ ] 6. Invoice PDF
- [ ] 7. SE "my orders / my sales today" view

## Run locally

Requirements: Node 20+ and npm.

```bash
npm install

# 1. Environment — .env is already set up for the Neon database.
#    If starting fresh, copy .env.example to .env and fill in:
#    DATABASE_URL  (Neon pooled URL), DIRECT_URL (same URL without "-pooler"),
#    NEXTAUTH_SECRET (openssl rand -base64 32), NEXTAUTH_URL=http://localhost:3000

# 2. Apply migrations + seed (idempotent, safe to re-run)
npx prisma migrate dev
npx prisma db seed

# 3. Start
npm run dev
```

Open http://localhost:3000 — you'll be redirected to the login page.

## Demo logins

| Role | Email | Password |
|---|---|---|
| Admin / Owner | `mh.neshad39@gmail.com` | `Admin@GV2026` |
| Sales Executive | `sanjoy@giftvaly.com` | `Sales@GV2026` |
| Sales Executive | `partho@giftvaly.com` | `Sales@GV2026` |

Both Sales Executives belong to **Team Alpha**.

## Testing each role

**Admin** — log in as the admin. You get the *Admin* sidebar section:
- **Users** — create/edit/deactivate users, assign role + team, reset passwords, and set per-user permission overrides (Inherit / Allow / Deny beats the role matrix).
- **Teams** — create teams, pick a leader.
- **Roles & Permissions** — the SPEC §2 matrix, editable per role. The Admin column is locked (Admin always has everything).
- **Audit Log** — every sensitive mutation with before/after values (Asia/Dhaka time).

**Sales Executive** — log in as Sanjoy or Partho:
- No Admin section in the sidebar; the dashboard lists only SE-scope access (own leads/orders, invoice, advance entry, own reports/target/attendance).
- Enforcement is server-side: as an SE, `/admin/users` redirects to `/` and `GET /api/users` returns **403**.

**Manager / Team Leader / Packing / Accounts** — the roles are seeded with their SPEC §2 permission sets; no demo users yet. To test one: log in as Admin → Users → **New user** → pick the role (e.g. Team Leader "Sakib", team leader of Team Alpha via Teams page). New users must change their password on first login — you'll be forced to the change-password screen, then sign in again.

Notes on RBAC behavior:
- Permission checks hit the database on every API request, so matrix/override edits apply immediately — no re-login needed.
- Deactivating a user blocks their login and kicks them out on next page load (soft delete — history preserved).
- Manager deliberately does **not** have `reports.pnl` seeded (SPEC: "can see P&L if Admin enables") — grant it from the matrix UI or as a per-user override.

## Project layout

```
prisma/schema.prisma      Auth & org tables (users, roles, permissions,
                          role_permissions, user_permission_overrides, teams, audit_logs)
prisma/seed.ts            Roles + SPEC §2 matrix + demo users
lib/permissions.ts        Permission catalog + seed matrix (single source of truth)
lib/rbac.ts               Effective-permission resolution (role → overrides, Admin bypass)
lib/auth.ts               NextAuth credentials config (JWT sessions)
lib/authz.ts              API guards: requireUser / requirePermission
lib/audit.ts              Audit log writer
app/(dashboard)/          Signed-in shell + admin pages
app/api/                  users, teams, roles, account APIs
```
