# Gift Valy — Funnel Liner client: connector, billing and go-live

**Raised by:** the owner, 18 Oct 2026. **Goes in:** the root of the Gift Valy CRM repo, next to `CORRECTIONS.md`.

Gift Valy becomes Funnel Liner's **second client**, after Antu Boutique. Same model as Antu: Gift Valy's ERP stays its own app with its own database, it runs on the Antu server, staff sign in at **`dashboard.funnelliner.com`**, and the Funnel Liner admin panel (`admin.funnelliner.com`) bills it every month exactly like every other client.

> **কীভাবে ব্যবহার করবেন:** নিচের "Build order" এ প্রতিটা prompt আলাদা code block এ আছে। প্রতিটা prompt এর উপরে লেখা আছে **কোন repo তে** চালাতে হবে। একটা prompt Claude Code এ paste করুন → কাজ শেষ হলে → `/clear` → পরেরটা। ক্রম বদলাবেন না। কোনো prompt যদি আগে কিছু দেখাতে বলে ("show me…"), সেটা পড়ে OK দিলে তবেই সে build করবে।

How to use this file (for Claude Code):
- The **Build order** section has the prompts. Each one names the repo it runs in.
- Each prompt points at **items** below. The items are the spec.
- When an item is built, mark it `[DONE]` with a one-line note and the commit.
- **Read "Changes to existing rules" before the first prompt.**
- **The reference implementation is Antu Boutique** (`Soft-IT-Care-Ltd/Antu-Boutique-CRM`): its `FUNNEL_LINER.md` (FL1, FL2), `lib/platform/`, `proxy.ts`, `deploy/`, `scripts/deploy.sh`, `scripts/backup.sh`, `DEPLOYMENT.md`, `docs/BACKUPS.md`. Read it, follow the same shape, but **copy nothing that doesn't fit Gift Valy's code** — Gift Valy has its own auth (`lib/auth.ts`, NextAuth v4), its own audit log (`lib/audit.ts`), its own settings table (`lib/settings.ts`) and its own permissions (`lib/permissions.ts`, `lib/rbac.ts`).

---

## Decisions made by the owner (18 Oct 2026)

| Question | Decision |
|---|---|
| Is Gift Valy a Funnel Liner client? | **Yes, billed as usual** — the fixed monthly fee plus the order fee by band, the bill on the 1st, due by the 7th, suspended on the 8th if unpaid. The amounts live in the admin panel, not here. |
| Where does the ERP live? | **`dashboard.funnelliner.com`**, the one address shared by every Funnel Liner client. No per-client subdomain. |
| Which server? | **The Antu Boutique server** — its own app, database, port, backups and cron, next to Antu and the admin panel. |
| The old server (`app.giftvaly.com`, 144.79.124.98) | **Nothing is carried over.** It never held real data. Gift Valy starts on the new server with an empty database (roles + the first Admin only). |
| Which orders count? | **Every order that is created**, including ones later cancelled, put on hold or trashed — the same rule as every client. |
| Website | Gift Valy has no public website. Only the ERP. |

## Defaults assumed (owner can change any of these)

- **Shop code:** `giftvaly`. Machine address on the server: `http://localhost:3200`. Staff never see it.
- **Drafts:** a draft (`DRAFT-XXXX`) is not an order yet. It is counted **the moment it gets its real `GV-YYMM-NNNN` number** (at confirm). A draft deleted without being confirmed is never counted. This keeps "the billed number = the number in the month's last order number" true, which is how the admin panel checks it.
- **Ports and names on the server:** production PM2 `giftvaly` on `localhost:3200`, folder `/srv/giftvaly`, database `giftvaly`; staging PM2 `giftvaly-staging` on `localhost:3210`, folder `/srv/giftvaly-staging`, database `giftvaly_staging`, address **`gv-staging.funnelliner.com`** behind basic auth; shadow database `giftvaly_shadow`. (Antu uses 3000/3100, the admin panel 3300/3310.)
- **Who sees the bill:** Admin and Accounts (new permission `billing.view`). Everyone else, while suspended, sees only the short "dashboard closed" message, no amounts.
- **Sign-in by phone:** Gift Valy signs in by email today. Like Antu, it will accept **phone number or email**. A user's phone must be unique among users.
- **`app.giftvaly.com`:** a permanent redirect to `https://dashboard.funnelliner.com`, so old bookmarks and installed PWAs land in the right place. The old VPS can then be cancelled.

---

## How one address serves every client

Each client's ERP is its own app with its own database. They share one address because Nginx on the server sits in front of all of them:

- **People** open `dashboard.funnelliner.com` and sign in with **phone (or email) and password**. Nobody types a shop. The first time on a device, the **shared sign-in page** (`/go/`, built in the Funnel Liner admin panel — prompt A7) asks every client's system "is this number yours?" (`/api/platform/has-user`), sends the person to the right shop's own sign-in page with the number filled in, and **remembers the shop on that device** (a cookie). After that, every request from that device goes straight to that shop's app.
- **The password is only ever typed on, and checked by, the client's own sign-in page.** Funnel Liner never sees it.
- **Machines** (the Steadfast webhook, cron, the admin panel) carry no cookie, so they use an address with the shop code: `https://dashboard.funnelliner.com/_c/giftvaly/...`. Nginx strips `/_c/giftvaly` and passes the rest to Gift Valy. On the server itself, the admin panel and cron call `http://localhost:3200` directly.
- One browser is in **one shop at a time**. The link "Not your shop? Sign in with another number" (`/go/switch`) forgets the remembered shop.
- **`/go/` and `/_c/` belong to the proxy.** No route in this app may ever start with them.

---

## Changes to existing rules — read before the first prompt

None of the existing rules in `CLAUDE.md` changes. These are **added** to `CLAUDE.md` (in the same commit as GV1):

> **6. `order_sequences` is the billing record.** The number of orders created in a Dhaka month is `order_sequences.lastNumber` for that month — the same counter that produces `GV-YYMM-NNNN`. Therefore:
> - every code path that gives an order its `GV-` number calls `generateOrderNumber(tx)` **inside the same transaction** — no order ever gets a hand-made or "last row + 1" number;
> - nothing ever lowers, resets, edits or deletes an `order_sequences` row — not a migration, not a script, not the trash purge, not a "fix";
> - the demo seed is never run on production (it creates orders and moves the counter); production is bootstrapped with `npm run db:bootstrap` (roles + first Admin, no orders);
> - **no test order is ever made on production** — testing happens on staging (`gv-staging.funnelliner.com`, database `giftvaly_staging`).
>
> Why the counter and not `COUNT(*)` on `orders`: the nightly trash purge **deletes** orders after 30 days, so a row count would shrink, and today's `nextOrderNo()` reads the last existing row, so a purged last order would let its number be issued again. The counter never goes down, and rolls back with a failed transaction, so it has no gaps.
>
> **7. `/go/` and `/_c/` belong to the Funnel Liner proxy.** No page or route in this app starts with them. A test fails if one appears.
>
> **8. Never aim a database-wiping command at a real database.** Never pass `DATABASE_URL` or `DIRECT_URL` to `prisma migrate reset`, `prisma db push --force-reset`, `prisma migrate diff --shadow-database-url`, `DROP SCHEMA`/`DROP DATABASE` or anything like them. The shadow database is **only** `SHADOW_DATABASE_URL` (`giftvaly_shadow`). **Any destructive database command needs the owner's explicit OK first — even on dev.**
>
> **9. Never hardcode a host name.** People's links use `NEXTAUTH_URL` (`https://dashboard.funnelliner.com`); machine callbacks use `INSTANCE_URL` (`https://dashboard.funnelliner.com/_c/giftvaly`).

---

## Build order

| # | Prompt | Runs in | Needs |
|---|---|---|---|
| 1 | GV0 — Read the reference | Gift Valy repo | — |
| 2 | GV1 — Order counter | Gift Valy repo | GV0 |
| 3 | GV2 — Connector routes, addresses, phone sign-in | Gift Valy repo | GV1 |
| 4 | GV3 — Billing lock, Billing page, reminders | Gift Valy repo | GV2 |
| 5 | Verify GV | Gift Valy repo | GV3 |
| 6 | GV4 — Ready for the server (uploads, cron, deploy files, DEPLOYMENT.md) | Gift Valy repo | Verify GV |
| 7 | A7 — Shared sign-in page | **Funnel Liner Admin repo** | can run alongside 2–6 |
| 8 | GV-N — Nginx for two shops on `dashboard.funnelliner.com` | **Antu Boutique repo** | A7 |
| 9 | GV5 — Staging, month test, then production | Gift Valy repo (on the server via `ssh antu`) | 6, 7, 8 |

---

### GV0 — Read the reference (Gift Valy repo)

```
Read FUNNEL_LINER.md in this repo fully, then CLAUDE.md and AGENTS.md (this Next.js version differs from your training data — read node_modules/next/dist/docs/ before writing proxy or routing code).

Clone the reference implementation read-only, outside this repo: git clone --depth 1 git@github.com:Soft-IT-Care-Ltd/Antu-Boutique-CRM.git ../antu-reference (if it already exists, git -C ../antu-reference pull). Read its FUNNEL_LINER.md (FL1 and FL2), lib/platform/, proxy.ts, lib/auth/sign-in-user.ts, app/api/platform/, the Billing page, deploy/, scripts/deploy.sh, scripts/backup.sh, DEPLOYMENT.md and docs/BACKUPS.md.

Write nothing yet except this: add rules 6–9 from FUNNEL_LINER.md → "Changes to existing rules" to CLAUDE.md, and commit FUNNEL_LINER.md and CLAUDE.md ("docs: Funnel Liner client plan").

Then report back, in a short table, for each of GV1–GV4: which Antu files are the pattern, which Gift Valy files will change, and anything in Gift Valy's code that makes the Antu pattern not fit (auth, audit log actor, settings table, permissions, no proxy.ts yet, public/uploads, vercel.json crons, the seed). Don't build anything.
```

### GV1 — Order counter (Gift Valy repo)

```
Read FUNNEL_LINER.md → "Changes to existing rules" (rule 6) and item GV-1.

Before writing code, show me: (a) every place an order gets a GV- number today (I expect app/api/orders/route.ts and confirmDraftTx in lib/orders.ts — find any others), (b) the migration you will write, including how existing months are backfilled, (c) how you will prove that no code path can create a GV number without the counter.

Then build GV-1. New migration via prisma migrate diff with SHADOW_DATABASE_URL only (rule 8) — never migrate reset or db push. Mark GV-1 [DONE], commit, push.
```

### GV2 — Connector routes, addresses, phone sign-in (Gift Valy repo)

```
Read FUNNEL_LINER.md → "How one address serves every client", "Changes to existing rules", then items GV-2 to GV-6. Re-read the Antu reference: lib/platform/, app/api/platform/, lib/auth/sign-in-user.ts and the Antu FUNNEL_LINER.md items F1, F2, F5, F6, F9.

Before writing code, show me: (a) how PLATFORM_SECRET is checked (same timing-safe way as CRON_SECRET in app/api/cron/*) and that it fails closed when unset; (b) which user the audit rows for "Funnel Liner" are written under, given audit_logs.user_id is required (lib/system-user.ts); (c) every place a full URL is built today and whether a person or a machine uses it; (d) how phone sign-in will match a phone number (normalisation) and how a duplicate phone is prevented.

Then build GV-2 (usage), GV-3 (state), GV-4 (billing snapshot), GV-5 (has-user + sign-in page + phone sign-in + session cookie name) and GV-6 (addresses). Add PLATFORM_SECRET, INSTANCE_URL and SHARED_SIGNIN to .env.example. Zod on every route, an audit row on every state or snapshot change. Tests for each route (401 cases included). Mark the items [DONE], commit, push.
```

### GV3 — Billing lock, Billing page, reminders (Gift Valy repo)

```
Read FUNNEL_LINER.md items GV-7 to GV-10. Re-read the Antu reference: proxy.ts, lib/platform/gate.ts, the Billing page and the reminder banner, and the Antu FUNNEL_LINER.md items F8, F10, F11, F12.

Gift Valy has no proxy.ts yet. Read node_modules/next/dist/docs/ for how proxy.ts works in this Next.js version before writing it.

Before writing code, show me: (a) the one place the lock is enforced, the full list of pages and API routes that stay open while suspended with the reason for each, and how a page or route added tomorrow is closed by default; (b) for every cron job, whether it runs while suspended and why; (c) where the billing snapshot is read from and how the Billing page shows it; (d) how the proxy avoids a database query on every request (the cached state helper from GV-3).

Then build GV-7 (billing lock), GV-8 (Billing page), GV-9 (reminders) and GV-10 (Settings card). Every message a locked-out person sees is in Bangla and English. Add billing.view to lib/permissions.ts for ADMIN and ACCOUNTS only. Mark the items [DONE], commit, push.
```

### Verify GV (Gift Valy repo)

```
Reviewer pass on GV1–GV3. Verify by reading code and testing against the dev database:
1. Create orders through every path in one month — a direct confirmed order, an ON_HOLD order (no advance), a draft later confirmed by a payment, a draft confirmed by a status change, a draft deleted without confirming. Cancel one, trash one and run the trash-cleanup cron on it with its date moved back 31 days. /api/platform/usage still reports every GV-numbered order, ordersCreated equals the number in the month's last GV number, and the deleted draft is not counted.
2. An order that fails to save inside the transaction (force a validation or stock error) does not move the counter. Two orders created at the same moment get two different numbers and the counter moves by two.
3. List every prisma order create and every place orderNo is written. Each GV number comes from generateOrderNumber in the same transaction.
4. All four platform routes answer 401 without the secret, with a wrong secret and with CRON_SECRET, and fail closed with PLATFORM_SECRET unset. None returns a customer or recipient name, phone, address, price, cost or payment.
5. Push "suspended": every dashboard page, for every role, lands on /billing; every ERP API route — GET and write, try one per module, plus a crafted request with a valid session and a CSV/PDF export — answers 423 with the lock message. Open: sign in, sign out, change own password, /billing and its data, the Steadfast webhook and sync, the platform routes, the PWA files. The trash cleanup does not delete anything while suspended.
6. Push "active": everything opens at once, with no restart and no sign-out.
7. Push "past_due" with dueOn = the 7th: Admin and Accounts see the banner on every page with the amount and the days left, the Admin gets one pop-up per Dhaka day; on the 7th it says "last day"; a Sales Executive, Team Leader and Packing see nothing.
8. POST /api/platform/billing with the §8 example body: the Billing page matches it to the taka; an older sentAt is ignored; a malformed body is refused; with no snapshot yet the page shows this month's count and "Your first bill will appear here on the 1st". No amount appears in any API response for a role without billing.view.
9. Every state and snapshot change has an audit_logs row whose afterJson says actor "Funnel Liner".
10. With NEXTAUTH_URL and INSTANCE_URL set to different values: the Steadfast callback URL on the Courier page and in Steadfast settings is the INSTANCE_URL one; no link, redirect or email for a person uses INSTANCE_URL.
11. No page or route starts with /go/ or /_c/ (the test exists and passes).
12. has-user answers found:true for exactly the people who can sign in — an active user by phone and by email, a deactivated user, an unknown number — with nothing but found, and never touches failed-login counters. /login?identifier=017… fills the box and focuses the password. Sign-in works by phone and by email. "Not your shop?" shows only when SHARED_SIGNIN=enabled.
13. The session cookie has Gift Valy's own name (GV-5), so it can never collide with another shop's cookie on dashboard.funnelliner.com.
14. Stop nothing else: with PLATFORM_SECRET set and nothing ever pushed, the ERP behaves exactly as before.
15. npm run build passes; every verify:* script still passes.
Report findings, fix them, commit, push.
```

### GV4 — Ready for the server (Gift Valy repo)

```
Read FUNNEL_LINER.md items GV-11 to GV-15, then the Antu reference's DEPLOYMENT.md, deploy/, scripts/deploy.sh, scripts/backup.sh and docs/BACKUPS.md, and the Funnel Liner Admin repo's way of adding a second app to the same server (its DEPLOYMENT.md: its own cron file in /etc/cron.d, its own PM2 app and port, its database in the same backup run). Clone it read-only next to the Antu one if needed: git clone --depth 1 git@github.com:Soft-IT-Care-Ltd/Funnel-Liner-Admin.git ../fl-admin-reference.

The server already exists and already runs Antu Boutique and the admin panel: Ubuntu 24.04, PostgreSQL 18, Node, PM2, Nginx, Cloudflare, certbot, rclone to Backblaze. Don't repeat any of that — Gift Valy adds only its own parts.

Before writing code, show me: (a) where uploads and invoice PDFs will live on the server and how they are served after the change; (b) the deploy/ files and scripts you will add; (c) the bootstrap script that replaces the demo seed on production.

Then build GV-11 (uploads and invoices outside the release), GV-12 (production bootstrap), GV-13 (cron and backups), GV-14 (deploy files and scripts) and GV-15 (DEPLOYMENT.md + GO_LIVE.md in Bangla). Remove vercel.json. Add tests that pin the deploy files (ports, hostnames, no /go/ or /_c/ route, cron calling localhost). Mark the items [DONE], commit, push.
```

### A7 and GV-N — in the Funnel Liner file

Prompts 7 (A7, Funnel Liner Admin repo) and 8 (GV-N, Antu Boutique repo) are in the separate file **`FUNNEL_LINER_PROMPTS_FOR_GIFT_VALY.md`**. Run them before GV5.

### GV5 — Staging, month test, then production (Gift Valy repo, on the server via `ssh antu`)

```
Read FUNNEL_LINER.md item GV-17 and this repo's DEPLOYMENT.md (written in GV4). The server is reached with ssh antu. Follow DEPLOYMENT.md step by step and stop at every point it marks "owner".

Part 1 — staging only. Create giftvaly_staging, its roles and gv-staging.funnelliner.com (basic auth, noindex), deploy main, run the full test suite on the server, bootstrap roles + one Admin, and add "Gift Valy (staging)" as a client in admin-staging (shop code giftvaly, machine address http://localhost:3210) — the owner pastes PLATFORM_SECRET into the client page from their own Terminal, never into this chat. Test connection must pass. Then run the month test from GV-17 with the admin panel's ?asOf= and report each step's result.

Stop after Part 1 and wait for my OK.

Part 2 — production, only after my OK. Create the giftvaly database and roles, the shared .env (the owner keeps a copy in the password manager), deploy, install the cron file and the backup lines, install the Antu repo's new Nginx block (GV-N) and the A7 snippet, reload Nginx, bootstrap roles + the owner's Admin account (no demo data, no test order — rule 6), set SHARED_SIGNIN=enabled in both Gift Valy's and Antu's production .env and reload both, then run the post-deploy checklist in GV-17. Tell me exactly what to set in Steadfast's panel and in the admin panel's client page. Mark GV-17 [DONE] with the date, commit, push.
```

---

## Items

### GV-1. The order counter — [OPEN]

- New table `order_sequences`: `yearMonth` (`"2610"`, primary key), `lastNumber` (int), `updatedAt`.
- `generateOrderNumber(tx)` in `lib/orders.ts`: one atomic statement per call — insert the Dhaka month's row with 1, or increment it, and return the new value (`INSERT … ON CONFLICT (year_month) DO UPDATE SET last_number = order_sequences.last_number + 1 RETURNING last_number`). Returns `GV-YYMM-NNNN` (at least 4 digits; 10,000+ grows to 5 — no wrap).
- Replace `nextOrderNo(tx, orderNoPrefix())` everywhere a GV number is given — today `app/api/orders/route.ts` and `confirmDraftTx` in `lib/orders.ts`. The retry-on-collision loop is no longer needed for GV numbers.
- **Drafts keep their own `DRAFT-XXXX` sequence and are not counted** (see "Defaults assumed"). A draft is counted when `confirmDraftTx` gives it its GV number.
- The migration backfills one row per month from the highest existing GV number of that month (dev data; production starts empty). It never lowers a row.
- Nothing ever lowers, resets, edits or deletes an `order_sequences` row (rule 6). The trash cleanup never touches it.
- The demo seed either numbers its orders through `generateOrderNumber` or refuses to run when `NODE_ENV=production` — both, preferably.
- A test lists every order create and every write of `orderNo` and fails if a GV number is produced any other way (Antu: `lib/orders/__tests__/order-creation-paths.test.ts`).

### GV-2. Usage endpoint — [OPEN]

`GET /api/platform/usage?from=YYMM&to=YYMM` — machine-to-machine, `Authorization: Bearer <PLATFORM_SECRET>`, no session. Both optional; default the current and the previous Dhaka month.

Per Dhaka month:

| Field | Meaning |
|---|---|
| `yearMonth` | `"2610"` |
| `ordersCreated` | `order_sequences.lastNumber` for that month. **This is the billed number.** `0` when the month has no row. |
| `lastOrderNo` | e.g. `GV-2610-0347` — the evidence a person can check. |
| `breakdown` | Information only, from rows that still exist: confirmed and later, on hold, cancelled, in trash, and drafts not yet confirmed. Never used for billing; may add up to less than `ordersCreated` after a purge. |

Plus once per response: `serverTime`, the app version and commit, the current platform state (name only).

- Read-only; counts and order numbers only — no customer, recipient, product, money or staff name.
- PLATFORM_SECRET is separate from CRON_SECRET and checked timing-safe (`lib/crypto.ts`); **fails closed when unset**. CRON_SECRET is refused here.
- Zod on the query.

### GV-3. State endpoint — [OPEN]

`POST /api/platform/state` — same authentication as GV-2.

- Body: `state` (`active` | `past_due` | `suspended`), `message` (optional), `amountDue` and `dueOn` (optional, for the banner), `sentAt`. Zod-validated.
- Stored in `settings` under `platform_state` (no new table), row locked, in one transaction with an `audit_logs` row: user = the system user (`lib/system-user.ts`), action `platform.state`, before/after, and `actor: "Funnel Liner"` in the JSON.
- A push older than the stored `sentAt` is ignored (answers `applied: false`), so a late retry can never undo a newer state.
- Read through one small cached helper (about 5 seconds), so a change applies at once without a restart and the proxy doesn't query the database on every request.
- Gift Valy never calls Funnel Liner. If nothing is ever pushed, the state is `active`.

### GV-4. Billing snapshot endpoint — [OPEN]

`POST /api/platform/billing` — same authentication as GV-2. Body: the billing snapshot from FUNNEL_LINER_ADMIN.md §8:

```json
{
  "sentAt": "2026-11-01T01:00:12+06:00",
  "plan": { "fixedFeePaisa": 290000, "freeUpTo": 20,
            "bands": [ {"upTo": 500, "feePaisa": 90000}, {"upTo": 1000, "feePaisa": 200000},
                       {"upTo": 1500, "feePaisa": 300000}, {"upTo": 2000, "feePaisa": 400000} ],
            "stepOrders": 500, "stepFeePaisa": 100000 },
  "invoices": [
    { "number": "FL-2611-0001", "period": "2610", "issuedOn": "2026-11-01", "dueOn": "2026-11-07",
      "ordersCreated": 347, "lastOrderNo": "GV-2610-0347",
      "lines": [ {"label": "Fixed fee", "amountPaisa": 290000}, {"label": "Order fee (21–500 orders)", "amountPaisa": 90000} ],
      "totalPaisa": 380000, "paidPaisa": 0, "duePaisa": 380000, "status": "issued" }
  ],
  "payTo": { "bkash": "01XXXXXXXXX", "bank": "…", "note": "Use the invoice number as the reference." }
}
```

- Zod-validated; amounts are integer paisa; at most 12 invoices.
- Stored whole in `settings` under `platform_billing`, replacing the last one; an older `sentAt` is ignored; audit row as in GV-3.
- Answers `{ "applied": true | false }` — the admin panel uses it as the acknowledgement.

### GV-5. "Is this number yours?", sign-in page, phone sign-in, cookie name — [OPEN]

- `POST /api/platform/has-user` — same authentication as GV-2. Body `identifier` (phone or email). Answer `{ "found": true | false }` and nothing else. `found` is true for exactly the people who could sign in right now — **one shared lookup used by both this route and `lib/auth.ts`** so they can never disagree. Read-only; never counts as a failed sign-in.
- **Phone sign-in:** the credentials provider accepts a phone number or an email in one `identifier` field. Phones are normalised the same way everywhere (e.g. `+8801…`, `8801…`, `01…` → one form); a migration adds a unique index on the normalised phone; the user form refuses a duplicate.
- **Sign-in page:** one box, placeholder `017XXXXXXXX or your email`. `/login?identifier=…` fills the box and puts the cursor in the password box. Below the form, "Not your shop? Sign in with another number" → `/go/switch`, shown **only** when `SHARED_SIGNIN` is exactly `enabled`. A wrong password shows the same message as today.
- **Session cookie name:** set NextAuth's cookie names to Gift Valy's own (e.g. `__Secure-gv.session-token`, and the CSRF and callback cookies likewise) so they never collide with another shop's on the shared host. Everyone signs in once more after the change — fine, production is new.

### GV-6. Public address and machine address — [OPEN]

- `NEXTAUTH_URL` = `https://dashboard.funnelliner.com` — sign-in and every link a person follows.
- `INSTANCE_URL` (new) = `https://dashboard.funnelliner.com/_c/giftvaly` — what machines use. Falls back to `NEXTAUTH_URL` when unset, so development is unchanged. One helper, `instanceUrl()`.
- **The Steadfast callback URL** is built from `INSTANCE_URL` — today it is built from `NEXTAUTH_URL` in `app/api/couriers/steadfast/settings/route.ts` and `app/(dashboard)/courier/page.tsx`.
- Search for every other place a full URL is built (WhatsApp invoice links, PDFs, redirects) and decide one by one whether a person or a machine uses it.
- No page or route starts with `/go/` or `/_c/` — add a test.

### GV-7. The billing lock — [OPEN]

While the state is `suspended`:

- **Pages:** every dashboard page, for every signed-in person, goes to `/billing`. Still reachable: `/billing`, `/login`, signing out, `/change-password`.
- **API routes:** every request is refused with **423** and the Bangla + English lock message — reads and exports too. Still open: `/api/auth/*`, change own password, the Billing page's own data, `/api/platform/*`, `/api/webhooks/steadfast`, `/api/cron/steadfast-sync`, the backup report (if GV-13 adds one), the PWA files (`/sw.js`, the manifest, icons, `offline.html`) and static assets.
- **One place:** a new `proxy.ts` (this Next.js version's name for middleware — read its docs first) calling one gate helper. **Closed by default:** the gate lists what stays open; anything else is closed, so a page or route added later is covered the day it is added. Machine routes (`/api/platform/*`, `/api/cron/*`, `/api/webhooks/*`) pass the proxy without a session, as today.
- **Cron:** `steadfast-sync` keeps running (parcels keep moving and money keeps reconciling). `trash-cleanup` **does not run** while suspended (nothing is deleted from a locked system). Any other staff-only job pauses and must neither lose data nor double-count when it resumes after missed days.
- `past_due` and `active` lock nothing.

### GV-8. The Billing page — [OPEN]

`/billing`, in the sidebar for roles with `billing.view` (Admin, Accounts):

- **Status at the top:** "All paid" / "Bill due by Fri 7 Nov — 3 days left" / "Suspended since 8 Nov — pay to open the dashboard", English with a Bangla line.
- **This month so far:** orders created (the counter, rule 6), the band it falls in, and the estimated bill from the snapshot's plan — labelled "estimate; the bill is raised on the 1st".
- **Current invoice:** lines, total, paid, due, due date, status.
- **How to pay:** bKash and bank from `payTo`, "Use the invoice number as the reference", Funnel Liner's help number.
- **History:** the last 12 invoices, each with a print-ready page.
- **No snapshot yet:** this month's count and "Your first bill will appear here on the 1st".
- **Everyone else while suspended:** the short version — the dashboard is closed because the Funnel Liner bill is unpaid; the shop's admin knows; no amounts.
- No amount is ever in an API response for a role without `billing.view`.

### GV-9. Reminders, 1st to 7th — [OPEN]

While the state is `past_due`:

- **Banner on every dashboard page** for Admin and Accounts: "Your Funnel Liner bill of ৳3,800 is due by Fri 7 Nov — 3 days left. Pay now →" (to `/billing`), with a Bangla line. Amber; red on the due date with "Today is the last day". Days counted in Dhaka days from `dueOn`.
- **Once a day, a pop-up for the Admin** on the first page they open: the same words, "Pay now" and "Later". Once per Dhaka day per person, remembered on the server (a settings key or a small table).
- Other roles: nothing.

### GV-10. Funnel Liner card in Settings — [OPEN]

Settings, Admin only, read-only: the current state and when it last changed; orders created this month and last month, with each month's last GV number; one line: "Your Funnel Liner bill is based on these numbers. Every order created counts, including cancelled orders."; and "Open Billing →".

### GV-11. Uploads and invoice PDFs outside the release — [OPEN]

Today uploads are written to `public/uploads` (served publicly, by anyone with the link) and invoice PDFs to `storage/invoices`, both inside the app folder. On the server every deploy is a new release folder, so both would be lost on the next deploy.

- `UPLOAD_DIR` and `INVOICE_DIR` env settings; production `/srv/giftvaly/uploads` and `/srv/giftvaly/invoices`, staging the same under `/srv/giftvaly-staging`. Defaults keep development as it is.
- Uploads are served through a **login-checked route** (as in Antu), never as a public static path; existing `/uploads/<file>` URLs keep working through that route; the invoice logo is read from `UPLOAD_DIR`.
- Nginx never serves either folder.

### GV-12. Production bootstrap — [OPEN]

- `npm run db:bootstrap`: creates the roles and permissions and **one** Admin (name, email, phone and a temporary password typed on the server, must-change-password on). Creates no orders, customers, products or demo data. Safe to run twice (it does nothing the second time).
- The demo seed refuses to run when `NODE_ENV=production` or when `DATABASE_URL` points at `giftvaly` (not `_staging` / dev).

### GV-13. Cron and backups — [OPEN]

- `vercel.json` is removed. A cron file of its own, `deploy/cron/giftvaly` → `/etc/cron.d/giftvaly` (not the deploy user's crontab: Antu's deploy installs that whole with `crontab -`). Jobs call `http://127.0.0.1:3200` through a small script that reads `CRON_SECRET` from the production `.env` — no secret in the cron file. Server time is UTC; schedule in Dhaka times:
  - Steadfast sync every 15 minutes;
  - trash cleanup 03:30 Dhaka;
  - backups: nightly (database + uploads + invoices) and hourly database 10:00–22:00 Dhaka, the same way and to the same Backblaze remote as Antu, under a `giftvaly-` prefix, encrypted, with the same retention.
- Every job logs to `/var/log/giftvaly/`, with logrotate.

### GV-14. Deploy files and scripts — [OPEN]

- `deploy/ecosystem.config.cjs`: PM2 `giftvaly` → `next start --hostname localhost --port 3200` (never `127.0.0.1` — see Antu's CLAUDE.md "Stack gotchas"), `TZ=Asia/Dhaka`, one fork-mode process, logs in `/var/log/giftvaly/`; `deploy/ecosystem.staging.config.cjs` for `giftvaly-staging` on 3210.
- `scripts/deploy.sh [--staging] <branch|tag|commit>` like Antu's: fetch from GitHub (read-only deploy key for this repo) → build in `releases/<stamp>-<sha>` while the current release serves → `npm ci` → `prisma migrate deploy` → GRANTs to the app role → `npm run build` → switch the `app` symlink → `pm2 startOrReload` → health check on `127.0.0.1:<port>/login`, switching back if it fails. Keep five releases. Only `prisma migrate deploy` ever touches the database.
- Two database roles like Antu: an owner role for migrations (`DIRECT_URL`) and an app role with only the grants it needs (`DATABASE_URL`). `SHADOW_DATABASE_URL` only on dev.
- `deploy/nginx/giftvaly-staging.conf` for `gv-staging.funnelliner.com` → `127.0.0.1:3210`, basic auth, `X-Robots-Tag: noindex`, the same real-IP, body-size and timeout rules as Antu. Production needs no server block of its own — it is reached through `dashboard.funnelliner.com` (GV-N) — except `app.giftvaly.com`, which only redirects (301) to `https://dashboard.funnelliner.com`.
- `.env.example` lists every production setting with a comment: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `INSTANCE_URL`, `PLATFORM_SECRET`, `SHARED_SIGNIN`, `CRON_SECRET`, `COURIER_ENCRYPTION_KEY` (**must be set on production** — today it falls back to `NEXTAUTH_SECRET`, so rotating that would make the saved Steadfast keys unreadable), `UPLOAD_DIR`, `INVOICE_DIR`, backup settings.
- Node: the version the server runs (check with `ssh antu node -v`), pinned in `package.json` `engines`.

### GV-15. DEPLOYMENT.md and GO_LIVE.md — [OPEN]

- `DEPLOYMENT.md`: the exact commands, in order, for adding Gift Valy to the existing server — staging first, then production — written like Antu's and the admin panel's. It does not repeat what the server already has. Commands marked (root) or (deploy). Every secret is generated on the server and goes to the owner's password manager, never into chat, a file in the repo or code. It ends with the post-deploy checklist from GV-17.
- `GO_LIVE.md` in **Bangla**: the owner's own steps, in order (Cloudflare redirect for `app.giftvaly.com`, Steadfast panel, adding the client in the admin panel, creating staff accounts, cancelling the old VPS).

### GV-16. Nginx on `dashboard.funnelliner.com` — [OPEN] — built in the Antu repo

The server block for `dashboard.funnelliner.com` lives in the Antu repo (`deploy/nginx/antu-crm.conf`). It gains `/_c/giftvaly/` → `127.0.0.1:3200/`, `/go/` → the shared sign-in page (A7), and routing of everything else by the shop remembered on the device. See the GV-N prompt.

### GV-17. Go live — [OPEN]

**Staging month test** (with the admin panel's staging copy and its `?asOf=`):
1. 1st → the October bill appears on Gift Valy staging's Billing page; Admin and Accounts see the reminder.
2. 7th → "last day".
3. 8th → every page goes to /billing; the Steadfast webhook and sync still work.
4. Record the payment in admin-staging → the dashboard opens within seconds.

**Post-deploy checklist (production):**
- On a new phone, `dashboard.funnelliner.com` shows the shared sign-in page; a Gift Valy number lands on Gift Valy's sign-in page with the number filled in; an Antu number lands on Antu's; a number in neither gets "wrong phone/email or password".
- After sign-in, every page and asset loads from the right shop; "Not your shop?" switches shop.
- An Antu staff member's experience is unchanged apart from the shared sign-in page on a new device.
- `https://dashboard.funnelliner.com/_c/giftvaly/api/platform/usage` answers with `PLATFORM_SECRET` and 401 without it; `/_c/anything-else/` is a 404.
- Admin panel → Clients → **Add client**: Gift Valy, shop code `giftvaly`, machine address `http://localhost:3200`, billing start date and build fee from the owner, `PLATFORM_SECRET` pasted by the owner from their own Terminal. **Test connection** passes.
- Steadfast panel → Callback URL `https://dashboard.funnelliner.com/_c/giftvaly/api/webhooks/steadfast` with the Bearer token shown on the Courier page; the first webhook arrives.
- The first nightly and hourly backups land in Backblaze; a restore drill into a throwaway database passes.
- `app.giftvaly.com` redirects to `dashboard.funnelliner.com`.
- No test order on production (rule 6).

---

## Information needed from the owner

| For | What |
|---|---|
| GV0–GV4 | Nothing — they can be built now. |
| A7 | Nothing. |
| GV5 staging | `gv-staging.funnelliner.com` added in Cloudflare (proxied); a basic-auth password for staging. |
| GV5 production | The server's free RAM and disk (`ssh antu free -h && df -h`) — six apps will run on it; Gift Valy's billing start date and build fee for the admin panel; the Admin account's name, email and phone; a Cloudflare redirect rule for `app.giftvaly.com` (or its DNS moved to the new server); a read-only GitHub deploy key added to `Soft-IT-Care-Ltd/Gift-Valy-CRM`. |
