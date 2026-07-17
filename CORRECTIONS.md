# Gift Valy — Corrections List

> Tags: [BUG] ভাঙা · [CHANGE] আচরণ বদলাতে হবে · [UI] দেখতে/সাজাতে · [FIXED] হয়ে গেছে
> Build order: নিচের "BUILD ORDER" section-এর prompt গুলো serial অনুযায়ী দিন — প্রতি prompt-এর পর test, তারপর `/clear` দিয়ে পরেরটা।

---

## BUILD ORDER — Correction Round 1 (Prompts C1–C10)

### Prompt C1 — Catalog Foundation (সবার আগে — বাকি সব এর উপর দাঁড়াবে)
```
Read CORRECTIONS.md → "Products & Packages" items 1–5. Implement all five:
component-only products, product-level packing materials, weight + 3-zone
delivery charge fields, BOM quantity verification, and nested packages with
choice/variant groups. Migrations + seed updates included. Write unit tests
for the recursive BOM explosion (cost, weight, stock deduction, availability,
cycle prevention). Mark the items [FIXED] in CORRECTIONS.md, commit, and tell
me how to test in the browser.
```

### Prompt C2 — Order Form & Lifecycle Core
```
Read CORRECTIONS.md → "Leads" items 9–10 and "Orders" items 1, 4, 5, 6d, 7
(schema + form parts). Implement: Committed lead status + queue, DRAFT order
stage with Pending-Payment tab and DRAFT-XXXX numbering, requested delivery
date with ASAP/Any day/Fixed modes, "Special One ❤" relation, remove
District/Thana fields (full address only, free delivery default, zone
selector per Products item 3), the 3-note system (Order/Invoice/Courier notes
on the form + list modal + invoice print + Steadfast note field), and
recipient Birthday/Anniversary fields saved to the customer profile.
Run npm run verify:lifecycle after. Mark items [FIXED], commit.
```

### Prompt C3 — Order List UI
```
Read CORRECTIONS.md → "Orders" items 6a, 6b, 6c, 6e, 6f, 6g, 6h, 6i.
Implement: customer column (Name→Phone→Country), recipient phone under name,
Items column with +N more chips, Action column (view/edit/trash), Trash tab
with 30-day auto-delete + restore + reserve release, inline single & bulk
status change (eligible statuses only, all side effects preserved), bulk
invoice print from CONFIRMED and PACKED tabs, and the half-A4 two-up invoice
redesign. Mark items [FIXED], commit, tell me how to test.
```

### Prompt C4 — Leads Page Overhaul
```
Read CORRECTIONS.md → "Leads" items 1–8. Implement: WhatsApp-number-first
form order, country auto-detect from country code (default KSA, editable),
form defaults (Status New / Country KSA / Source WhatsApp / follow-up =
entry date + 1 day), list default filter This Month + pagination (25/50/100),
notice-style redesign of the follow-up/overdue indicators, Orders-style page
restructure (list landing + New Lead button, Bulk Lead button only with
permission), assign-on-entry field for users with assign permission, and
verify total lead counts everywhere = individual + bulk combined.
Mark items [FIXED], commit.
```

### Prompt C5 — Courier Menu + Steadfast Send/Columns
```
Read CORRECTIONS.md → "Courier / Shipments" items 1–2 and "Orders" items
6j, 6k, 6l. Implement: 3-zone + weight courier cost estimation (actual
delivery_charge from webhook overrides), Steadfast-only Courier page (move
integration UI from Settings, add zone rate config, remove Courier
companies/Returns/Shipments submenus, keep schema multi-courier),
send-to-Steadfast from CONFIRMED tab (auto-apply PACKED transition), Handed
to Courier columns (Consignment ID + Tracking Link), In Transit columns
(+ Steadfast Delivery Charge + Weight with tracking-page scraping fallback
+ tracking link discovery from raw API response logging).
Mark items [FIXED], commit.
```

### Prompt C6 — In Transit & Returned Tab Restructure
```
Read CORRECTIONS.md → "Orders" items 6m and 6n. Implement: In Transit
auto-entry on warehouse receive, Courier Status column (Pending / Assigned /
Delivery Approval Pending / Return Approval Pending), Rider Info column
(tracking-page parsing), 4 count-badged sub-tabs, auto-move to Delivered /
Returned on final approval; Returned tab Pending/Received sub-tabs with the
receive-time damage inspection dialog (OK → stock IN_RETURN, Damaged →
damage log + P&L loss + damaged-stock report, no admin approval step).
Run npm run verify:lifecycle. Mark items [FIXED], commit.
```

### Prompt C7 — Delivery Schedule + Requirement Planner
```
Read CORRECTIONS.md → "Orders" items 2–3 and "Stock / Purchase" item 1.
Implement: Delivery Schedule view (Today/Tomorrow/Next 7 days/This Month/
Next Month/Custom, date-grouped, ASAP in Today, fixed-date badges), late-risk
red flags + dashboard count, and the Delivery Requirement Planner (BOM-exploded
required vs stock vs shortage, unit cost × shortage, grand total, one-click
purchase requisition, DRAFT toggle, no double-counting with reserves).
Mark items [FIXED], commit.
```

### Prompt C8 — Occasions Menu & Reminders
```
Read CORRECTIONS.md → "Orders" item 7 (menu + reminder parts). Implement:
the Occasions menu (Today/Tomorrow/Next 7 days/This Month/Custom filters,
customer + recipient + relation + occasion + days-remaining + last order +
Follow up action), customer-profile occasion editing, and the
configurable-lead-time reminders surfacing in the SE follow-up area.
Mark item [FIXED], commit.
```

### Prompt C9 — Dashboard Widgets
```
Read CORRECTIONS.md → "Dashboard" items 1–7. Add the widgets (Leads count,
Orders count, Delivered count+amount, Advance Collection, Total Collection
with Advance/COD/Post-delivery-MFS breakdown, Courier Balance via
/get_balance, Draft Orders count+amount linking to the Pending Payment tab).
All must follow the global date-range switch. Keep every existing widget.
Mark items [FIXED], commit.
```

### Prompt C10 — Round 1 Verification
```
Verification pass for correction round 1. With seeded demo data:
1. Full new lifecycle: lead → Committed → DRAFT → payment → CONFIRMED →
   send to Steadfast from CONFIRMED (mock API) → In Transit (mock webhook
   pending) → rider assigned (mock) → Delivery Approval Pending → Delivered;
   verify COD reconciliation still works
2. Return path: In Transit → Return Approval Pending → Returned Pending →
   Received with 1 item damaged → stock restored correctly, damage logged,
   P&L shows the loss
3. Nested package (combo with a choice group) order: stock deduction,
   cost snapshot, availability all correct; npm run verify:lifecycle passes
4. Trash → restore → reserves correct; trash 30-day cleanup job dry-run
5. Login as Sales Executive: STILL no cost/profit fields in any API response,
   including new endpoints (planner, damage log, dashboard widgets)
6. Fix everything found, confirm every CORRECTIONS.md item is [FIXED], commit.
```
→ **Verified (C10, 2026-07-18)** — every verify script green (`lifecycle` 106 ·
`steadfast` 95 · `dashboard` 47 · `stock` 29 · `courier-cost` 20 ·
`purchase-dues` 30 · `leads` 28 · `targets` 50 · `attendance` 46 · `pnl` 38 ·
`reports` 47 · `test:bom` 24), production build clean, merged to `main`.
- **Items 1+3**: new `verify-lifecycle` §10 — a nested combo (PKG-004 = sub-package
  + choice group) ordered with the NON-default variant: reserve/deduct follow the
  chosen explosion exactly (default variant untouched), cost snapshot = chosen-pick
  recursive BOM cost, availability drops by exactly 1 per pack; then the §6j
  CONFIRMED-tab send (auto-pack pre-network via `autoPackForHandover`) →
  `pending` → rider ASSIGNED → `delivered_approval_pending` (stays IN_TRANSIT) →
  `delivered` → COD reconciliation settles the due. Item 2 was already §8.
- **Item 4**: new `verify-lifecycle` §11 — trash releases the reservation
  (on-hand untouched), restore re-reserves, and the 30-day purge dry-run picks
  ONLY a >30-day row, cascades items/history and keeps the immutable stock ledger.
- **Item 5**: live probe as Sanjoy (SE) against the dev server — orders
  list/detail (incl. the R7 courier block), products, packages, occasions,
  role-home dashboard and leads carry ZERO cost markers (admin control run
  proves the scanner catches `avgCost`/`unitCost`/`courierCost`); planner,
  delivery-schedule and damaged-stock report redirect SEs away, the Steadfast
  balance API 403s.
- **6a**: Delivered widget now falls back to the `order_status_history`
  DELIVERED timestamp when a delivered order has no `shipment.delivered_at`
  (`lib/dashboard.ts`), proven by a live +1/−1 check in `verify-dashboard`.
- **6b**: `formatDuration` already produced `45m` / `5h 20m` / `5d 3h` —
  pinned by 8 regression checks in `verify-steadfast`.
- **6c**: every Snapshot widget (§1/§2/§4/§5/§7 + §3) is now compared to a
  DIRECT DB query for the same range in `verify-dashboard`.
- **Stale-script fixes found by the pass**: `verify-reports` sale-side
  aggregates now exclude DRAFT like the report code (Leads §10); `verify-pnl`
  RBAC loop skips the inactive "Steadfast (system)" machine account.

---

## Dashboard

> Keep ALL existing dashboard widgets as they are — the following are ADDITIONS. All new widgets must respect the existing date-range switch (Today / Week / Month / Custom).

> → Fixed (C9): a new **Snapshot** KPI strip at the top of the **Owner Dashboard** (`components/dashboard/owner-dashboard.tsx`), above the existing Money row — every prior widget is untouched. All seven figures follow the existing date-range switch: the new fields are aggregated in **`lib/dashboard.ts#buildOwnerDashboard`** off the same `DashWindow` (leads/orders/delivered/drafts by `created_at` in range, collections by `payment_date` in range) and exposed as `data.snapshot`. Verified end-to-end against the seeded demo DB (`npm run verify:dashboard`, 38 checks) and in the running app.

1. [FIXED] Add a **Leads** widget: total lead count for the selected date range.
   → Reuses the combined lead total (detailed leads + `lead_daily_counts` bulk entries, Leads §6); links to `/leads`.
2. [FIXED] Add an **Orders** widget: total order count (quantity) for the selected range.
   → In-range order count excluding lost/draft statuses (`EXCLUDED_SALE_STATUSES`), matching the Money row's order count; links to `/orders`.
3. [FIXED] Add a **Delivered** widget: delivered order **count + total amount (৳)** for the selected range.
   → Counts by **delivery date**: orders whose `shipment.delivered_at` falls in the range (scoped to `DELIVERED`/`COMPLETED`), with Σ `total_amount`; links to `/orders?status=DELIVERED`. Independent of the funnel, which keeps its created-in-range stage view.
4. [FIXED] Add an **Advance Collection** widget: number of advance payments + total advance amount (৳) for the selected range (payment type = ADVANCE).
   → `payment.groupBy` on type `ADVANCE` (rejected payments and trashed-order payments excluded, same rule as the collection report).
5. [FIXED] Add a **Total Collection** widget **with breakdown by payment source**. Breakdown lines: **Advance** (type ADVANCE/PARTIAL), **Courier COD** (type COD_COURIER), **Post-delivery bKash/MFS** (type POST_DELIVERY_MFS — this happens when the customer pays the due via bKash after the parcel is shipped and the courier COD is set to 0). Show each source's amount + the grand total. Sometimes only 2 sources have values, sometimes all 3 — always show whichever are non-zero (or all 3 with 0 values, whichever looks cleaner).
   → All three source lines always shown (each a colored dot + amount) with the grand total = their sum; sums come from the same in-range `payment.groupBy` by type (advance line = ADVANCE + PARTIAL).
6. [FIXED] Add a **Courier Balance** widget: current Steadfast balance via the existing /get_balance integration (with a small refresh icon; show "—" if integration disabled).
   → Client tile (`components/dashboard/courier-balance-tile.tsx`) fetches the existing `/api/couriers/steadfast/balance` route on mount + on the refresh icon, so a slow/failing courier API never blocks the dashboard; shows "—" when the integration is off (`snapshot.courierEnabled`) or the viewer lacks `courier.manage`.
7. [FIXED] Add a **Draft Orders (Pending Payment)** widget: DRAFT order **count + total amount (৳)** for the selected date range — this is the committed-but-unpaid pipeline (see Leads item 10). Clicking it goes to the Orders page "Pending Payment (Drafts)" tab.
   → In-range `DRAFT` count + Σ `total_amount`, amber when non-zero; links to `/orders?status=DRAFT` (the "Pending Payment (Drafts)" tab).

## Leads

1. [FIXED] Lead entry form field order: **WhatsApp number input comes FIRST**, then Country.
2. [FIXED] **Country auto-detection**: when a WhatsApp number is typed with a country code (e.g. +966…), auto-select the matching country. Must remain manually changeable afterward. Default (before/without detection) = **KSA**.
3. [FIXED] Pre-filled defaults on the lead entry form (all editable):
   - Status = **New** (already exists — keep)
   - Country = **KSA**
   - Source = **WhatsApp**
   - Follow-up date = **entry date + 1 day** (editable)
4. [FIXED] Lead list: default filter is currently ALL TIME which loads too much — change default to **This Month**. Add **pagination**: page-size selector (25 / 50 / 100 rows) + page navigation.
5. [FIXED] "Today's follow-ups: 0" and "Overdue: 6 — follow up now" currently look like buttons, but they are notices — redesign them as notice/alert badges (info style for today's follow-ups, warning/red style for overdue), clearly not clickable-button styled. Keep the "follow up now" link behavior if it navigates somewhere.
6. [FIXED] Verify that everywhere a total lead count is shown (dashboard widget, lead report, conversion rate), the total = individual lead entries + bulk daily-count entries (lead_daily_counts) combined. E.g. 10 manual + 30 bulk on the same day must show 40 for that day.
7. [FIXED] Restructure the Leads page like the Orders page: landing page = the lead LIST. A **"New Lead"** button at the top-right opens a separate lead entry page. Users who have the bulk-entry permission see **two** buttons: "New Lead" and "Bulk Lead" (separate bulk entry page). Users without bulk permission see only "New Lead". (New `leads.bulk` permission — seeded to Admin/Manager/TeamLeader.)
8. [FIXED] **Assign-on-entry**: users with the lead-assign permission get an "Assign to" select at the END of the New Lead form — default = their own name, but they can pick another SE while entering. Users WITHOUT the assign permission don't see this field at all (lead auto-assigns to themselves).
9. [FIXED] Add a new lead status **`Committed`** (after `Negotiating`, before `Converted`): customer has verbally confirmed the order and promised the advance payment but hasn't paid yet (will pay in an hour / 10 hours / next day). Important status — show a **"Committed" queue** prominently (SE dashboard + lead list filter) with time-since-commitment, because these need chasing until payment lands.
10. [FIXED] **Draft Order stage** (for Committed leads who already gave full details): add order status **`DRAFT`** before `CONFIRMED`.
    - From a lead (or the order form), SE can save a full order (recipient details, address, items, amounts) as DRAFT — no advance payment required to save.
    - DRAFT orders: **no stock reserve, no invoice, excluded from sales/collection reports** — they are not sales yet.
    - When the advance payment arrives, SE opens the draft, records the payment (method + txn ID) → order flips to CONFIRMED via the existing rule (advance > 0), stock reserves, invoice generates — no data re-typing.
    - Lead auto-status: creating a draft sets the lead to `Committed` (linked); confirming the draft flips the lead to `Converted`.
    - Add a **"Pending Payment (Drafts)"** list/tab on the Orders page with aging (e.g. red if older than 24h) so committed-but-unpaid orders never get forgotten. Include a draft→confirm conversion metric in the lead/SE reports.
    - DRAFT orders get a temporary number (e.g. DRAFT-XXXX); the real GV-YYMM-XXXX number is assigned at CONFIRM time so the sales numbering stays clean.

## Orders

1. [FIXED] **Requested Delivery Date** on the order form (and draft orders): the date the customer wants the parcel delivered to the recipient. Three modes via a small selector:
   - **ASAP / Urgent** — deliver as soon as possible
   - **Any day** — no specific date (flexible)
   - **Fixed date** — date picker; must be delivered ON that date (birthdays/anniversaries — can be up to a month+ ahead)
   Show this clearly on the order detail, invoice, packing queue, and shipment/handover screens (Fixed dates highlighted, e.g. 🎯 badge).
2. [FIXED] **Delivery Schedule view** for Packing/Operations (and Admin/Manager): a date-wise section/page showing which deliveries are due on which date —
   - Filter options: **Today, Tomorrow, Next 7 days, This Month, Next Month, Custom date range**
   - **Today's deliveries** (due today, grouped at top)
   - **Tomorrow / upcoming** dates in a separate section, grouped by date
   - ASAP orders always appear in Today's section until handed over; "Any day" orders in a flexible group
   - Sort/filter the packing queue by requested delivery date so the team packs in the right priority order.
   → Fixed: new **`/delivery-schedule`** page (nav under Inventory, gated `orders.pack`). `lib/delivery.ts#buildDeliverySchedule` scopes to pre-courier orders (CONFIRMED + PACKED — "until handed over"), groups by requested date: **Overdue** (past fixed dates), **Today** (today's fixed + all ASAP), **Tomorrow**, each future date, then a **Flexible — Any day** group; each row shows the delivery mode (🎯 fixed date / ASAP / Any day), recipient, items, SE, status. The forward-looking period presets live in the client-safe `lib/delivery-schedule.ts` (shared with the planner) via the `DeliveryPeriodFilter`. The packing queue already sorts ASAP → fixed → flexible (Orders §1); its fixed-date 🎯 badges stay.
3. [FIXED] **Late-risk alert**: an order with a Fixed date of today/tomorrow that is still not PACKED / HANDED_TO_COURIER gets a red warning flag in the queue + a count on the dashboard (e.g. "2 fixed-date deliveries at risk").
   → Fixed: late-risk = FIXED date ≤ tomorrow (Dhaka) still at CONFIRMED (un-packed). Flagged red in the Delivery Schedule (row highlight + "⚠ At risk" badge + per-group + header counts) AND in the **Packing Queue** ("⚠ At risk — deliver soon"). The dashboard shows the count via `countLateRiskDeliveries()` in the shared **`OperationsAlerts`** strip (packing roles), deep-linking the schedule.
4. [FIXED] New Order page — **Relation dropdown**: add an option covering girlfriend/boyfriend discreetly and smartly — label it **"Special One ❤"** (single option that covers both directions; most of the customer base sends to girlfriends). Keep existing options (Wife, Mother, Father, Sibling, Friend…).
5. [FIXED] New Order page — **remove the District and Thana/Upazila fields entirely**. Only the **Full Address** textarea remains (Steadfast only needs the address string).
   - **Customer-facing delivery charge: default FREE (৳0)** — Gift Valy usually absorbs delivery into product pricing. Keep the charge field on the order (editable) for exceptions.
   - Optional **per-product/package delivery charge** field in the catalog (default 0): if set, it auto-adds to the order's delivery charge when that item is added — for future use on specific products.
6a. [FIXED] **Order list — Customer column**: show the customer's phone number between the name and the country (Name → Phone → Country).
6b. [FIXED] **Order list — Recipient column**: show the recipient's phone number below the name.
6c. [FIXED] **Order list — replace the District column with an "Items" column**: shows what was ordered (package/product names). Design it so rows never break/overflow: show the first 1–2 item names as compact badges, then a **"+N more"** chip; hovering (tooltip) or clicking shows the full item list, with the order detail page as the fallback. Plan whatever looks cleanest — the key requirement is the row height stays fixed.
6d. [FIXED] **Notes system — 3 note types per order**: `Order Note` (internal), `Invoice Note` (printed on the invoice — customer visible), `Courier Note` (delivery instructions — this one should be sent as the `note` field to Steadfast on consignment creation).
   - New Order form: all 3 note inputs available (collapsible/tabbed like the reference screenshot)
   - Order list: a **Note column** with an icon/box — clicking opens a modal with 3 tabs (Order Note / Invoice Note / Courier Note) to view and update, matching the provided screenshot design ("View and update your note")
6e. [FIXED] **Order list — Action column**: three actions per row — **View details, Edit, Trash**.
6f. [FIXED] **Order Trash (soft delete)**: a "Trash" tab on the Orders page. Trashed orders sit there for **30 days**, restorable by anyone with permission during that window, then **auto-deleted permanently** after 30 days (scheduled cleanup job). Trashing/restoring writes to the audit log; trashed orders are excluded from all reports/stock reservations (release reserves on trash).
6g. [FIXED] **Status change without opening details**:
   - Single order: the status cell in the list is a dropdown showing only the statuses that order is **eligible** to move to (per the lifecycle rules) — change directly from the list
   - Multi-select: select multiple orders → a "Change status" action offering only the statuses ALL selected orders are eligible for. All existing side effects (stock reserve/deduct, history logging) must still fire exactly as they do from the detail page.
6h. [FIXED] **Bulk invoice print** from the CONFIRMED tab **and** the PACKED tab: multi-select (e.g. 20 orders) → "Print Invoices" → one print job/PDF containing all selected invoices.
6i. [FIXED] **Invoice size = half A4**: redesign the invoice so **2 invoices fit on one A4 page** (A5 landscape halves, cut line between them). Bulk print fills A4 pages two-up automatically.
6j. [FIXED] **Send to Steadfast from CONFIRMED tab too** (not only PACKED): multi-select confirmed orders → Send to Steadfast. This implicitly passes through PACKED — the system must automatically apply the PACKED transition (BOM stock deduction, cost snapshot, history entry) before the handover, so the stock math stays identical. Same for the manual "direct to Handed to Courier" path.
6k. [FIXED] **Handed to Courier tab — 2 new columns**:
   - **Courier/Consignment ID** — Steadfast's consignment_id, auto-filled after API entry
   - **Tracking Link** — clickable link to Steadfast's public tracking page (e.g. https://steadfast.com.bd/tl/XXXX); capture the link/tracking code from the API response at consignment creation and store it on the shipment. Open in new tab.
6l. [FIXED] **In Transit tab — same Consignment ID + Tracking Link columns** as the Handed to Courier tab, PLUS two more columns fetched from Steadfast per parcel:
   - **Steadfast Delivery Charge** — what Steadfast is charging for this consignment. The webhook `delivery_status` payload includes `delivery_charge`; store it on the shipment as soon as any webhook carries it. Also inspect the create-order and status API responses for a charge field and capture it if present.
   - **Steadfast Weight** — the weight Steadfast counted. Check the actual API/webhook responses for a weight field (not in the V1 doc). If absent, **fetch it from the public tracking page**: the page at the parcel's tracking link (e.g. https://steadfast.com.bd/tl/{token}) displays Weight (e.g. "4.9 KG"), COD amount, and current hub — parse the weight from that page server-side (during the polling job or on-demand refresh, cached; be gentle — only for shipments missing weight). Last fallback: our own recorded order weight with an "(ours)" marker.
   - **Tracking link discovery**: the /tl/{token} public link token is NOT in the documented API response (which only returns consignment_id + tracking_code). On the first real consignment creation, log the FULL raw API response — if it contains a tracking link/token field, store and use it. Otherwise construct the public tracking URL from tracking_code if Steadfast's tracking page supports code-based lookup (verify the URL pattern against their /tracking page). Store whichever working link is found on the shipment.
   - Show "—" until data arrives; both values live on the shipment record and feed courier cost in P&L (actual charge overrides the zone+weight estimate).
6m. [FIXED] **In Transit tab restructure — Courier Status + Rider Info + sub-tabs**:
   - **Auto-entry into In Transit**: an order moves Handed to Courier → In Transit AUTOMATICALLY the moment Steadfast receives the parcel at their warehouse (courier status becomes `pending` via webhook/polling; that's also when Steadfast records weight & delivery charge — capture them then).
   - **Remove the current order-status column** in this tab. Add a **Courier Status** column with exactly these 4 values:
     1. **Pending** — parcel received at Steadfast warehouse
     2. **Assigned** — a rider has been assigned
     3. **Delivery Approval Pending** — rider delivered the parcel but the COD hasn't been deposited at the hub / hub manager hasn't approved yet (COD NOT yet added to our Steadfast balance)
     4. **Return/Cancel Approval Pending** — same approval-wait state for cancelled/returned parcels
   - **Rider Info column**: shows "Unassigned" while Pending; when Steadfast assigns a rider, show **rider name + contact number** (courier status flips to Assigned).
   - **Final approval movements**: hub manager approves delivery → Steadfast status `delivered` → order auto-moves In Transit → **Delivered tab** (COD now in Steadfast balance). Approves return/cancel → order auto-moves to **Returned tab**.
   - **Sub-tabs inside the In Transit tab**: 4 sub-tabs named after the 4 courier statuses, each showing its **order count** (e.g. Pending (12) · Assigned (5) · Delivery Approval Pending (3) · Return Approval Pending (1)); clicking a sub-tab filters to only that courier status.
   - **Data sources**: `delivered_approval_pending` / `cancelled_approval_pending` / `pending` / `delivered` / `cancelled` all exist in the polling API statuses — map them directly. **Assigned + rider name/contact are NOT in the documented API** — parse them from the parcel's public tracking page ("Assigned To" section) during the polling job, same gentle scraping approach as weight. If a webhook/API response turns out to carry rider info, prefer that.
6n. [FIXED] **Returned tab restructure — Pending / Received sub-tabs + damage inspection**:
   - Two sub-tabs (with counts): **Pending** and **Received**
   - Returns arrive AUTOMATICALLY from In Transit (return approved at courier) into Returned → **Pending** sub-tab — the parcel is on its way back / not yet in our hands. **No stock changes at this point.**
   - When the courier physically returns the parcel to the Gift Valy warehouse, the **Packaging team** moves it Pending → **Received** — single or multi-select.
   - **Receive-time inspection dialog**: on marking Received, show every item of the order (packages exploded into their BOM products). The inspector marks each item/unit **OK** or **Damaged** — an entire product/package can be selected as damaged, or individual products inside a package:
     - **OK items → automatically added back to sellable stock** (stock movement IN_RETURN) the moment status becomes Received
     - **Damaged items → recorded in a damage log** (product, qty, order ref, date, inspector) — NOT added to sellable stock; damaged value at cost counts as a loss in P&L and appears in a damaged-stock report
   - This receive-inspection flow REPLACES the earlier "Admin approval restores stock" return step — the Packaging team's Received action with inspection IS the approval. Fully audit-logged (who received, what was marked damaged).
7. [FIXED] **Occasion dates & reminders** (repeat-sale engine): _(form fields + customer↔recipient profile schema [FIXED] in C2; Occasions menu, profile editing & reminders shipped in C8)_
   - Order entry form gets two optional date fields for the RECIPIENT: **Birthday** and **Anniversary** — saved permanently against the customer↔recipient profile, not just the order.
   - Customer profile (from the customer list) shows these occasion dates and lets anyone with access **add/edit them at any time** (occasions manageable outside orders too).
   - New separate menu **"Occasions"**: list of upcoming occasions with filters **Today, Tomorrow, Next 7 days, This Month, Custom date range** — each row: customer name + phone/WhatsApp, recipient name, relation, occasion type, date, days remaining, last order info, and a quick "Follow up" action for the SE.
   - **Reminders BEFORE the date**: configurable lead time (default e.g. 7 days before) — the occasion appears in the SE's reminder/follow-up area so the team can proactively pitch the customer ("আপনার প্রিয়জনের birthday আসছে — এবারও gift পাঠাবেন?").
   → Fixed (C8): new **`/occasions`** menu (nav under Sales, gated `orders.view_own`; rows scoped to the customers the viewer's orders reach — SE own / TL team / all). The client-safe **`lib/occasion-constants.ts`** holds the annual-recurrence math (`nextOccurrenceYmd` — next occurrence of a stored month-day, Feb-29 clamps to Feb-28 in non-leap years) and the forward-looking period presets (Today / Tomorrow / Next 7 days / This Month = today→month-end / Custom). **`lib/occasions.ts#buildOccasionWindow`** expands each profile's birthday + anniversary into separate rows whose next occurrence falls in the window, joins the customer's latest order, and sorts soonest-first; each row shows customer + phone, recipient, relation, occasion type, date, **days-remaining** chip, last order, and a **Follow up** button (pre-filled Bangla wa.me pitch). **Profile editing**: order-creating roles get **+ Add occasion** (customer lookup by phone → recipient + dates) and per-row **Edit** (change relation/name/dates; clearing both dates deletes the profile) via `/api/occasions` (POST) and `/api/occasions/[id]` (PATCH/DELETE), fully audit-logged. **Reminders**: `buildOccasionReminders` feeds the **`OccasionRemindersWidget`** on the SE + TL dashboards (occasions within the lead window), with the **configurable lead time** (`occasion_reminder_lead_days`, default 7) set at **Settings → Occasion Reminders** (`/settings/occasions`, `settings.manage`).

## Products & Packages

1. [FIXED] **Non-sellable / packaging-material products**: add a product type flag — **Sellable** vs **Component only** (packaging material):
   - Component-only products (e.g. big shipping carton, chocolate safety box, gift wrap): **no selling price** (price fields hidden/disabled), but they ARE stocked in inventory with purchase cost, low-stock threshold, and can be damaged like any product
   - They can be added to any package's BOM (e.g. Probashi Package BOM = 1 Teddy + 1 Saree combo + 1 Chocolate box + 1 Safety box + 1 Big carton) — their cost counts inside the package cost, and packing a package deducts them from stock like everything else
   - They must **NOT appear** in the order form's item picker (can't be sold standalone), nor in the sellable catalog — but they DO appear in purchases, stock reports, the Delivery Requirement Planner, and the damage log
   - Catalog list gets a filter/badge to tell the two types apart.
2. [FIXED] **Product-level components (packing materials on PRODUCTS, not just packages)**: a sellable product can have its own attached component list — e.g. **Chocolate Box needs 1 Safety Box; Saree Combo needs 1 Combo Box**:
   - Product form gets a "Packing materials" section: add component-only products + qty per unit
   - Selling that product **standalone** → at PACKED, its components deduct from stock too, and their cost is included in the product's effective cost for P&L
   - When the product sits **inside a package**, the BOM explosion automatically pulls in the product's own components as well — so the package BOM should list only the products + package-level materials (big carton), NOT re-list each product's own box, otherwise it would double-count. Migration/UI hint: show the auto-included components read-only inside the package BOM view so the team can see the full explosion
   - Requirement Planner, stock reports, and damage inspection all work off the fully exploded list (product + its components + package-level materials).
3. [FIXED] **Product & Package forms — optional Weight + zone-wise Delivery Charge fields**:
   - **Weight** (kg/g, optional): on products; package weight auto-sums from BOM (incl. components) but stays editable/overridable
   - **Delivery Charge (optional, customer-facing)**: THREE values per product/package — **Inside Dhaka / Sub Dhaka / Outside Dhaka**. Default all 0 (= free delivery, the usual case)
   - On the order form: a recipient **zone selector** (3 zones); if any ordered item has zone charges set, the order's delivery charge auto-fills from the matching zone (multiple charged items → sum; still editable per order). This supersedes the earlier single per-product delivery-charge note in Orders item 5.
4. [FIXED] **BOM quantity must drive cost + stock everywhere** (verify & fix if not already so): when building a package BOM, each line has a product + **quantity input** (e.g. KitKat × 5). Everything must scale by that qty:
   - Package cost auto-calc = Σ (component avg cost × qty) — updates live as qty is typed in the package form
   - Packing one package deducts qty × units from stock (5 KitKats per package; 3 packages = 15)
   - Package availability = min over components of (stock ÷ qty required)
   - Requirement Planner, damage inspection, and package weight auto-sum all multiply by the BOM qty
   - Same rule for product-level components (e.g. 2 Safety Boxes per Chocolate Box if ever needed).
5. [FIXED] **Nested packages (combo packages) + variant choices**:
   - **A package BOM line can be a PRODUCT or another PACKAGE** (sub-package). Example:
     - "Chocolate Box" package = Safety Box + Wishing Card + Dairy Milk × 5 + KitKat × 6 …
     - "Saree Box" package = its own item list
     - **"Probashi Combo Package" = Chocolate Box (package) + Saree Box (package) + Teddy + Big Carton**
   - Sub-packages stay independently sellable (Chocolate Box sells alone too) — editing the Chocolate Box recipe automatically updates every combo that contains it (single source of truth)
   - **Recursive explosion** for everything: cost, weight, stock deduction at packing, availability (min across the whole tree), Requirement Planner, damage inspection. Prevent cycles (a package can never contain itself, directly or indirectly) and cap nesting at 2–3 levels
   - **Variant / choice slots** (Lal Teddy vs Pink Teddy): a BOM line can also be a **CHOICE group** — "choose 1 from: [Red Teddy, Pink Teddy]" (with a default marked). At order entry, when a package containing choice groups is added, the SE is prompted to pick each choice; the chosen variant is stored on the order item, shown on the packing queue/order detail, and its stock is what gets reserved/deducted
   - Cost/P&L uses the actually chosen variant's cost; catalog/estimate views use the default option. Package availability shows with the default, with per-variant availability visible in the package detail.

## Stock / Purchase

1. [FIXED] **Delivery Requirement Planner** (purchase planning — for Admin, Manager, Accounts, Owner): a screen using the SAME date filters as the Delivery Schedule (Today, Tomorrow, Next 7 days, This Month, Next Month, Custom). For all orders (CONFIRMED + PACKED not yet handed over; optionally include DRAFT with a toggle) whose requested delivery falls in the selected period:
   - Compute total **required packages and products** (explode packages into products via BOM)
   - Compare against current stock and show per product: **required qty, in-stock qty, shortage qty**
   - Status per row: ✅ enough / ⚠ short by X pcs
   - For every short product show **unit buying price (current avg cost, editable estimate) × shortage = purchase amount needed**, plus a **grand total: "এই period-এর delivery দিতে হলে purchase-এ কত টাকা লাগবে"**
   - One-click: generate a **purchase requisition list** (product, shortage qty, est. cost) that can be printed/exported or pre-fills the purchase entry form
   - Be careful not to double-count: stock already reserved by the same period's confirmed orders counts as available for them — requirement math must compare period demand vs on-hand correctly.
   → Fixed: new **`/stock/requirement-planner`** page (nav under Inventory, gated `purchases.create` — a cost-privileged role by design). `lib/requirement-planner.ts#buildRequirementPlan` explodes every fixed-in-window + ASAP order (CONFIRMED + PACKED, DRAFT via the toggle) through the BOM engine to stock-tracked leaves (components included), and per product shows **Required / In stock / Shortage / editable unit cost / purchase amount**, with a grand total in Bangla. **No double-counting**: it compares against raw physical `stock_qty` (which still holds CONFIRMED orders' reserved-but-on-shelf units — "reserved counts as available for them"), and adds back the stock PACKED orders already deducted (the `+N packed` note) so a packed order nets zero shortage. Editing a unit cost recomputes the amounts + total live. One-click requisition = **Download CSV**, **Print**, or **Pre-fill purchase entry** (hands the short products to the New Purchase dialog via sessionStorage: qty = shortage, cost = the estimate).

## Courier / Shipments

1. [FIXED] **Courier COST calculation by zone + weight** (this is what WE pay the courier — separate from the customer-facing delivery charge, which is usually free):
   - Replace district-based zone charges with a simple 3-zone rate table per courier: **Inside Dhaka / Sub Dhaka (Dhaka suburbs) / Outside Dhaka**, each with a base rate + per-kg rate (configurable in courier settings)
   - Add an optional **weight (kg/gram) field on products** (and auto-sum for packages via BOM); order weight = sum of items, editable at handover
   - At handover/shipment entry: select zone (3 options) + weight (pre-filled from items) → **courier cost auto-calculated** and saved as the shipment's expected cost
   - When the Steadfast webhook later sends the actual `delivery_charge`, it overrides the estimate as `courier_cost_actual` (P&L always uses actual when available, else the estimate)
2. [FIXED] **Simplify the Courier menu — Steadfast only**:
   - Remove the multi-courier setup entirely for now: **no "Courier companies" CRUD, no "Returns" submenu, no "Shipments" submenu** under Courier (returns now live in Orders → Returned tab; shipment info lives in the order tabs' columns)
   - The Courier page itself = the **Steadfast Integration** page (move it here from Settings): API key + secret, Test Connection, balance, webhook Callback URL + Bearer token, "last webhook received", Sync Now
   - Plus the **zone rate config** on the same page: Inside Dhaka / Sub Dhaka / Outside Dhaka — base + per-kg rates (used for courier cost estimates per the new plan)
   - Keep the underlying schema multi-courier-capable (courier table stays) so other couriers can be added later without a rebuild — just don't show UI for adding them now.

## Payments / Collection
_(এখনো কিছু নেই)_

## Expenses
_(এখনো কিছু নেই)_

## Targets & Rewards
_(এখনো কিছু নেই)_

## Attendance
_(এখনো কিছু নেই)_

## Reports
_(এখনো কিছু নেই)_

## Users / Settings
_(এখনো কিছু নেই)_

---

## ROUND 1.5 — Post-C6 fixes (run BEFORE continuing to C7)

R1. [FIXED] [CHANGE] **Sync Now buttons on order tabs**: add a "Sync Now" button (same behavior as the one on the Steadfast Courier page) to the **Handed to Courier** tab and the **In Transit** tab — clicking syncs the Steadfast status/data of the orders currently in that tab (with a spinner + "last synced" hint).
   → Fixed: `runSteadfastPoll` gained `{ statuses, force }`; the tab button POSTs `/api/couriers/steadfast/sync` scoped to that tab's status and forced past the poll interval, with a spinning `RefreshCw` and a "Last synced …" line fed by `courier_integrations.last_sync_at`.

R2. [FIXED] [BUG] **Courier Status jumps to Assigned too early**: parcels received at the Steadfast warehouse show Courier Status **Assigned** even though NO rider is assigned yet (Rider Info empty). Correct behavior: warehouse receive → **Pending**; flip to **Assigned** ONLY when a rider is actually detected (rider name/contact parsed from the tracking page, or from API data). Audit the status mapping logic — likely the API `pending` status or a tracking-page event is being mis-mapped to Assigned.
   → Fixed: `pending` still maps to sub-state PENDING; ASSIGNED now requires a REAL rider (name AND contact) via `realRider()`, enforced in `ingestDeliveryStatus`, in `fetchPublicTracking` (a bare name/hub is dropped) and in the tracking-page flip. ASSIGNED is never stored without matching rider info, and the ratchet only holds ASSIGNED when a rider is on record. Belt-and-suspenders: `displayedCourierStatus()` renders/filters/counts any ASSIGNED-without-rider row as Pending, so the exact symptom can't render. Regression-tested in `verify:steadfast`.

R3. [FIXED] [BUG] **Steadfast delivery charge not appearing in the In Transit tab**: the charge Steadfast counted is not populating the Steadfast Delivery Charge column. Debug the capture path (webhook `delivery_charge`, API responses, tracking-page parse) — the value must land on the shipment and render in the column as soon as Steadfast has it.
   → Fixed: root cause — the charge was only captured from the delivered-webhook; the status API (`{status, delivery_status}`) never carries it and the tracking-page parse ignored it, so an In Transit parcel showed "—" until delivery. Now `fetchPublicTracking` extracts the charge and the poll writes it to `courier_cost_actual` (new `wantsCharge` gate, cached like the weight, never clobbering a webhook value). `DELIVERY_CHARGE_KEY` broadened + case-insensitive (`delivery_charge`/`total_delivery_charge`/`delivery_fee`/…), so any spelling in any response is mined. Regression-tested.

R4. [FIXED] [CHANGE] **Ours vs Steadfast comparison display**: for each In Transit shipment show BOTH sides clearly: **Our estimate** (order weight from items + zone-rate calculated delivery charge = "এই percel-এর weight X kg, charge ৳Y হওয়ার কথা") and **Steadfast actual** (their counted weight + their charge). Show as two sub-values in the Weight and Delivery Charge columns (e.g. "Ours: 2.5kg / SF: 2.9kg") with a highlight when Steadfast's number exceeds ours by more than a configurable tolerance — so overcharging is caught instantly.
   → Fixed: the Weight and SF-Charge columns now render "Ours: … / SF: …" (`OursVsSf`); the SF line turns red with a ⚠ when `isOvercharged()` fires (SF > ours × (1 + tol%)). Tolerance is Admin-configurable on the Courier page (settings key `courier_overcharge_tolerance_pct`, default 10%). The "…হওয়ার কথা" estimate is the row's title/tooltip. Charge comparison stays cost-gated per role.

R5. [FIXED] [CHANGE] **Admin manual status overrides** (for when Steadfast has issues and statuses must be corrected by hand):
   - Admin can **Trash an order from ANY status**
   - Admin can manually move **Handed to Courier → In Transit, Delivered, or Cancelled**
   - Admin can manually move **In Transit → Delivered or Cancelled**
   - These manual moves fire all the normal side effects (stock, COD reconciliation queue, history) and are clearly marked in the order history as "manual override by <admin>" — Admin (or a dedicated permission) only.
   → Fixed: new **`orders.courier_override`** permission (seeded Admin-only; the RBAC layer auto-grants Admin every permission row — migration `20260718000000`). On the Handed to Courier / In Transit tabs a ⚠ (ShieldAlert) row action opens the courier-stage targets (In Transit / Delivered / Returned-Cancelled), routed through the existing `PATCH /api/shipments/[id]` with `manualOverride:true` → same `applyShipmentStatus` side effects (stock, COD reconciliation queue via DELIVERED, history), and the history note reads **"Manual override by &lt;admin&gt;"**. Trash-from-any-status: the trash route lets an override holder past `TRASHABLE_STATUSES` (physically-out stock stays deducted; a dialog warns; audit action `order.trash_override`). "Cancelled" in the courier world = **Returned** (parcel comes back), which then flows through the normal return-receive inspection.

R6. [FIXED] [CHANGE] **Time-in-status tracking for In Transit (stuck-parcel detection)**:
   - Track timestamps of every courier-status entry (already logged in shipment history) and show two durations per In Transit parcel:
     - **Total time in In Transit** (since warehouse receive) — e.g. "৫ দিন ৩ ঘণ্টা"
     - **Time in CURRENT courier sub-status** (Pending/Assigned/Delivery Approval Pending/Return Approval Pending) — e.g. "Assigned-এ ২ দিন"
   - Show both as a Duration column (compact: "5d 3h · this status 2d") in the In Transit tab and its sub-tabs
   - **Sort + filter by duration**: sort longest-first, and a quick filter like "stuck more than X days" (X input, default 3) to instantly list parcels sitting too long in any status
   - Color escalation: duration badge turns amber past a configurable threshold, red past a higher one (defaults e.g. 3d / 5d, editable on the Courier page)
   - A small "stuck parcels" count on the In Transit tab header (and optionally the dashboard) so long-pending deliveries are impossible to miss.
   → Fixed: two new shipment clocks (migration `20260718010000`) — **`in_transit_at`** (set at the single choke point `applyShipmentStatus` on the first move to In Transit → total time) and **`courier_status_at`** (re-stamped by `ingestDeliveryStatus` + the tracking-page rider flip whenever the courier sub-status changes → time in current status); existing rows backfilled from `order_status_history`. `courier-constants.ts` gained `formatDuration()` / `daysSince()` / `stuckLevel()`. The In Transit tab shows a **Duration** column ("5d 3h · this status 2d", amber→red by the current-sub-status age), a **"⚠ N stuck"** header count (≥ amber days), a **"Stuck more than X days"** filter (default = amber threshold) and a **longest-first sort** (`sort=stuck`, forced by the filter). Amber/red thresholds are Admin-configurable on the Courier page (settings `courier_stuck_amber_days` / `courier_stuck_red_days`, defaults 3d/5d). The dashboard carries the same stuck count (deep-links the filter). Durations compute against a server-provided `nowMs` so SSR and hydration agree.

R7. [FIXED] [CHANGE] **Courier info block on the Order Details page**: all the courier data currently visible only as list columns must also appear in a "Courier / Shipment" section on the order details page — **Consignment ID, tracking link (clickable), courier status + rider info, Steadfast's counted weight & delivery charge, our estimated weight & delivery charge (Ours vs SF side by side with the same overcharge highlight), time-in-status durations (R6), and the shipment status timeline** (tracking events already stored). One glance at an order's details = the full courier picture.

R8. [CHANGE] **Steadfast Payments sync — automatic COD reconciliation** (data source: `GET /payments` and `GET /payments/{payment_id}` from the Steadfast V1 API — the payment invoice contains: Amount Delivered, Payable Delivery Charge, COD Charge, Available Balance, and the list of cleared consignments with per-parcel COD + bill):
   - Poll `GET /payments` (with the hourly poller + a "Sync payments" button on the Courier page); store each payment: Steadfast payment id/invoice no (e.g. SFC-30699149), date, status (**processing / paid**), amount delivered, payable delivery charge, COD charge, net amount
   - For each new/updated payment, fetch `GET /payments/{payment_id}` → its consignments → **match `consignment_id` to our shipments** and AUTO-reconcile: create the COD_COURIER payment row on each matched order (per-parcel COD from the payload), set cod_received, and post the ACTUAL per-parcel delivery charge (the "bills" value) as courier_cost_actual + the COD fee expense — replacing estimates with real numbers
   - Unmatched consignments (not in our system) → flagged list for manual review; already-reconciled orders are skipped (idempotent)
   - **UI — "Steadfast Payments" section on the Courier page**: payment list (date, invoice no, status badge processing/paid, parcels count, net amount) + detail view mirroring their invoice breakdown; a **"Paid today/this range: ৳X (N parcels)"** summary, and a dashboard line under Courier Balance showing the latest payout
   - Wallet link: when a payment is `paid`, record the net amount as an incoming transfer to the linked bank wallet (so wallet running balances stay true)
   - **"Request Payment" shortcut button** next to the Courier Balance (Courier page + dashboard widget): visible/enabled only when the Steadfast balance is > 0 — opens the Steadfast merchant panel's payment request page in a new tab (no payment-request API exists in their documented V1, so this is a deep-link shortcut; the request itself is made in their panel, and our /payments sync picks up the resulting processing → paid record automatically)
   - **Sync button on the dashboard's Total Collection widget**: a small refresh icon that triggers the Steadfast payments sync and refreshes the widget — so after a payout the owner can pull the latest Courier COD figures instantly without leaving the dashboard
   - **Accounting note**: the Courier COD line in Total Collection shows the GROSS per-order COD amounts (e.g. ৳18,300) — the delivery charge (৳955) and COD fee (৳173) post as expenses, and only the NET (৳17,172) lands in the bank wallet. Collection, expenses, and wallet must each carry their own correct number.
   → Fixed: the order-detail serializer now carries the tracking URL, our + Steadfast weight, our estimate + actual charge (both COSTS — cost-visible roles only) and the R6 duration clocks, alongside the consignment id / rider / timeline it already had. The **Courier / Shipment** card was rebuilt: Consignment ID, a clickable **tracking link**, courier status (via `displayedCourierStatus`) + rider, a **`CourierCompare`** "Ours: … / SF: …" pair for both **Weight** and **Courier charge** (Steadfast's figure goes red ⚠ past the Admin overcharge tolerance — shared `isOvercharged`), a **Time in transit** line ("5d 3h · this status 2d", amber→red by the same stuck thresholds as R6), and the existing tracking-event timeline + Steadfast flags. Cost gating: weights show to everyone, the charge comparison + estimate only to cost-visible roles.

**Verification** — how to test each:
- **R1**: On the Handed to Courier / In Transit tab click **Sync now** — spinner runs, toast reports "N parcels checked, M updated", the "Last synced …" line updates. Needs `courier.manage` + an enabled integration.
- **R2 (simulate the rider transition)**: Take an In Transit parcel (or push one there via a `pending` webhook/poll). While Steadfast's tracking page has **no rider**, it sits under the **Pending** sub-tab, badge "Pending", Rider Info "Unassigned". To simulate the flip without a live rider, POST the webhook with a real rider block: `{"notification_type":"delivery_status","consignment_id":<CID>,"status":"pending","rider":{"name":"Karim","phone":"01711111111"}}` (Bearer webhook token) — or set `shipments.rider_name`+`rider_phone`+`courier_status='ASSIGNED'` directly. It then moves to the **Assigned** sub-tab with the rider shown. A name-only rider (no phone) is rejected and stays Pending. `npm run verify:steadfast` covers the whole ladder.
- **R3**: With no delivered-webhook yet, run **Sync now** on In Transit; once Steadfast's tracking page reports the charge it lands in the SF-Charge column. To simulate: send a webhook/poll payload carrying `delivery_charge` (or `total_delivery_charge`) → the column fills immediately. (`courier_cost_actual` also still fills from the delivered webhook.)
- **R4**: Set the tolerance on the Courier page (e.g. 10%). An In Transit row shows "Ours: X / SF: Y" in both Weight and SF-Charge; when SF exceeds ours beyond the tolerance the SF value goes red with ⚠.
- **R5**: As Admin, on a Handed to Courier / In Transit row use the ⚠ action to move status (add an optional reason) → order history shows "Manual override by &lt;you&gt;"; a Delivered override drops the order into the COD reconciliation queue. Trash any courier-stage/delivered order from the row's trash icon (warned + audit-logged). A Manager (no override permission) sees neither control and is blocked by the API.
- **R6**: Open **Orders → In Transit**. Each row's **Duration** column shows total-in-transit + "this status …"; older parcels go amber then red (seeded orders span both). The header shows **"⚠ N stuck"**; set the amber/red thresholds on the **Courier** page (Stuck-parcel escalation) and reload to see the colours/count shift. Type a number in **"Stuck more than X days" → Filter** to narrow the tab to long-sitting parcels (auto-sorted longest-first); the **Duration** header toggles longest-first sort on its own. The **dashboard** (Admin/Manager/Accounts/Packing) shows the same stuck count, linking straight to the filtered tab.
- **R7**: Open any handed-over/In-Transit order's **details** → the **Courier / Shipment** card shows Consignment ID, a clickable tracking link, courier status + rider, **Weight (ours / SF)** and (cost-visible roles) **Courier charge (ours / SF)** with the red ⚠ overcharge highlight past the tolerance, a **Time in transit** line with the amber/red escalation, and the tracking timeline. Log in as a Sales Executive: the charge comparison + estimate are absent (weights still show).
