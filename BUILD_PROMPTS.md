# Gift Valy — Claude Code Build Prompts (Serial Order)

> **ব্যবহারের নিয়ম:**
> 1. এক নম্বর serial-এ একটা prompt দিন → কাজ শেষ হলে নিজে browser-এ test করুন → ঠিক থাকলে পরেরটা দিন
> 2. প্রতি prompt-এর পর নতুন কাজ শুরুর আগে Claude Code-এ `/clear` দিন (context ফ্রেশ থাকবে, quality ভালো হবে)
> 3. কিছু ভাঙলে বা কাজ না করলে: আগে সেটা fix করান ("X is not working, fix it"), তারপর সামনে আগান
> 4. ✅ = already done

---

## PHASE 1 — Core Sales Engine

### ✅ Prompt 1 — Scaffold + Auth + RBAC (DONE)
Scaffold, NextAuth, roles, Users/Teams CRUD — আপনি এটা দিয়ে দিয়েছেন।

### Prompt 2 — Product, Category, Package + BOM
```
Read GIFT_VALY_SOFTWARE_SPEC.md sections 6.1 and 6.2.
Build the Product Catalog and Package modules:
- Category CRUD (Admin/Manager only)
- Product CRUD with all fields from SPEC 6.1 (SKU auto-generated, avg_cost hidden from Sales Executive role at API level)
- Package CRUD with BOM (package_items): add/remove products with qty
- Package cost auto-computed from component avg costs, margin shown to Admin/Manager only
- Package "available to sell" = min over components of (stock ÷ qty required)
Seed 10 demo products and 3 demo packages (e.g., Probashi Premium Package with Teddy + Chocolate Box + Saree + Card + Gift Wrap).
Commit when done and tell me how to test.
```

### Prompt 3 — Customer + Order Entry + Payments
```
Read GIFT_VALY_SOFTWARE_SPEC.md sections 4 (full) and 8.
Build Order Management:
- Customer table with auto-fill for repeat customers (search by foreign phone) + order history display
- Full order entry form exactly per SPEC 4.1: Section A (customer, foreign phone), Section B (recipient, BD phone, district/thana, address, occasion), Section C (items: package or product lines, qty, price with floor check, discount, courier charge, total), Section D (advance payment with method + transaction ID + due auto-calc + COD amount), Section E (auto SE/team)
- Order number format GV-YYMM-XXXX
- Order status lifecycle from SPEC 1.3 with order_status_history logging
- Payments per SPEC section 8: multiple payments per order, transaction_id unique check, due_amount recomputed on every payment write
- Order list page with filters (status, date, SE), Sales Executive sees only own orders
- Edit window rule from SPEC 4.2 (30 min, then TL/Admin approval required)
Commit and tell me how to test, including testing as a Sales Executive login.
```

### Prompt 4 — Invoice PDF + SE Dashboard
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 5.
Build:
- Invoice PDF auto-generated on order confirmation, layout per SPEC 5 (logo placeholder, order/invoice no, customer + country + phone, recipient + BD phone + address, item table, discount, courier charge, grand total, advance paid with method + txn ID, due/COD amount). Amounts in BDT. Make sure Bangla text renders correctly in the PDF (embed Noto Sans Bengali)
- Download + print buttons, and a wa.me WhatsApp share link with pre-filled message
- Invoice versioning: regenerate on approved order edit, keep old versions
- Sales Executive home view: "My orders today", "My sales this month (count + value)", recent orders list
Commit and tell me how to test.
```

### Prompt 5 — Phase 1 Verification
```
Phase 1 verification pass. Do the following and report results:
1. Seed realistic demo data: 5 users (1 per role), 10 products, 3 packages, 15 orders in various statuses with payments
2. Test as Sales Executive login: confirm they CANNOT see any cost/profit fields (check API responses, not just UI), other SEs' orders, or admin pages
3. Test the money math: create an order, add advance, add second payment, verify due_amount is always correct; try entering a duplicate transaction_id (must be rejected)
4. Run the app, list any bugs found and fix them
5. Confirm .env is gitignored, commit everything
```

---

## PHASE 2 — Stock, Courier, Money

### Prompt 6 — Purchase + Stock Engine
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 6.3 and the stock rules in sections 1.3 and 14.
Build the inventory engine:
- Purchase entry (Accounts/Admin): supplier, date, product lines (qty, unit cost) → increases stock, updates weighted-average cost, auto-creates expense record
- stock_movements: every change is an immutable row (IN_PURCHASE, OUT_SALE, RESERVE, RELEASE_RESERVE, IN_RETURN, ADJUST_PLUS, ADJUST_MINUS)
- Stock reserved at order CONFIRMED, deducted at PACKED (package orders deduct each BOM component), released on cancel
- unit_cost_snapshot frozen on order_items at PACKED time
- Manual stock adjust with reason + permission + audit log
- Stock cache column and movements written in one transaction
- Packing Queue page for Packing role: list CONFIRMED orders with BOM pick list, "Mark as PACKED" button
Commit and tell me how to test the full flow: purchase → confirm order → pack → stock check.
```

### Prompt 7 — Stock Reports + Alerts
```
Read GIFT_VALY_SOFTWARE_SPEC.md reports R4 and R5.
Build:
- Stock report: current qty, avg cost, stock value (qty × avg cost), reserved qty, available qty, total stock value; movement history per product
- Low-stock alert list (qty below threshold)
- Package availability report: buildable qty per package
- CSV export for these reports
Commit and tell me how to test.
```

### Prompt 8 — Courier & Delivery
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 7.
Build the courier module:
- Courier companies CRUD with COD fee % and per-district zone charges
- Shipment entry per order: courier, tracking no, handover date, COD amount, expected delivery
- Status updates: HANDED_TO_COURIER → IN_TRANSIT → DELIVERED / RETURNED (syncs order status, timestamps logged)
- COD reconciliation screen for Accounts: bulk "mark COD received", courier COD fee auto-recorded as expense
- Return flow: RETURNED → Admin approval → stock restore + return charge expense
- Courier report R6: pending handover, in-transit, delivered %, returned %, COD pending with courier (order-wise, aging)
Commit and tell me how to test.
```

### Prompt 8.5 — Steadfast API Integration
```
Read STEADFAST_INTEGRATION.md fully and implement the complete Steadfast integration:
1. Settings page: encrypted API key + secret, Test Connection via /get_balance,
   webhook Callback URL display + Bearer token generate/copy/regenerate,
   "last webhook received" indicator
2. Send to Steadfast from the PACKED tab (single + bulk, per spec section 2)
3. Webhook receiver POST /api/webhooks/steadfast per spec section 3A:
   Bearer auth, both notification types, case-insensitive status mapping,
   idempotent handling, tracking timeline
4. Polling fallback per section 3B + manual Sync Now
5. Schema additions per section 4
Write tests that simulate webhook payloads (including replayed duplicates and
wrong tokens). Commit and walk me through the acceptance checklist in section 6.
```
> ⚠ এটা Prompt 8 (Courier module)-এর **পরে** দিতে হবে — shipments table লাগে। Webhook-এর live test deploy-এর পরে হবে; বাকি সব localhost-এই test করা যায়।

### Prompt 9 — Wallets + Payment Verification + Collection
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 8 and report R7.
Build:
- Wallets CRUD (company bKash/Nagad/Rocket/Bank/Cash accounts)
- Every payment linked to a receiving wallet
- Payment verification queue for Accounts: mark verified, unverified flagged
- Collection report R7: by date range, by method, by wallet, verified vs unverified, total dues outstanding with order-wise aging list
- Per-wallet running balance (collections in − expenses out)
Commit and tell me how to test.
```

### Prompt 10 — Expenses + Ad Cost
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 9.1 and report R8.
Build:
- Expense categories CRUD, each flagged FIXED or VARIABLE (seed: Ad Cost, Salary, Rent, Utilities, Packaging Materials, Office, Reward/Bonus, Other)
- Quick daily expense entry screen (under 1 minute): date, category, amount, wallet, optional campaign name for ad cost, notes, receipt upload
- Auto-expenses already created by purchase and courier modules should appear here (read-only, linked)
- Expense report R8: by category, fixed vs variable split, ad cost daily trend chart
Commit and tell me how to test.
```

### Prompt 11 — Phase 2 Verification
```
Phase 2 verification pass:
1. Test full lifecycle with demo data: purchase stock → create order → confirm (reserve) → pack (deduct + cost snapshot) → hand to courier → deliver → COD received → verify all numbers (stock, due, expenses) are correct at each step
2. Test return flow restores stock correctly
3. Test as each role: Packing sees only queue, Accounts sees money screens, Sales Executive still sees no costs
4. Fix any bugs, commit
```

---

## PHASE 3 — Intelligence & HR

### Prompt 12 — Lead Management
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 3.
Build lead management:
- Lead entry form per SPEC 3.1 (quick, under 30 seconds), duplicate phone check with history popup
- Bulk daily count mode (lead_daily_counts)
- Lead statuses with lost reasons, follow-up datetime → reminders on SE dashboard ("Today's follow-ups"), overdue flagged red
- Auto-convert: creating an order from a lead flips it to Converted and links lead_id
- TL/Manager lead reassignment
- Lead report R2: leads by SE/source/campaign/date, conversion %, lost reason breakdown
Commit and tell me how to test.
```

### Prompt 13 — Targets, Leaderboard, Rewards
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 10.
Build:
- Target setting per SE and per Team per month (order count and/or sales value), confidential TL targets visible only to Admin + that TL
- Onboarding users excluded from team aggregates for N days (setting)
- Live progress gauges: SE sees own (achieved/target, %, days left, required daily run-rate), TL sees team, Admin sees all
- Reward rules table (e.g., 100% → 3000, 120% → 6000), month-close computation → Admin approval → creates expense + SE profile history
- Monthly leaderboard visible to all (values only, not others' reward amounts)
Commit and tell me how to test.
```

### Prompt 14 — Attendance
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 11.
Build:
- Check-in / check-out buttons, server-side timestamps
- Office hours + late threshold in settings; auto Late/Absent/Half-day flags
- Simple leave request + approval flow
- Attendance report R10: per employee monthly sheet, team summary
- "Who's in today" widget data for admin dashboard
Commit and tell me how to test.
```

### Prompt 15 — P&L Engine
```
Read GIFT_VALY_SOFTWARE_SPEC.md sections 9.2, 9.3 and report R9.
Build (Admin/Manager only):
- Per-order profit calc exactly per SPEC 9.2 formula (cost snapshots, actual courier cost, packaging cost setting, daily ad-cost allocation)
- Daily summary: date-wise sales, collection, costs, net — table + chart
- Monthly P&L: revenue, COGS, variable costs, fixed costs, net profit, margins, vs previous month
- Audit log viewer for Admin
Commit and tell me how to test with the demo data.
```

### Prompt 16 — Owner Dashboard
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 13.
Build the Owner Dashboard exactly per the 5-row widget layout, with Today/Week/Month/Custom date switch:
Row 1: today's sales, collection, cost, estimated profit
Row 2: MTD sales vs last month chart, MTD net profit, dues outstanding, COD pending
Row 3: order status funnel, stock value + low-stock count, package availability alerts
Row 4: SE leaderboard, team target progress, today's leads + conversion, who's checked in
Row 5: 30-day sales/collection line chart, expense donut, country-wise sales table
Also build the role-based home dashboards: SE (own funnel/target/follow-ups), TL (team), Packing (queue), Accounts (verification queue).
Commit and tell me how to test.
```

### Prompt 17 — Remaining Reports + Phase 3 Verification
```
Read GIFT_VALY_SOFTWARE_SPEC.md section 12.
1. Build any reports from R1–R12 not yet implemented (check R1 sales report, R3 team performance, R11 cancelled/returned analysis, R12 customer report)
2. Add PDF export alongside CSV for all reports
3. Verification pass: test every report with demo data, test every role's scope on every report, fix bugs, commit
```

---

## PHASE 4 — Polish (পরে, software চালু হওয়ার পর)

### Prompt 18 — Courier API
```
Integrate Steadfast courier API: create consignment on shipment entry, webhook for auto status updates (IN_TRANSIT/DELIVERED/RETURNED). Read SPEC section 7. My Steadfast API credentials: <API key>
```

### Prompt 19 — Nice-to-haves
```
Add: (1) WhatsApp invoice auto-send flow, (2) customer-currency display on invoice using Admin-maintained rate table, (3) PWA support so the team can use it like a mobile app. Read SPEC sections 5 and 16 Phase 4.
```

---

## Deploy (Phase 2 শেষ হলেই করতে পারেন)

### Prompt D1 — Production Deploy
```
Deploy this app to production. I want to use <Vercel / আমার VPS>.
Set up: production build, environment variables, database (keep using Neon), and a nightly pg_dump backup script.
Walk me through it step by step.
```

---

**মনে রাখবেন:** প্রতি prompt শেষে Claude Code যা "how to test" বলবে সেটা নিজে করবেন — সব ঠিক থাকলে তবেই পরের serial। কোনো prompt-এ সমস্যা হলে আমাকে error/screenshot পাঠাবেন।
