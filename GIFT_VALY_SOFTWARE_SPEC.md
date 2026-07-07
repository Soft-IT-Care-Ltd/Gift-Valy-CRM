# Gift Valy — Business Management Software
## Full Requirements Specification & SOP (v1.0)

> **Purpose of this document:** Complete blueprint for building the Gift Valy ERP/CRM software with Claude Code. Every module, field, business rule, database table, and build phase is specified so development can start immediately.
>
> **Owner:** M.H. Neshad · **Date:** July 2026

---

## Table of Contents

1. [Business Overview & Core Workflow](#1-business-overview--core-workflow)
2. [Users, Roles & Permissions](#2-users-roles--permissions)
3. [Module 1 — Lead Management](#3-module-1--lead-management)
4. [Module 2 — Order Management](#4-module-2--order-management)
5. [Module 3 — Invoice Generation](#5-module-3--invoice-generation)
6. [Module 4 — Product, Package & Inventory](#6-module-4--product-package--inventory)
7. [Module 5 — Courier & Delivery](#7-module-5--courier--delivery)
8. [Module 6 — Payments & Collection](#8-module-6--payments--collection)
9. [Module 7 — Accounting & Profit/Loss](#9-module-7--accounting--profitloss)
10. [Module 8 — Targets & Rewards](#10-module-8--targets--rewards)
11. [Module 9 — Attendance (Check-in/Check-out)](#11-module-9--attendance-check-incheck-out)
12. [Module 10 — Reports](#12-module-10--reports)
13. [Module 11 — Owner Dashboard](#13-module-11--owner-dashboard)
14. [Database Schema](#14-database-schema)
15. [Tech Stack Recommendation](#15-tech-stack-recommendation)
16. [Phased Build Plan (for Claude Code)](#16-phased-build-plan-for-claude-code)
17. [Daily SOP per Role](#17-daily-sop-per-role)

---

## 1. Business Overview & Core Workflow

**Gift Valy** is an online gift shop in Bangladesh. Customers are **Bangladeshi expatriates (probashi)** living abroad who order gift packages/products for their loved ones **inside Bangladesh**. Delivery is done via local courier.

### 1.1 Current Manual Workflow (to be digitized)

```
Facebook Ad → Lead (WhatsApp / Messenger)
   → Sales Executive talks to lead
   → Order confirmed (customer pays ADVANCE via bKash/Nagad, txn ID recorded)
   → Order entry + Invoice generated
   → Packing (package BOM consumes product stock)
   → Handover to courier → Delivery to recipient in Bangladesh
   → Remaining COD amount collected (courier COD or bKash after delivery)
   → Reports: sales, stock, team performance, P&L
```

### 1.2 Key Business Facts (drive all design decisions)

| Fact | Software implication |
|---|---|
| Customer (payer) is abroad; recipient is in Bangladesh | Every order stores **2 phone numbers**: customer's foreign/WhatsApp number + recipient's BD number |
| Advance paid via bKash/Nagad before confirmation | Payment record with **method + transaction ID**, multiple payments per order |
| Remainder often paid via COD or bKash after delivery | Order has due tracking; payment can arrive at any stage |
| Products sell standalone AND inside packages | Package = **Bill of Materials (BOM)** of products; stock deducts at product level |
| Sales team works on targets & rewards | Target module with achievement %, reward calculation |
| Owner wants one-glance business health | Dashboard aggregates sales, collection, stock, leads, P&L |
| Ad-driven business, daily ad spend | Daily expense entry incl. ad cost; per-sale profit accounts for ad cost |

### 1.3 Order Status Lifecycle

```
LEAD → FOLLOW_UP → CONFIRMED → PACKED → HANDED_TO_COURIER
     → IN_TRANSIT → DELIVERED → COMPLETED (fully paid)
Side states: ON_HOLD, CANCELLED, RETURNED, REFUNDED
```

**Rules:**
- Order cannot move to `CONFIRMED` without at least one advance payment record (amount > 0) — configurable toggle for exceptional cases (Admin override, reason required).
- Stock is **reserved** at `CONFIRMED` and **deducted** at `PACKED`.
- `RETURNED` restores stock (Admin approval) and flags the COD amount as not collected.
- `COMPLETED` requires `due_amount = 0`.

---

## 2. Users, Roles & Permissions

Role-based access control (RBAC). Roles are seeded but permissions are editable per role from Admin panel (permission matrix UI). A user has exactly one role; Admin can also grant/revoke individual permission overrides per user.

### 2.1 Roles

| Role | Who | Summary of access |
|---|---|---|
| **Admin / Owner** | M.H. Neshad | Everything: all modules, P&L, costing, user management, settings, overrides |
| **Manager** | Operations manager | All operational modules + reports; **no** user-role editing, can see P&L if Admin enables |
| **Team Leader** | Sales team leader (e.g., Sakib) | Own team's leads/orders/targets/reports; approve order edits; cannot see company P&L or costing |
| **Sales Executive** | Sanjoy, Partho, etc. | Enter own leads & orders, view own invoices, own sales report, own target progress, own attendance. **Cannot see** other SEs' data, costs, or profit |
| **Packing/Operations** | Packing staff | View confirmed orders queue, mark PACKED, view package BOM, stock view (read) |
| **Accounts** | Accounts person | Payments, expenses, collection reconciliation, purchase entry, P&L reports; no lead/order editing |

### 2.2 Permission Matrix (seed data)

Permissions are granular strings, e.g. `orders.create`, `orders.view_all`, `orders.view_own`, `orders.edit`, `orders.cancel`, `payments.create`, `payments.verify`, `stock.adjust`, `reports.pnl`, `reports.team`, `users.manage`, `settings.manage`, `expenses.create`, `targets.manage`, `attendance.view_all`, `leads.create`, `leads.view_own`, `leads.view_all`, `courier.manage`, `invoice.generate`, `dashboard.owner`.

Key rules:
- **Sales Executive** = `*.view_own` + `*.create` (leads, orders, payments-advance-entry) only. Profit/cost fields are **never rendered** in their UI or API responses (field-level security, not just hidden buttons).
- **Team Leader** = `view_team` scope (own team members' records).
- Every sensitive action (order cancel, stock adjust, payment edit/delete, price override below floor) writes to an **audit log** (who, when, before/after values).

### 2.3 Authentication

- Email/phone + password login, session or JWT.
- Force password change on first login; Admin can deactivate a user (soft delete — history preserved).
- Every record stores `created_by`, `updated_by` user IDs.

---

## 3. Module 1 — Lead Management

Sales Executives log the leads they receive daily from ads; the funnel from lead → sale is measurable per person and per ad source.

### 3.1 Lead Entry (by SE, < 30 seconds per lead)

| Field | Type | Required | Notes |
|---|---|---|---|
| Lead date | date | ✔ (default today) | |
| Source | enum | ✔ | `Facebook Ad`, `Messenger`, `WhatsApp`, `Instagram`, `Referral`, `Repeat Customer`, `Other` |
| Campaign/Ad name | text | ✖ | Free text or dropdown synced from ad-cost entries |
| Customer name | text | ✖ | Often unknown at first contact |
| Customer country | dropdown | ✖ | KSA, UAE, Qatar, Kuwait, Oman, Malaysia, Italy, UK, USA… (editable list) |
| Customer WhatsApp number | text | ✔ | With country code; **duplicate check** → warns if number already exists as lead/customer and shows history |
| Interested in | multi-select | ✖ | Packages/products list |
| Status | enum | ✔ | `New`, `Contacted`, `Follow-up`, `Negotiating`, `Converted`, `Lost` |
| Follow-up date/time | datetime | ✖ | Generates reminder on SE dashboard |
| Lost reason | enum | ✖ | Required if status = Lost: `Price`, `Trust`, `Delivery time`, `Out of area`, `No response`, `Other` |
| Notes | textarea | ✖ | |
| Assigned SE | auto | ✔ | = logged-in SE; TL/Admin can reassign |

**Bulk quick-entry mode:** SE can also just log a daily count per source ("today I got 25 leads from Campaign X") when individual entry isn't practical — stored in `lead_daily_counts` and used for conversion-rate math when detailed leads are missing.

### 3.2 Lead Rules & Automation

- When an order is created from a lead → lead auto-flips to `Converted` and links `lead_id` on the order.
- **Conversion rate** = Converted leads ÷ Total leads, computed per SE, per source, per campaign, per date range.
- Follow-up reminders appear on SE dashboard ("Today's follow-ups: 7") and overdue follow-ups are flagged red.
- TL/Manager can reassign leads (e.g., when an SE is absent).

---

## 4. Module 2 — Order Management

The heart of the system. SE enters a confirmed order; everything else (invoice, stock, courier, payment, reports) hangs off it.

### 4.1 Order Entry Form

**Section A — Customer (the probashi payer)**
| Field | Type | Required |
|---|---|---|
| Customer name | text | ✔ |
| Customer phone (foreign/WhatsApp) | text | ✔ — **Number 1 of 2** |
| Country | dropdown | ✔ |
| Facebook/profile link | url | ✖ |
| Lead reference | link | auto if converted from lead |

Customers are saved in a `customers` table → repeat customer auto-fills + shows order history ("এই কাস্টমার আগে ৩টা অর্ডার করেছে").

**Section B — Recipient (in Bangladesh)**
| Field | Type | Required |
|---|---|---|
| Recipient name | text | ✔ |
| Recipient phone (BD) | text | ✔ — **Number 2 of 2** |
| Relation to customer | dropdown | ✖ (Wife, Mother, Father, Sibling, Friend…) |
| Full delivery address | textarea | ✔ |
| District / Thana | dropdown | ✔ (drives courier zone & charge) |
| Delivery date requested | date | ✖ (birthdays/anniversaries — occasion field: enum) |

**Section C — Items**
- Line items: select **Package** or **Product**, qty, unit price (auto from catalog, editable within permission — price floor per item; below-floor needs TL/Admin approval).
- Custom package builder: SE can compose an ad-hoc package from products; price = sum or manual.
- Order-level: discount (amount/%), courier charge (auto-suggested by district, editable), **total = items − discount + courier charge**.

**Section D — Payment at confirmation**
| Field | Type | Required |
|---|---|---|
| Advance amount | number | ✔ (≥ 0) |
| Method | enum | ✔ — `bKash`, `Nagad`, `Rocket`, `Bank`, `Cash`, `Other` |
| **Transaction ID** | text | ✔ if method is MFS — duplicate-check across all payments |
| Sender wallet number | text | ✖ |
| Screenshot upload | image | ✖ |
| Due amount | auto | = total − advance |
| COD amount | auto/edit | portion to collect on delivery |

**Section E — Meta**
- Sales Executive (auto = creator), Team (auto from SE), order source, internal notes, status (starts at `CONFIRMED`).

### 4.2 Order Rules

- Order number auto-generated: `GV-YYMM-XXXX` (e.g., `GV-2607-0142`).
- After creation, SE can edit only within X minutes (setting, default 30) — after that, edits need TL/Manager approval (edit-request flow) — prevents silent tampering with sales numbers.
- Cancel requires reason; cancelled orders excluded from sales reports but visible in a cancelled-orders report; advance refund recorded as a negative payment with method + txn ID.
- Every status change is timestamped and logged (`order_status_history`) → enables SLA reports (confirm→deliver time).

---

## 5. Module 3 — Invoice Generation

- Auto-generated on order confirmation; PDF, one click to download / print / send via WhatsApp (wa.me link with pre-filled message).
- **Layout:** Gift Valy logo & contact, invoice no (= order no), date, customer name + country + phone, recipient name + BD phone + address, item table (name, qty, unit price, subtotal), discount, courier charge, **grand total, advance paid (with method + txn ID), due/COD amount**, footer terms.
- Amounts in BDT (৳). Optional customer-currency display (rate table maintained by Admin) — Phase 3.
- Invoice regenerates automatically if TL/Admin-approved edit changes amounts; old version kept (versioned).

---

## 6. Module 4 — Product, Package & Inventory

### 6.1 Product Catalog

| Field | Notes |
|---|---|
| Product name, SKU (auto), photo | |
| Category | Teddy, Chocolate, Saree, Cosmetics, Cake, Flowers, Card… (editable) |
| **Purchase cost (avg)** | recalculated on each purchase (weighted average) — hidden from SE |
| Selling price (standalone) + price floor | |
| Unit | pcs, box, set |
| Low-stock threshold | triggers dashboard alert |
| Active/inactive | |
| Perishable flag | cakes/flowers — bought per order, can be flagged `non-stock` (no stock tracking, cost entered per order) |

### 6.2 Package (BOM)

A **package** is a sellable bundle defined by a BOM:

```
Package: "Probashi Premium Package" — sell ৳3,500
  BOM: 1 × Teddy (M), 1 × Chocolate Box, 1 × Saree, 1 × Greeting Card, 1 × Gift Wrap
  Package cost = Σ(component avg cost) → auto-computed
  Package margin = sell − cost → visible to Admin/Manager only
```

- Selling a package **deducts each BOM component** from product stock (at `PACKED`; reserved at `CONFIRMED`).
- **Available-to-sell** for a package = min over components of (component stock ÷ qty required) — shown in catalog ("এই প্যাকেজ আর ১২টা বানানো সম্ভব").
- BOM is versioned: editing a BOM affects future orders only.

### 6.3 Stock Movements

Every change is an immutable `stock_movements` row: `IN_PURCHASE`, `OUT_SALE`, `RESERVE`, `RELEASE_RESERVE`, `IN_RETURN`, `ADJUST_PLUS`, `ADJUST_MINUS` (adjust requires reason + permission).

- **Purchase entry** (Accounts/Admin): supplier, date, product lines (qty, unit cost, total), payment status → increases stock, updates weighted-avg cost, and auto-creates the expense record (product purchase cost).
- **Stock report:** current qty, avg cost, **stock value (qty × avg cost)**, reserved qty, available qty, low-stock list. Total stock value shows on owner dashboard ("স্টকে কত টাকার প্রোডাক্ট আছে").

---

## 7. Module 5 — Courier & Delivery

- Courier companies table: name (Steadfast, Pathao, RedX, Sundarban…), contact, COD charge %, per-zone delivery charge.
- **Courier entry per order:** courier company, tracking/consignment no, handover date, COD amount given to courier, expected delivery date.
- Statuses: `PACKED → HANDED_TO_COURIER → IN_TRANSIT → DELIVERED / RETURNED / PARTIAL`. Manual update in Phase 1; **courier API integration (Steadfast/Pathao webhook auto-status) in Phase 3**.
- **COD reconciliation:** when courier remits COD, Accounts matches remittance against delivered orders (bulk "mark COD received" screen); courier COD fee auto-recorded as expense. Report: COD pending with courier (order-wise, aging).
- Return flow: `RETURNED` → stock restore approval → return courier charge recorded as expense → customer refund handling if advance was taken.

---

## 8. Module 6 — Payments & Collection

Multiple payments per order (advance, second advance, COD, post-delivery bKash):

| Field | Notes |
|---|---|
| Order link, date | |
| Type | `ADVANCE`, `PARTIAL`, `COD_COURIER`, `POST_DELIVERY_MFS`, `REFUND(−)` |
| Method | bKash / Nagad / Rocket / Bank / Cash / Courier-COD |
| Amount | |
| **Transaction ID** | required for MFS; unique-check |
| Sender number, screenshot | optional |
| Received-in wallet/account | which company bKash/Nagad/bank received it (accounts list maintained by Admin) |
| Verified flag | Accounts verifies against wallet statement; unverified payments flagged |

**Collection report:** by date range — total collected, by method, by wallet, verified vs unverified, and **total due outstanding** (order-wise due list with age).

---

## 9. Module 7 — Accounting & Profit/Loss

### 9.1 Expense Entry (daily, by Accounts/Admin)

| Field | Notes |
|---|---|
| Date, amount, paid via (wallet/bank/cash) | |
| Category | **Ad Cost (daily, per campaign optional)**, Product Purchase (auto from purchase module), Courier Charge (auto), Salary, Rent, Utilities, Packaging Materials, Office, Reward/Bonus, Other — categories editable, each flagged **Fixed / Variable** |
| Notes, receipt upload | |

### 9.2 Profit Logic

**Per-order profit (Admin/Manager view only):**
```
Order profit = Total sell value
             − Σ(product cost of items, from avg cost at packing time)
             − courier charge cost (actual paid to courier incl. COD fee)
             − packaging cost (standard per-order rate, setting)
             − allocated ad cost (= that day's ad spend ÷ that day's confirmed orders)
```
Ad-cost allocation method is a setting: `per-order daily average` (default) or `manual %`.

**Monthly P&L:**
```
Revenue (delivered/confirmed toggle)
− COGS (product costs of sold items)
− Variable costs (ad, courier, packaging, MFS cashout fees)
− Fixed costs (salary, rent, utilities…)
= Net Profit    | also: Gross margin %, Net margin %, per-order avg profit
```

### 9.3 Views

- **Daily entry screen:** one page where daily ad cost + other costs are entered in <1 minute.
- **Daily summary:** date-wise sales (orders, value), collection, costs, net — table + chart, filter by date range.
- **Month-end report:** auto-compiled P&L + comparisons vs previous month.
- Cash/wallet balances: per wallet running balance (collections in − expenses/withdrawals out).

---

## 10. Module 8 — Targets & Rewards

- **Target setting (Admin/Manager):** per SE and per Team, per month: target order count and/or target sales value (৳). Separate confidential TL targets supported (visible only to Admin + that TL).
- New joiners flagged `onboarding` are excluded from team aggregate targets for their first configurable N days.
- **Live progress:** SE dashboard shows own gauge — achieved / target, %, days left, required daily run-rate. TL sees team members' gauges. Admin sees all.
- **Rewards:** rule table — e.g., `≥100% of target → ৳3,000 bonus`, `≥120% → ৳6,000`, `Top seller of month → ৳X`. On month close, system computes qualifiers → Admin approves → reward becomes an expense record + appears in SE's profile history.
- Leaderboard (this month, by sales value and by orders) — visible to all (motivation), amounts of others' rewards not shown to SEs.

---

## 11. Module 9 — Attendance (Check-in/Check-out)

- Web/mobile check-in and check-out buttons; timestamps server-side.
- Office hours & late threshold in settings (e.g., 10:15 AM); auto-flag Late / Absent / Half-day / On-leave (leave request + approval flow, simple).
- Optional (Phase 3): selfie or geo-fence on check-in.
- Reports: per employee monthly sheet (present/late/absent count, work hours), team summary; feeds a small widget on Admin dashboard ("আজ কে কে অফিসে আছে").

---

## 12. Module 10 — Reports

All reports: filter by date range / SE / team / status, export **CSV + PDF**, respect role scope (SE = own, TL = team, Admin/Manager = all).

| # | Report | Key contents |
|---|---|---|
| R1 | Sales report | orders & value by day/SE/team/package/country; delivered vs cancelled |
| R2 | Lead report | leads by SE/source/campaign/date, conversion %, lost reasons |
| R3 | Team performance | per SE: leads, conversion, orders, sales value, avg order value, target % |
| R4 | Stock report | current stock, value, reserved, low-stock, movement history |
| R5 | Package availability | buildable qty per package |
| R6 | Courier report | pending handover, in-transit, delivered %, returned %, COD pending with courier |
| R7 | Collection report | by method/wallet/verified, dues outstanding + aging |
| R8 | Expense report | by category, fixed vs variable, ad cost trend |
| R9 | P&L | daily summary, monthly P&L, per-order profit list (Admin) |
| R10 | Attendance report | per employee, per month |
| R11 | Cancelled/Returned analysis | reasons, value lost, SE-wise |
| R12 | Customer report | repeat customers, top customers, per-country sales |

---

## 13. Module 11 — Owner Dashboard

Single screen = full business health. Widgets (with date-range switch: Today / This week / This month / Custom):

**Row 1 — Money:** Today's sales (৳ + order count) · Today's collection · Today's cost (incl. ad) · Today's estimated profit
**Row 2 — Month:** MTD sales vs last month (chart) · MTD net profit · Total dues outstanding · COD pending with courier
**Row 3 — Operations:** Orders by status (funnel: confirmed→packed→shipped→delivered) · Stock value + low-stock alert count · Package availability alerts
**Row 4 — Team:** Leaderboard (top SEs) · Team target progress bar · Today's leads count & conversion · Who's checked in today
**Row 5 — Charts:** 30-day sales & collection line chart · expense split donut · country-wise sales map/table

Role-based dashboards: SE sees own funnel/target/follow-ups; TL sees team; Packing sees packing queue; Accounts sees collection/verification queue.

---

## 14. Database Schema

PostgreSQL (or MySQL). Naming: snake_case, all tables have `id` (PK), `created_at`, `updated_at`, `created_by`, `updated_by`. Money = `DECIMAL(12,2)` in BDT.

```sql
-- ============ AUTH & ORG ============
users(id, name, email UNIQUE, phone, password_hash, role_id FK, team_id FK NULL,
      is_active BOOL, is_onboarding BOOL, joined_at DATE)
roles(id, name UNIQUE)                          -- Admin, Manager, TeamLeader, SalesExecutive, Packing, Accounts
permissions(id, key UNIQUE)                     -- 'orders.create', 'reports.pnl', ...
role_permissions(role_id FK, permission_id FK)
user_permission_overrides(user_id FK, permission_id FK, allow BOOL)
teams(id, name, leader_user_id FK)
audit_logs(id, user_id FK, action, entity, entity_id, before_json JSONB, after_json JSONB, at TIMESTAMPTZ)

-- ============ LEADS ============
leads(id, lead_date DATE, source, campaign_name, customer_name, country,
      whatsapp_number, interested_in JSONB, status, follow_up_at TIMESTAMPTZ,
      lost_reason, notes, assigned_to FK users, converted_order_id FK NULL)
lead_daily_counts(id, date, user_id FK, source, campaign_name, count INT)

-- ============ CATALOG & STOCK ============
products(id, sku UNIQUE, name, category_id FK, photo_url, unit,
         avg_cost DECIMAL, selling_price DECIMAL, price_floor DECIMAL,
         low_stock_threshold INT, is_stock_tracked BOOL, is_active BOOL)
categories(id, name)
packages(id, code UNIQUE, name, photo_url, selling_price, price_floor, is_active BOOL)
package_items(id, package_id FK, product_id FK, qty INT)          -- the BOM
purchases(id, supplier_name, purchase_date, total_amount, payment_status, notes)
purchase_items(id, purchase_id FK, product_id FK, qty, unit_cost, line_total)
stock_movements(id, product_id FK, type ENUM(IN_PURCHASE,OUT_SALE,RESERVE,RELEASE_RESERVE,
      IN_RETURN,ADJUST_PLUS,ADJUST_MINUS), qty INT, ref_table, ref_id, reason, at)
-- current stock = SUM(movements); cache column products.stock_qty maintained in same txn

-- ============ CUSTOMERS & ORDERS ============
customers(id, name, phone_foreign, country, fb_link, notes)        -- the probashi payer
orders(id, order_no UNIQUE, lead_id FK NULL, customer_id FK,
       recipient_name, recipient_phone_bd, recipient_relation,
       delivery_address, district, thana, occasion, requested_delivery_date,
       subtotal, discount, courier_charge_customer, total_amount,
       advance_amount, due_amount, cod_amount,
       status ENUM, cancel_reason, notes,
       sales_executive_id FK users, team_id FK)
order_items(id, order_id FK, item_type ENUM(PRODUCT,PACKAGE), product_id FK NULL,
       package_id FK NULL, custom_name, qty, unit_price, unit_cost_snapshot, line_total)
order_status_history(id, order_id FK, from_status, to_status, by_user FK, at, note)
invoices(id, order_id FK, invoice_no, version INT, pdf_url, generated_at)

-- ============ COURIER ============
couriers(id, name, contact, cod_fee_percent, notes)
courier_zone_charges(id, courier_id FK, district, charge DECIMAL)
shipments(id, order_id FK, courier_id FK, tracking_no, handover_date,
       cod_amount, expected_delivery, status, delivered_at, returned_at,
       courier_cost_actual, cod_received BOOL, cod_received_at)

-- ============ MONEY ============
wallets(id, name, type ENUM(BKASH,NAGAD,ROCKET,BANK,CASH), account_no, is_active)
payments(id, order_id FK, payment_date, type ENUM(ADVANCE,PARTIAL,COD_COURIER,
       POST_DELIVERY_MFS,REFUND), method, amount, transaction_id UNIQUE NULL,
       sender_number, screenshot_url, wallet_id FK, is_verified BOOL, verified_by FK NULL)
expense_categories(id, name, cost_type ENUM(FIXED,VARIABLE))
expenses(id, expense_date, category_id FK, amount, wallet_id FK, campaign_name NULL,
       notes, receipt_url, ref_table NULL, ref_id NULL)   -- ref links auto-expenses (purchase/courier/reward)

-- ============ TARGETS, REWARDS, ATTENDANCE ============
targets(id, month DATE, scope ENUM(USER,TEAM), user_id FK NULL, team_id FK NULL,
       target_orders INT, target_amount DECIMAL, is_confidential BOOL)
reward_rules(id, name, min_achievement_percent, reward_amount, is_active)
rewards(id, user_id FK, month, rule_id FK, amount, status ENUM(PENDING,APPROVED,PAID))
attendance(id, user_id FK, date, check_in_at, check_out_at,
       status ENUM(PRESENT,LATE,ABSENT,HALF_DAY,LEAVE), note)
leave_requests(id, user_id FK, from_date, to_date, reason, status, approved_by FK)

-- ============ SETTINGS ============
settings(key PK, value JSONB)   -- office hours, late threshold, edit-window minutes,
                                -- packaging cost per order, ad allocation method, currency rates
```

**Critical integrity rules (enforce in service layer + DB):**
1. `orders.due_amount = total_amount − Σ(payments where type≠REFUND) + Σ(REFUND)` — recompute on every payment write.
2. Stock cache and `stock_movements` written in one transaction.
3. `payments.transaction_id` unique (nullable) — blocks double-entry of same bKash txn.
4. `order_items.unit_cost_snapshot` frozen at PACKED time → historical P&L never shifts when avg cost changes.

---

## 15. Tech Stack Recommendation

Optimized for **building with Claude Code**, single small team, low ops burden:

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14+ (App Router, TypeScript)** — full-stack, one codebase | Claude Code is excellent at it; SSR dashboard; API routes for mobile later |
| DB + ORM | **PostgreSQL + Prisma** | Schema above maps 1:1 to Prisma models; migrations easy |
| Auth | **NextAuth (credentials) or Lucia** + RBAC middleware | field-level security in API layer |
| UI | **Tailwind + shadcn/ui** | fast, clean admin UI; Bangla font: Noto Sans Bengali |
| Charts | Recharts | dashboard |
| PDF invoice | `@react-pdf/renderer` or Puppeteer HTML→PDF | Bangla text support — test font embedding early |
| File upload | local `/uploads` first; S3-compatible (Cloudflare R2) later | screenshots, receipts |
| Hosting | VPS (Hostinger/DigitalOcean, ~$6–12/mo) with Docker Compose (app+postgres) or Vercel + Neon | your call; VPS keeps data in one place |
| Backups | nightly `pg_dump` to R2/Drive — **non-negotiable** | business-critical data |

Alternative if you prefer PHP hosting: Laravel 11 + Filament admin panel (also very Claude Code-friendly). Pick **one** and stay with it — recommendation: **Next.js + Prisma + Postgres**.

---

## 16. Phased Build Plan (for Claude Code)

Build in vertical slices; each phase ships something usable. Feed each phase to Claude Code as a session with this SPEC in the repo (`CLAUDE.md` should point to this file).

### Phase 1 — Core Sales Engine (Week 1–2) ✅ start here
1. Project scaffold: Next.js + Prisma + Postgres + auth + RBAC (roles/permissions seed).
2. Users/teams CRUD (Admin).
3. Product, category, package + BOM CRUD.
4. Customer + Order entry (full form of §4.1) + order number + status flow.
5. Payments on order (advance with txn ID) + due auto-calc.
6. Invoice PDF.
7. SE "my orders / my sales today" view.

### Phase 2 — Stock, Courier, Money (Week 3–4)
8. Purchase entry + stock movements + weighted avg cost + reserve/deduct on status.
9. Stock report + low-stock alerts + package availability.
10. Courier module + shipment statuses + COD reconciliation.
11. Payment verification + collection report + wallets.
12. Expense entry (ad cost daily) + expense report.

### Phase 3 — Intelligence & HR (Week 5–6)
13. Lead management + follow-up reminders + conversion reports.
14. Targets + leaderboard + reward engine.
15. Attendance + leave.
16. Full owner dashboard (§13) + all remaining reports + CSV/PDF export.
17. P&L (per-order + monthly) + audit log viewer.

### Phase 4 — Polish & Integrations (later)
18. Courier API integration (Steadfast/Pathao webhooks).
19. WhatsApp invoice send, customer-currency display, mobile PWA, selfie/geo check-in.

**Definition of done per phase:** seeded demo data, role-tested (login as SE must NOT see costs/others' orders), backup script running.

---

## 17. Daily SOP per Role

**Sales Executive (daily):**
1. Check-in on arrival → dashboard shows today's follow-ups.
2. Log every new lead as it arrives (or bulk count end-of-shift minimum).
3. On sale confirmation: collect advance → verify txn → create order (both numbers, full address) → send invoice to customer's WhatsApp.
4. Update lead statuses; before check-out: confirm all today's leads & orders are entered.

**Packing/Operations:** open Packing Queue (status = CONFIRMED) → pick per BOM → mark PACKED (stock deducts) → create shipment entry on courier handover.

**Accounts (daily):** enter today's ad cost + expenses → verify today's MFS payments against wallet statements → reconcile courier COD remittances → check dues/aging weekly.

**Manager/TL (daily):** review team leaderboard & target run-rate → approve edit/cancel requests → reassign leads of absentees.

**Owner (M.H. Neshad):** open Dashboard → Row 1–2 = আজ ও এই মাসের টাকা-পয়সার অবস্থা → check low-stock & COD-pending alerts → month-end: P&L report + reward approvals.

---

*End of specification v1.0 — keep this file in the repo root; reference it from CLAUDE.md so Claude Code always builds against it.*
