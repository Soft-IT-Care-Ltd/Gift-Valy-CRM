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

---

## Dashboard

> Keep ALL existing dashboard widgets as they are — the following are ADDITIONS. All new widgets must respect the existing date-range switch (Today / Week / Month / Custom).

1. [CHANGE] Add a **Leads** widget: total lead count for the selected date range.
2. [CHANGE] Add an **Orders** widget: total order count (quantity) for the selected range.
3. [CHANGE] Add a **Delivered** widget: delivered order **count + total amount (৳)** for the selected range.
4. [CHANGE] Add an **Advance Collection** widget: number of advance payments + total advance amount (৳) for the selected range (payment type = ADVANCE).
5. [CHANGE] Add a **Total Collection** widget **with breakdown by payment source**. Breakdown lines: **Advance** (type ADVANCE/PARTIAL), **Courier COD** (type COD_COURIER), **Post-delivery bKash/MFS** (type POST_DELIVERY_MFS — this happens when the customer pays the due via bKash after the parcel is shipped and the courier COD is set to 0). Show each source's amount + the grand total. Sometimes only 2 sources have values, sometimes all 3 — always show whichever are non-zero (or all 3 with 0 values, whichever looks cleaner).
6. [CHANGE] Add a **Courier Balance** widget: current Steadfast balance via the existing /get_balance integration (with a small refresh icon; show "—" if integration disabled).
7. [CHANGE] Add a **Draft Orders (Pending Payment)** widget: DRAFT order **count + total amount (৳)** for the selected date range — this is the committed-but-unpaid pipeline (see Leads item 10). Clicking it goes to the Orders page "Pending Payment (Drafts)" tab.

## Leads

1. [CHANGE] Lead entry form field order: **WhatsApp number input comes FIRST**, then Country.
2. [CHANGE] **Country auto-detection**: when a WhatsApp number is typed with a country code (e.g. +966…), auto-select the matching country. Must remain manually changeable afterward. Default (before/without detection) = **KSA**.
3. [CHANGE] Pre-filled defaults on the lead entry form (all editable):
   - Status = **New** (already exists — keep)
   - Country = **KSA**
   - Source = **WhatsApp**
   - Follow-up date = **entry date + 1 day** (editable)
4. [CHANGE] Lead list: default filter is currently ALL TIME which loads too much — change default to **This Month**. Add **pagination**: page-size selector (25 / 50 / 100 rows) + page navigation.
5. [UI] "Today's follow-ups: 0" and "Overdue: 6 — follow up now" currently look like buttons, but they are notices — redesign them as notice/alert badges (info style for today's follow-ups, warning/red style for overdue), clearly not clickable-button styled. Keep the "follow up now" link behavior if it navigates somewhere.
6. [CHANGE] Verify that everywhere a total lead count is shown (dashboard widget, lead report, conversion rate), the total = individual lead entries + bulk daily-count entries (lead_daily_counts) combined. E.g. 10 manual + 30 bulk on the same day must show 40 for that day.
7. [CHANGE] Restructure the Leads page like the Orders page: landing page = the lead LIST. A **"New Lead"** button at the top-right opens a separate lead entry page. Users who have the bulk-entry permission see **two** buttons: "New Lead" and "Bulk Lead" (separate bulk entry page). Users without bulk permission see only "New Lead".
8. [CHANGE] **Assign-on-entry**: users with the lead-assign permission get an "Assign to" select at the END of the New Lead form — default = their own name, but they can pick another SE while entering. Users WITHOUT the assign permission don't see this field at all (lead auto-assigns to themselves).
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
2. [CHANGE] **Delivery Schedule view** for Packing/Operations (and Admin/Manager): a date-wise section/page showing which deliveries are due on which date —
   - Filter options: **Today, Tomorrow, Next 7 days, This Month, Next Month, Custom date range**
   - **Today's deliveries** (due today, grouped at top)
   - **Tomorrow / upcoming** dates in a separate section, grouped by date
   - ASAP orders always appear in Today's section until handed over; "Any day" orders in a flexible group
   - Sort/filter the packing queue by requested delivery date so the team packs in the right priority order.
3. [CHANGE] **Late-risk alert**: an order with a Fixed date of today/tomorrow that is still not PACKED / HANDED_TO_COURIER gets a red warning flag in the queue + a count on the dashboard (e.g. "2 fixed-date deliveries at risk").
4. [FIXED] New Order page — **Relation dropdown**: add an option covering girlfriend/boyfriend discreetly and smartly — label it **"Special One ❤"** (single option that covers both directions; most of the customer base sends to girlfriends). Keep existing options (Wife, Mother, Father, Sibling, Friend…).
5. [FIXED] New Order page — **remove the District and Thana/Upazila fields entirely**. Only the **Full Address** textarea remains (Steadfast only needs the address string).
   - **Customer-facing delivery charge: default FREE (৳0)** — Gift Valy usually absorbs delivery into product pricing. Keep the charge field on the order (editable) for exceptions.
   - Optional **per-product/package delivery charge** field in the catalog (default 0): if set, it auto-adds to the order's delivery charge when that item is added — for future use on specific products.
6a. [CHANGE] **Order list — Customer column**: show the customer's phone number between the name and the country (Name → Phone → Country).
6b. [CHANGE] **Order list — Recipient column**: show the recipient's phone number below the name.
6c. [CHANGE] **Order list — replace the District column with an "Items" column**: shows what was ordered (package/product names). Design it so rows never break/overflow: show the first 1–2 item names as compact badges, then a **"+N more"** chip; hovering (tooltip) or clicking shows the full item list, with the order detail page as the fallback. Plan whatever looks cleanest — the key requirement is the row height stays fixed.
6d. [FIXED] **Notes system — 3 note types per order**: `Order Note` (internal), `Invoice Note` (printed on the invoice — customer visible), `Courier Note` (delivery instructions — this one should be sent as the `note` field to Steadfast on consignment creation).
   - New Order form: all 3 note inputs available (collapsible/tabbed like the reference screenshot)
   - Order list: a **Note column** with an icon/box — clicking opens a modal with 3 tabs (Order Note / Invoice Note / Courier Note) to view and update, matching the provided screenshot design ("View and update your note")
6e. [CHANGE] **Order list — Action column**: three actions per row — **View details, Edit, Trash**.
6f. [CHANGE] **Order Trash (soft delete)**: a "Trash" tab on the Orders page. Trashed orders sit there for **30 days**, restorable by anyone with permission during that window, then **auto-deleted permanently** after 30 days (scheduled cleanup job). Trashing/restoring writes to the audit log; trashed orders are excluded from all reports/stock reservations (release reserves on trash).
6g. [CHANGE] **Status change without opening details**:
   - Single order: the status cell in the list is a dropdown showing only the statuses that order is **eligible** to move to (per the lifecycle rules) — change directly from the list
   - Multi-select: select multiple orders → a "Change status" action offering only the statuses ALL selected orders are eligible for. All existing side effects (stock reserve/deduct, history logging) must still fire exactly as they do from the detail page.
6h. [CHANGE] **Bulk invoice print** from the CONFIRMED tab **and** the PACKED tab: multi-select (e.g. 20 orders) → "Print Invoices" → one print job/PDF containing all selected invoices.
6i. [CHANGE] **Invoice size = half A4**: redesign the invoice so **2 invoices fit on one A4 page** (A5 landscape halves, cut line between them). Bulk print fills A4 pages two-up automatically.
6j. [CHANGE] **Send to Steadfast from CONFIRMED tab too** (not only PACKED): multi-select confirmed orders → Send to Steadfast. This implicitly passes through PACKED — the system must automatically apply the PACKED transition (BOM stock deduction, cost snapshot, history entry) before the handover, so the stock math stays identical. Same for the manual "direct to Handed to Courier" path.
6k. [CHANGE] **Handed to Courier tab — 2 new columns**:
   - **Courier/Consignment ID** — Steadfast's consignment_id, auto-filled after API entry
   - **Tracking Link** — clickable link to Steadfast's public tracking page (e.g. https://steadfast.com.bd/tl/XXXX); capture the link/tracking code from the API response at consignment creation and store it on the shipment. Open in new tab.
6l. [CHANGE] **In Transit tab — same Consignment ID + Tracking Link columns** as the Handed to Courier tab, PLUS two more columns fetched from Steadfast per parcel:
   - **Steadfast Delivery Charge** — what Steadfast is charging for this consignment. The webhook `delivery_status` payload includes `delivery_charge`; store it on the shipment as soon as any webhook carries it. Also inspect the create-order and status API responses for a charge field and capture it if present.
   - **Steadfast Weight** — the weight Steadfast counted. Check the actual API/webhook responses for a weight field (not in the V1 doc). If absent, **fetch it from the public tracking page**: the page at the parcel's tracking link (e.g. https://steadfast.com.bd/tl/{token}) displays Weight (e.g. "4.9 KG"), COD amount, and current hub — parse the weight from that page server-side (during the polling job or on-demand refresh, cached; be gentle — only for shipments missing weight). Last fallback: our own recorded order weight with an "(ours)" marker.
   - **Tracking link discovery**: the /tl/{token} public link token is NOT in the documented API response (which only returns consignment_id + tracking_code). On the first real consignment creation, log the FULL raw API response — if it contains a tracking link/token field, store and use it. Otherwise construct the public tracking URL from tracking_code if Steadfast's tracking page supports code-based lookup (verify the URL pattern against their /tracking page). Store whichever working link is found on the shipment.
   - Show "—" until data arrives; both values live on the shipment record and feed courier cost in P&L (actual charge overrides the zone+weight estimate).
6m. [CHANGE] **In Transit tab restructure — Courier Status + Rider Info + sub-tabs**:
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
6n. [CHANGE] **Returned tab restructure — Pending / Received sub-tabs + damage inspection**:
   - Two sub-tabs (with counts): **Pending** and **Received**
   - Returns arrive AUTOMATICALLY from In Transit (return approved at courier) into Returned → **Pending** sub-tab — the parcel is on its way back / not yet in our hands. **No stock changes at this point.**
   - When the courier physically returns the parcel to the Gift Valy warehouse, the **Packaging team** moves it Pending → **Received** — single or multi-select.
   - **Receive-time inspection dialog**: on marking Received, show every item of the order (packages exploded into their BOM products). The inspector marks each item/unit **OK** or **Damaged** — an entire product/package can be selected as damaged, or individual products inside a package:
     - **OK items → automatically added back to sellable stock** (stock movement IN_RETURN) the moment status becomes Received
     - **Damaged items → recorded in a damage log** (product, qty, order ref, date, inspector) — NOT added to sellable stock; damaged value at cost counts as a loss in P&L and appears in a damaged-stock report
   - This receive-inspection flow REPLACES the earlier "Admin approval restores stock" return step — the Packaging team's Received action with inspection IS the approval. Fully audit-logged (who received, what was marked damaged).
7. [CHANGE] **Occasion dates & reminders** (repeat-sale engine): _(form fields + customer↔recipient profile schema [FIXED] in C2; Occasions menu, profile editing & reminders arrive with C8)_
   - Order entry form gets two optional date fields for the RECIPIENT: **Birthday** and **Anniversary** — saved permanently against the customer↔recipient profile, not just the order.
   - Customer profile (from the customer list) shows these occasion dates and lets anyone with access **add/edit them at any time** (occasions manageable outside orders too).
   - New separate menu **"Occasions"**: list of upcoming occasions with filters **Today, Tomorrow, Next 7 days, This Month, Custom date range** — each row: customer name + phone/WhatsApp, recipient name, relation, occasion type, date, days remaining, last order info, and a quick "Follow up" action for the SE.
   - **Reminders BEFORE the date**: configurable lead time (default e.g. 7 days before) — the occasion appears in the SE's reminder/follow-up area so the team can proactively pitch the customer ("আপনার প্রিয়জনের birthday আসছে — এবারও gift পাঠাবেন?").

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

1. [CHANGE] **Delivery Requirement Planner** (purchase planning — for Admin, Manager, Accounts, Owner): a screen using the SAME date filters as the Delivery Schedule (Today, Tomorrow, Next 7 days, This Month, Next Month, Custom). For all orders (CONFIRMED + PACKED not yet handed over; optionally include DRAFT with a toggle) whose requested delivery falls in the selected period:
   - Compute total **required packages and products** (explode packages into products via BOM)
   - Compare against current stock and show per product: **required qty, in-stock qty, shortage qty**
   - Status per row: ✅ enough / ⚠ short by X pcs
   - For every short product show **unit buying price (current avg cost, editable estimate) × shortage = purchase amount needed**, plus a **grand total: "এই period-এর delivery দিতে হলে purchase-এ কত টাকা লাগবে"**
   - One-click: generate a **purchase requisition list** (product, shortage qty, est. cost) that can be printed/exported or pre-fills the purchase entry form
   - Be careful not to double-count: stock already reserved by the same period's confirmed orders counts as available for them — requirement math must compare period demand vs on-hand correctly.

## Courier / Shipments

1. [CHANGE] **Courier COST calculation by zone + weight** (this is what WE pay the courier — separate from the customer-facing delivery charge, which is usually free):
   - Replace district-based zone charges with a simple 3-zone rate table per courier: **Inside Dhaka / Sub Dhaka (Dhaka suburbs) / Outside Dhaka**, each with a base rate + per-kg rate (configurable in courier settings)
   - Add an optional **weight (kg/gram) field on products** (and auto-sum for packages via BOM); order weight = sum of items, editable at handover
   - At handover/shipment entry: select zone (3 options) + weight (pre-filled from items) → **courier cost auto-calculated** and saved as the shipment's expected cost
   - When the Steadfast webhook later sends the actual `delivery_charge`, it overrides the estimate as `courier_cost_actual` (P&L always uses actual when available, else the estimate)
2. [CHANGE] **Simplify the Courier menu — Steadfast only**:
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
