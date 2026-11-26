# Gift Valy — Round 3: website, category photos, choice prices, packing invoices

**Raised by:** the owner, 25 Nov 2026. **Goes in:** the root of the Gift Valy CRM repo, next to `CORRECTIONS.md`, `FUNNEL_LINER.md` and `PHOTO_PRINT.md`.

> **কীভাবে ব্যবহার করবেন:** নিচের "Build order" এর prompt গুলো **Gift Valy CRM repo** (`Soft-IT-Care-Ltd/Gift-Valy-CRM`) তে, Claude Code এ, একটা একটা করে দিন। প্রতিটার পর `/clear`। প্রতিটা prompt আগে plan দেখাবে — পড়ে OK দিলে তবেই build করবে। শেষ দুটো prompt আগে staging এ, তারপর আপনার OK পেলে live এ দেবে।

How to use this file (for Claude Code):
- The **Build order** section has the prompts; the **Items** (R3-1 …, W-1 …) are the spec.
- When an item is built, mark it `[DONE]` with a one-line note and the commit.
- All rules in `CLAUDE.md` hold — especially rule 6 (`order_sequences` is the billing record; **no test order on production**), rule 7 (`/go/` and `/_c/` belong to the Funnel Liner proxy), rule 8 (no destructive database command without the owner's OK) and rule 9 (never hardcode a host name).
- **The reference implementation for the website is Antu Boutique** (`Soft-IT-Care-Ltd/Antu-Boutique-CRM`): `PRD.md` §4.6a–4.6d, `CORRECTIONS.md` C9/C10, `CORRECTIONS-R3.md`, `app/(store)/`, `components/storefront/`, `lib/storefront/`, `proxy.ts`, `deploy/nginx/`. Follow the same shape, but **copy nothing that doesn't fit Gift Valy**: Gift Valy sells mostly **packages** (BOM + choice groups), its customers are **Bangladeshis abroad** ordering for someone **in Bangladesh**, an order has two phones (customer abroad + recipient in BD), an advance is taken before confirming, and a draft has no GV number until it is confirmed.

---

## What the owner asked for (25 Nov 2026)

1. **Category photo** — a category can have an image. Optional.
2. **Website, like Antu Boutique's** — on `giftvaly.com`. When adding a product (or package) in the Catalog, choose there whether it shows on the website, and every website setting for it is right there, in the same place.
3. **Products and packages that already exist** — their Edit page gets the same website settings.
4. **Packing team can print invoices** — every invoice that can be printed, the Packing team can print too.
5. **Price by choice** — in a choice group inside a package (e.g. a saree package where the customer picks one saree), each option can change the price: Red saree one price, Blue saree another.

## Defaults assumed (owner can change any of these)

| Question | Default |
|---|---|
| Website address | **`giftvaly.com`** and **`www.giftvaly.com`** (www redirects to the bare domain). Staging: **`shop-staging.giftvaly.com`** behind basic auth, `noindex`. The ERP stays on `dashboard.funnelliner.com`. |
| Website language | **English — decided by the owner, 25 Nov 2026.** One copy file (a Bangla version could be added later, not now). Staff-typed content (product names, descriptions) shows exactly as typed, Bangla included. |
| Products already in the catalog | **Shown on the website from day one — decided by the owner, 25 Nov 2026.** Every active SELLABLE product and every active package is switched on by the migration. Photos are added later, one by one, from each item's Edit page; until then the website shows a branded placeholder image. |
| Ordering by WhatsApp | **Decided by the owner, 25 Nov 2026:** an **Order on WhatsApp** button on the website, its number set in **Settings → Website** (no number set = no button). |
| Prices on the website | **Taka (৳)**. Optionally an approximate price in the visitor's chosen currency (SAR, AED, MYR, …) from Gift Valy's existing currency rates, clearly marked "approx." — **off** until switched on in Settings → Website. |
| Payment on the website | **No online payment in this round.** The order arrives as a draft; the Sales Executive contacts the customer on WhatsApp, takes the advance by bKash/Nagad as today, then confirms. The confirmation page says so. (A payment gateway can be a later round.) |
| Which website orders count for the Funnel Liner bill | Exactly the same rule as every order: a website order is a **draft** (`DRAFT-XXXX`) until the SE confirms it; it gets its `GV-` number — and is counted — only then (FUNNEL_LINER.md rule 6). Fake orders never reach the bill. |
| Photos for the Customize Chocolate Box from the website | **Not uploaded on the website in this round.** The product page and the confirmation page say "After you order, send us the 14 photos on WhatsApp"; the SE uploads them in the ERP as today (PHOTO_PRINT.md). |
| Choice price | Each option of a choice group has an **extra price (+ or −, in ৳, default 0)** added to the package price — "Blue saree (+৳300)". |

---

## Build order

| # | Prompt | Runs in | Needs |
|---|---|---|---|
| 1 | R3-0 — Read the reference, plan | Gift Valy repo | — |
| 2 | R3-A — Category photo, choice prices, packing invoices — [DONE] | Gift Valy repo | R3-0 |
| 3 | W1 — Website foundation: host, catalog Website panel, public catalog gate — [DONE] | Gift Valy repo | R3-A |
| 4 | W2 — Website pages: home, category, product/package, search — [DONE] | Gift Valy repo | W1 |
| 5 | W3 — Bag, checkout, website orders in the ERP — [DONE] | Gift Valy repo | W2 |
| 6 | W4 — Settings → Website, home page manager, SEO, Meta Pixel — [DONE] | Gift Valy repo | W3 |
| 7 | Verify R3 — [DONE] | Gift Valy repo | W4 |
| 8 | Deploy R3 — staging, then production | Gift Valy repo, on the server via `ssh antu` | Verify R3 |

### R3-0 — Read the reference, plan (Gift Valy repo)

```
git pull. Read ROUND3.md fully, then CLAUDE.md and AGENTS.md (this Next.js version differs from your training data — read node_modules/next/dist/docs/ before writing proxy, routing or caching code).

Refresh the Antu reference read-only: git -C ../antu-reference pull (clone git@github.com:Soft-IT-Care-Ltd/Antu-Boutique-CRM.git there if missing). Read its PRD.md §4.6a–4.6d, CORRECTIONS.md (C9, C10), CORRECTIONS-R3.md, app/(store)/, components/storefront/, lib/storefront/ (hosts.ts, catalog.ts, cached.ts, place-order.ts, slug.ts, settings-shape.ts, copy.ts), the product page's Website panel, proxy.ts and deploy/nginx/.

Read how these work in Gift Valy today: proxy.ts (Funnel Liner gate), lib/bom.ts (explosion, choice groups, availability), the catalog pages for products, packages and categories, lib/orders.ts (drafts, confirmDraftTx, generateOrderNumber), the order form and its pricing, lib/invoice.ts and app/api/orders/print-invoices, the Packing screen, lib/permissions.ts, lib/settings.ts, lib/file-storage.ts.

Write no code. Commit ROUND3.md ("docs: round 3 plan") and push. Then report back in short tables:
(a) for each item R3-1…R3-3 and W-1…W-10: which Antu files are the pattern (if any), which Gift Valy files change, and anything in Gift Valy that makes the Antu pattern not fit;
(b) the schema changes you propose (tables, columns, enums), including how a website order is stored (a draft order with source Website — and whether a Lead row is created with LeadSource WEBSITE so lead→order reports still add up);
(c) how a choice option's extra price flows into the order line price, the price floor, the invoice, the website price and the reports, through nested packages;
(d) how proxy.ts will serve two front doors (giftvaly.com → the website section; dashboard.funnelliner.com → the ERP) without weakening the Funnel Liner gate or the billing lock, and which website routes stay open while the ERP is suspended;
(e) anything in this file you think is wrong or missing.
```

### R3-A — Category photo, choice prices, packing invoices (Gift Valy repo)

```
Read ROUND3.md items R3-1, R3-2 and R3-3.

Before writing code, show me: (a) the migration; (b) the choice-option editor in the package form with the extra price, and how the order form shows each option with its price and the line total; (c) every place a package line's price is worked out today and how each one will add the chosen options' extra prices; (d) exactly what the Packing role will be able to print and from which screen, and what it still can't see.

Then build R3-1, R3-2 and R3-3. New migration via prisma migrate diff with SHADOW_DATABASE_URL only (rule 8). Tests: price with extra prices through a nested package and a qty of 2; the price floor; an order saved before the change keeps its price; Packing can print single and bulk invoices for orders in its queue and gets 403 elsewhere. Mark the items [DONE], commit, push.
```

### W1 — Website foundation (Gift Valy repo)

```
Read ROUND3.md items W-1, W-2 and W-3. Re-read the Antu reference: proxy.ts, lib/storefront/hosts.ts, lib/storefront/catalog.ts, lib/storefront/slug.ts, the product page's Website panel.

Before writing code, show me: (a) the proxy changes and the test list for both hosts (website host: every ERP path is a 404, no session read; ERP host: no storefront path; /go/ and /_c/ untouched); (b) the Website panel on the product form, the package form and the category form — every field, and where it sits on Create and on Edit; (c) the one public catalog read, the exact fields it may return, and the test that scans every public response for cost, stock numbers, SKUs, staff and customer data.

Then build W-1, W-2 and W-3. STOREFRONT_HOSTS and the staging host come from env (rule 9). Mark the items [DONE], commit, push.
```

### W2 — Website pages (Gift Valy repo)

```
Read ROUND3.md items W-4 and W-9. Re-read the Antu reference: app/(store)/, components/storefront/, lib/storefront/cached.ts, the /img route and store.css.

Before writing code, show me: (a) the page list with each page's address; (b) the product/package page — gallery, choice pickers with the extra price, live total, "what's inside" list, availability, delivery info, the Customize Chocolate Box photo note, WhatsApp/Messenger buttons; (c) the Gift Valy theme (colours and fonts from the logo in Settings → Invoice branding), never the ERP's violet; (d) caching and exactly what clears it.

Then build W-4 and W-9. Phone-first: 48 px tap targets, main buttons pinned to the bottom. Look at every page at 375 px and 1440 px before you finish and send me screenshots of home, a category, a package with a choice group, and search. Mark the items [DONE], commit, push.
```

### W3 — Bag, checkout, website orders in the ERP (Gift Valy repo)

```
Read ROUND3.md items W-5 and W-6. Re-read the Antu reference: lib/storefront/place-order.ts, the checkout, the confirmation page /order/<private link>, the website-order panel, round-robin assignment and the website-orders cron.

Before writing code, show me: (a) the checkout form fields and their validation (sender abroad, recipient in Bangladesh, address and zone, delivery date mode, occasion, note); (b) everything POST /api/shop/order does, in order, inside one transaction — and the proof that no price, charge or total is read from the request; (c) how the order is assigned to a Sales Executive and what they see; (d) what the confirmation page shows; (e) the abuse limits (phone/IP per hour, body size, same-site).

Then build W-5 and W-6. A website order is a DRAFT — it gets its GV number only when the SE confirms it through the existing confirmDraftTx (rule 6). Tests for: totals from the database only; a changed price is refused with 409; limits; assignment; confirm gives a GV number and moves order_sequences by exactly one; cancel with a reason never touches order_sequences. Mark the items [DONE], commit, push.
```

### W4 — Settings → Website, home page manager, SEO, Meta Pixel (Gift Valy repo)

```
Read ROUND3.md items W-7 and W-8. Re-read the Antu reference: Settings → Website, the home page manager (sections, banners with desktop + mobile images, draft + preview + publish), the policy pages, sitemap/robots/Open Graph, and PRD.md §4.6d (Meta Pixel + Conversions API).

Before writing code, show me: (a) the Settings → Website card, every field and who can edit it; (b) the home page manager; (c) the Meta events, when each fires, the one event_id per pair, and the proof that no phone number or name is ever sent raw.

Then build W-7 and W-8. Every save in Settings → Website or the home page shows on the very next page load. Mark the items [DONE], commit, push.
```

### Verify R3 (Gift Valy repo)

```
Reviewer pass on R3-A and W1–W4, by reading the code and testing on dev:
1. Category: with and without a photo; the photo is resized, stored privately and served to the website only through /img; deleting the photo leaves the category working.
2. Choice prices: a package with a choice group (Red +0, Blue +300) and a nested package with its own choice — the order form, the saved line, the price floor check, the invoice, the website product page and the website order all show the same price; an old order keeps its price after the extra price changes; reports and P&L still balance.
3. Packing: a Packing user prints a single invoice and a bulk batch from the Packing screen for orders in its queue; gets 403 for any other order or route; sees no cost, profit or payment detail beyond what the invoice itself prints.
4. Website panel: every active SELLABLE product and package that existed before the migration is shown on the website, with a placeholder image where it has no photo; a COMPONENT product is not. On Create and Edit of a product, a package and a category; switching "Show on website" off removes it from every page, search, sitemap and the bag at the next page load; a COMPONENT product can never be shown.
5. Public responses: scan every website page and /api/shop/* response — no cost, avgCost, stock number, SKU, supplier, staff or customer field, ever.
6. Hosts: on the website host /login, /api/orders, /uploads/x, /api/cron/x, /go/ and /_c/ are 404 and no session cookie is read; on dashboard.funnelliner.com every storefront path is 404; the Funnel Liner gate and the billing lock work exactly as before (FUNNEL_LINER.md Verify GV 4–6, 11, 14).
7. While the ERP is suspended: the website still shows and still takes orders (they wait as drafts); staff pages stay locked.
8. Checkout: an order with a choice group and a Customize Chocolate Box; totals come from the database; a tampered price in the request changes nothing; a price changed between page and checkout answers 409; limits block the 6th order from one phone in an hour; the order lands as a DRAFT with source Website, assigned to a checked-in SE, with a bell notification; the private confirmation page shows no phone or address.
9. Confirm the website order in the ERP: it gets the next GV number, order_sequences moves by exactly one, /api/platform/usage counts it; a cancelled website draft is never counted.
10. Settings → Website and the home page: a save shows on the next load; policies, banners desktop + mobile; the Order on WhatsApp button shows on product, package and confirmation pages only while a WhatsApp number is set, and its message carries the product, the chosen options, the price and the link.
11. SEO: sitemap lists only shown items; robots.txt; Open Graph image for a product; the ERP host stays noindex.
12. Meta: with the Pixel ID and CAPI token set, ViewContent / AddToCart / InitiateCheckout / Lead fire once each with one event_id per browser+server pair; hashed phone only; nothing fires with them unset.
13. Phone 375 px and desktop 1440 px: no sideways scroll on any website page.
14. npm run build passes; every test and verify:* script passes; test:platform still passes.
Report findings, fix them, commit, push.
```

**Verify R3 — done (26 Nov 2026).** Code read end to end by three independent reviewers (R3-A; hosts + gate + panel + SEO; checkout + ERP orders + settings + Meta), then checked over HTTP on a production build (`next start`, `shop.localhost:3005` / `localhost:3005`) against the dev database.

- **Checked on dev:**
  - **1.** A 3000 × 2000 JPEG with EXIF became an 800 × 1200 WebP with no metadata. It is served only at `/img/category-…` (`/uploads` is 404 on the website host and 401 signed out on the ERP), is gone as soon as the category is hidden, and the category keeps working after the photo is removed (file deleted).
  - **2, 8, 9.** Website order: Lateset ×2 with the nested red saree (+৳300) plus a Customize Chocolate Box gave ৳8,300 / ৳2,500 + ৳240 delivery = ৳19,340. The bag, the saved line, its picks, the receipt and the invoice all agree.
    - A wrong `seenPrice`, or a price changed in the ERP between page and order → 409. A `unitPrice` key → 400.
    - The 6th order from one number (five spellings, Arabic digits included) → 429.
    - Each order landed as a DRAFT, source Website, lead WEBSITE/COMMITTED, assigned to the only checked-in SE (`ON_DUTY`), with a bell. The receipt has no name, phone or address.
    - Confirming by the SE's advance → GV-2611-0001, `order_sequences` 2611: 0 → 1, usage counts 1, the receipt shows the number.
    - A cancelled draft (Fake order) leaves the counter and usage alone; its lead is LOST/FAKE_ORDER.
  - **3.** Packing: invoice 200 for Confirmed / Packed / Handed / In transit, 403 for the other six statuses. Bulk prints the queue and skips the rest. Order, settings and report APIs → 403/404. The Packing page carries no cost, payment or abroad phone.
  - **5.** Every website page (42) and `/api/shop/bag` with every item was scanned against every SKU, package code, staff email/phone, customer phone, supplier and recipient phone: none found. The only hit was the shop's own WhatsApp number.
  - **6.** On the website host, `/login`, `/api/orders`, `/uploads/x`, `/api/cron/x`, `/billing`, `/api/auth/*`, `/go/`, `/_c/` and their percent-encoded spellings → 404, with no cookie set. On the ERP host, every storefront path → 404, with `noindex` on every answer.
  - **7.** Suspended: the website pages load and take an order (a draft). ERP pages → 307 /billing; ERP APIs → 423.
  - **10.** Removing the WhatsApp number in Settings → Website removes the button from the product, package and confirmation pages on the very next load, and restoring it brings it back. The message carries the product, picks, price and link.
  - **11.** Open Graph, canonical and Twitter tags are present; the sitemap lists only shown items; robots.txt is right.
  - **12.** With tracking unset, no pixel script or `fbq` appears on any page. Event pairs and hashing are covered by `test:meta`.
  - **13.** All 42 website pages, plus the bag and checkout with items, at 375 and 1440 px: no sideways scroll.
- **Fixed:**
  - **(1) Package save re-issued every BOM line id.** The form always sends the whole BOM, so even a rename gave choice groups new ids. Every pending order's picks then fell back to the default: the pick list, the invoice, the frozen R3-2 extra, and a re-pick charging today's extra on top. `writePackageItems` now updates lines in place: products by product, sub-packages by package, groups by label, else by a shared option.
  - **(2) Website draft cancelled from the generic status control.** That path left its lead COMMITTED for good. It is now refused (and hidden in the UI) in favour of the Website panel's Cancel with a reason.
  - **(3) No row lock in `confirmDraftTx` / `cancelWebsiteOrder`.** A TL's "Confirmed" racing the SE's advance could take a second number from `order_sequences` (rule 6). Both now lock the row (`FOR UPDATE`) first.
  - **(4) One-line message template.** A one-line WhatsApp/Messenger template with an empty `{choices}` sent an empty message. The line is now kept without the empty part.
  - **(5) Cancelled draft's receipt.** A cancelled draft's receipt showed its DRAFT number. It no longer does.
  - **(6) Malformed `_fbc` cookie.** It turned a placed order into a 500, so the customer would order again. Everything after the commit is now caught.
  - **(7) Impossible fixed dates.** `2026-11-31` and `2026-12-45` are refused.
  - **(8) Receipt option names.** The receipt showed options by their ERP names; it now uses the website names, like the product page.
  - **(9) Inactive choice option.** A deactivated choice option stayed orderable on the website, with a broken photo. It is now Out of stock with the placeholder, and refused at checkout.
  - **(10) Sub-package used twice.** It doubled its options' price deltas on the product page (the checkout then said 409). Its group is now shown once.
  - **(11) ERP sub-package names.** Sub-package names in "inside X › Y" came from the ERP; they now use the website names.
  - **(12) Compare-at for packages.** It was checked against the base price, not the price with the default picks. The card now also hides a "was" price that isn't higher.
  - **(13) Private files as photos.** A website photo could be any upload: a payment screenshot, an expense receipt, a category, banner or print file. Only plain catalog uploads are taken now.
  - **(14) Shared category photo.** A category photo URL could point at another category's file, which was then deleted under it. Category delete now also writes `category.photo.remove`, and a PATCH without `photoUrl` no longer writes back a stale value.
  - **(15) Hidden item's typed address.** On a hidden item, a typed address went back to the name-made one at the next save.
  - **(16) `giftvaly.com.:443`.** This host was taken for the ERP.
  - **(17) Trailing slash on `/go/` and `/_c/`.** Next's own trailing-slash 308 ran before the proxy, so these two were redirects, not 404s. The proxy now makes that 308 itself after the 404s (`skipTrailingSlashRedirect`).
  - **(18) Order-request flood.** The order endpoint waited on its locks while holding a database connection, and bad requests (409) never reached the hourly limits. It now tries the locks (busy → 429) and allows 20 tries a minute per address before any query.
  - **(19) Concurrent slug fill.** Two page loads filling missing addresses at once could 500.
  - **(20) Bulk print over 100.** The error said "Too big"; it now explains the limit.
  - **(21) `verify:reports` and `verify:pnl` counted trashed orders.** Their reference queries counted trashed orders (a relation filter, or the scripts' raw client, isn't trash-filtered), so one trashed test order on dev failed them. The reports themselves were right.
  - **Tests:** new cases in `test:round3`, `test:website-orders`, `test:storefront`, `test:storefront-catalog` and `test:storefront-pages`.
- **Dev data left behind:**
  - The 7 test website orders are in Trash; the purge removes them. One was confirmed, so the dev counter for 2611 is now 1, which is right (rule 6).
  - Their test customers (`VR3 …`) remain.
  - Partho has a check-in/out today.
  - The platform state was pushed suspended → active.
  - The Teddy category photo was added and removed, and product 224's price and package 65's red saree extra were changed and put back (all audited).
- **Left as they are (noted for W-10 / later):**
  - `/img` is `immutable`, so a photo hidden or removed stays in browser and CDN caches; the server 404s at once.
  - Resized copies in `UPLOAD_DIR/web-cache` of a removed photo are not deleted (disk only).
  - The giftvaly.com Nginx block must pass `Host $host` (the same-site check compares Origin with Host) and the `X-Real-IP` snippets.
  - A number typed `+966 0 5…` is kept with the 0, as staff-typed foreign numbers always were.
  - A category with nothing shown still answers its own `/c/` page (empty); it isn't in the sitemap or on the home page.

### Deploy R3 — staging, then production (Gift Valy repo, on the server via `ssh antu`)

```
Read ROUND3.md item W-10 and this repo's DEPLOYMENT.md. The server is reached with ssh antu. Stop at every point marked "owner".

Part 1 — staging. Add the website host for staging (shop-staging.giftvaly.com → 127.0.0.1:3210, basic auth, noindex) to deploy/nginx/, update DEPLOYMENT.md, deploy main to staging (scripts/deploy.sh --staging main), run migrations, set STOREFRONT_HOSTS in the staging .env, reload. Tell me exactly which DNS record to add in Cloudflare (I add it myself). Then: show a product, a package with a choice group and a category on the staging website; place one website order on staging; confirm it in staging's ERP; print its invoice as a Packing user. Send me screenshots of each step. Stop and wait for my OK.

Part 2 — production, only after my OK. Add the giftvaly.com server block (www → bare domain, certificate, the same real-IP, body-size and timeout rules as the dashboard block), set STOREFRONT_HOSTS=giftvaly.com,www.giftvaly.com in the production .env, deploy main (scripts/deploy.sh main), reload Nginx and PM2. Tell me exactly what to change in Cloudflare for giftvaly.com and www (I do it myself) — and that the old app.giftvaly.com redirect rule stays. Check: https://giftvaly.com loads the website; https://giftvaly.com/login is a 404; dashboard.funnelliner.com still works for Gift Valy and Antu; the Funnel Liner admin panel's Test connection still passes. No test order on production (rule 6) — I place the first real one. Mark W-10 [DONE] with the date, commit, push.
```

---

## Items

### R3-1. Category photo — [DONE]

- A category gets an optional **photo** (upload on the category form, Create and Edit; JPEG / PNG / WebP up to 10 MB). Stored like other uploads (`UPLOAD_DIR`, resized to at most 1200 px, WebP, EXIF stripped); shown on the category list in the ERP and as the category tile on the website (W-4).
- Remove / replace the photo at any time; a category without a photo works everywhere (the website draws a plain tile with the name).
- Audit row on add / replace / remove.
- **Done (25 Nov 2026, 067deaf):** `categories.photo_url`; `POST /api/categories/photo` (catalog.manage) re-encodes via `lib/category-photo.ts` — ≤1200 px on the longest side, WebP, metadata stripped — to `UPLOAD_DIR/category-<uuid>.webp`; create/PATCH take `photoUrl` (only such files), audit `category.photo.add|replace|remove`, the old file is deleted on replace/remove/category delete. Photo field on Create + Edit, thumbnail column on the list. Test: `npm run test:round3`.

### R3-2. Extra price per choice option — [DONE]

- `package_item_options` gets **`extraPrice`** (Decimal, ৳, default 0, may be negative but never so that the package price goes below 0). Set in the package form, next to each option: "Red saree +৳0", "Blue saree +৳300".
- **Price of a package line** = package selling price + the sum of the chosen options' extra prices across the whole nested tree (an option inside a child package counts too), × qty. The **price floor** rises by the same amount.
- **Order form:** each option in a choice picker shows its extra price ("Blue saree (+৳300)"); the line price updates when the choice changes; the default option's extra price is in the starting price.
- **Snapshot:** the chosen options and their extra prices are saved in `order_items.choiceSelections` with the line, so changing an extra price later never changes an existing order. Invoices print the chosen option ("Saree: Blue") as today; the line price already includes the extra.
- Stock and cost already follow the chosen variant — unchanged.
- The website shows the same price (W-4) from the same function — **one** price function used by the order form API, the website and the website order.
- **Done (25 Nov 2026, 067deaf):** `package_item_options.extra_price`. The one price function is `packagePrice()` in `lib/bom.ts` (client-safe rule `choiceExtraTotal()` — the order form uses it too; W-4/W-5 must call `packagePrice`). Extra prices count **per piece**: a choice line of qty 2, or one inside a sub-package used twice, adds the extra twice per package. Saved picks carry `extraPrice` + `qty`; edits keep the extra a pick was sold at (`frozenExtrasForOrder` on PATCH, edit-request submit and approve), orders saved before R3-2 count as +৳0. Package save refuses any package — or a parent containing it — whose cheapest picks go below ৳0. Catalog list margin and the package report use the price with the default picks. Tests: `npm run test:bom` (R3-2 cases), `npm run test:round3`.

### R3-3. Packing team prints invoices — [DONE]

- New permission **`invoice.print`** for **Packing** (and every role that has `invoice.generate`): open an existing invoice PDF and print single or bulk invoices — **only for orders in the Packing queue's statuses** (Confirmed, Packed, Handed to courier, In transit). Generating a new invoice version stays with `invoice.generate`.
- **Packing screen:** a **Print invoice** button on each order row and **Print invoices** for the selected rows (the same half-A4 bulk print the Confirmed/Packed tabs have).
- Packing still never sees cost, profit, payment history or the customer's abroad phone beyond what the printed invoice itself shows.
- Everything else about invoices is unchanged.
- **Done (25 Nov 2026, 067deaf):** `invoice.print` seeded to Packing, Manager, TeamLeader, SalesExecutive (the migration also grants it to every role / per-user grant holding `invoice.generate`). Rule in `lib/invoice-print.ts`: the person's order scope exactly as before, **or**, with `invoice.print` + `orders.pack`, every order in Confirmed / Packed / Handed to courier / In transit — so the SEs' `invoice.print` never widens their own-orders scope. Packing gets 403 for any other status; an order with no invoice row yet is printed from current data without creating a version. Packing screen: "To pack" and "Packed & with courier" tabs, Print invoice per order, Print invoices for the selected rows. Test: `npm run test:round3`.

### W-1. Two front doors — [DONE]

- One app, one database. **`giftvaly.com`** (and `www`) is the website; **`dashboard.funnelliner.com`** stays the ERP (with `/_c/giftvaly/…` for machines). Hosts come from `STOREFRONT_HOSTS` (rule 9).
- On the website host every path is rewritten into the internal storefront section (`app/(store)/storefront/…`). Any ERP path there (`/login`, `/api/orders`, `/uploads/…`, `/api/cron/…`, `/billing`) is a plain **404** — never a login redirect. The staff session cookie is never read there.
- On the ERP host the storefront section doesn't exist (404). `/go/` and `/_c/` stay the Funnel Liner proxy's (rule 7).
- Separate root layouts: the website loads none of the ERP's providers, theme, PWA or service worker.
- **Billing lock (FUNNEL_LINER GV-7):** the website and `POST /api/shop/*` stay open while suspended — customers can still order; the orders wait as drafts. The gate's open list is updated and its tests extended.
- **Done (25 Nov 2026, 2fcdaed):** `proxy.ts` → `lib/storefront/front-door.ts` (pure, tested); hosts from `STOREFRONT_HOSTS` only (`lib/storefront/hosts.ts`; unset = no website; dev `shop.localhost`). Website host: `/_next/*` and `public/shop/*` pass, `/go/` `/_c/` and `/storefront…` are a plain 404, everything else is rewritten to `/storefront<path>`; never a redirect, no session read, the lock never consulted; `X-Frame-Options`/`nosniff`/`Referrer-Policy`, and `X-Robots-Tag: noindex` when `STOREFRONT_NOINDEX=1` (staging). ERP host: `/storefront…` 404, the rest unchanged. Root layouts `app/(erp)/layout.tsx` (moved, unchanged) and `app/(store)/layout.tsx`, plus `app/global-not-found.tsx` (`experimental.globalNotFound`). Lock: `/storefront(/…)` OPEN with its reason. Tests: `npm run test:storefront` (19 — ERP paths on the website host checked against the real route table), `npm run test:platform` (billing-lock + rule 7 extended).

### W-2. Website panel in the Catalog — [DONE]

On the **product form, the package form and the category form**, **Create and Edit** both, a **Website** panel (permission `catalog.manage`, audited as `catalog.website`):

| Field | Product | Package | Category |
|---|---|---|---|
| **Show on website** (on/off) | ✓ | ✓ | ✓ |
| Website name (defaults to the name) | ✓ | ✓ | ✓ |
| Address (slug) — auto from the name, editable, old one redirects | ✓ | ✓ | ✓ |
| Website description (rich text: paragraphs, bold, lists) | ✓ | ✓ | ✓ |
| Photos — several, drag to order, first = main (the existing photo becomes the first) | ✓ | ✓ | the R3-1 photo |
| Website category (a package has no category today — choose one or more) | the product's category | ✓ (one or more) | — |
| Compare-at price ("was ৳X") — optional, must be above the price | ✓ | ✓ | — |
| Badge — none / New / Best seller / Limited | ✓ | ✓ | — |
| Featured on home page | ✓ | ✓ | ✓ |
| Sort order | ✓ | ✓ | ✓ |
| SEO title + description (default from name/description) | ✓ | ✓ | ✓ |
| Show "what's inside" (the BOM list, names and qty only) | — | ✓ (on by default) | — |

- Only **SELLABLE**, active, not-trashed products can be shown; **COMPONENT** products never (the switch is disabled with the reason).
- The **product list and package list** get a **Website** column (shown / hidden) and a filter, and a bulk "Show on website / Hide".
- Existing products and packages get the panel on their **Edit** page. The migration switches **Show on website on** for every active SELLABLE product and every active package (owner's decision), with an auto slug; COMPONENT products stay off. A **new** product or package also starts with the switch **on** (it can be turned off on the form).
- An item with no photo shows a **branded placeholder** on the website (the Gift Valy logo on the brand colour, with the item's name) — never a broken image. The product and package lists get a **"No website photo"** filter so photos can be added one by one.
- Slugs: Latin, lower case, hyphenated; Bangla names transliterated (Antu `lib/storefront/slug.ts`); unique across products, packages and categories' own spaces; fixed once published; a manual change keeps the old address as a permanent redirect.
- **Done (25 Nov 2026, 2fcdaed):** migration `w2_website_panel` (additive): website columns on `products` / `packages` / `categories`, `photos text[]` (seeded from `photo_url`; `photo_url` = `photos[0]` from now on), `package_website_categories`, `website_slug_redirects` (space ITEM = `/p/` shared by products + packages, CATEGORY = `/c/`). Show switched on for active SELLABLE products and active packages (+ categories); slugs are made by the app the first time the public catalog reads a shown item without one (`ensureWebsiteSlugs`), since SQL can't transliterate. One server path `applyWebsite()` in `lib/catalog-website.ts`, called inside the product / package / category create + PATCH transactions and `POST /api/catalog/website/bulk`; audit `catalog.website` (before/after). Panel `components/catalog/website-panel.tsx` at the bottom of each dialog (Create = Edit), above Active; the category's R3-1 photo sits inside it; photos replace the old single Photo field (a COMPONENT product keeps the photos field, nothing else). Description = plain text with `**bold**` and `- ` lists, parsed to blocks (`lib/catalog-website-shape.ts`), never HTML. A shown package with no website category is still on the site (form warns, doesn't block). Placeholder: `components/storefront/web-photo.tsx`. Tests in `npm run test:storefront-catalog`.

### W-3. One public catalog gate — [DONE]

- Every public read goes through one module (e.g. `lib/storefront/catalog.ts`) that names each field it returns: name, slug, description, category, photos, price (with the choice options and their extra prices), compare-at price, badge, availability, "what's inside" (names and qty only).
- **Availability** only as **In stock / Out of stock** from the existing BOM availability (for a package: every component of the default choices available; per option too). Never a stock number.
- Never cost, avgCost, cost snapshot, stock numbers, SKU, supplier, staff or customer data — **a test scans every public page and API response**.
- Product photos on the website are served at `/img/<photo>-<360|720|1080>.webp` (only photos of shown items; long cache — a new photo gets a new name); `/uploads` stays behind the staff login.
- **Done (25 Nov 2026, 2fcdaed):** `lib/storefront/catalog.ts` — `listWebCategories`, `listWebItems`, `getWebCategory`, `searchWebItems`, `getWebItem` (with old-address redirects), `publicPhotoFile`; `select` only, outputs only the types in `lib/storefront/types.ts`. Price = `packagePrice()` with default picks (options carry `extraPrice`); stock = `IN_STOCK`/`OUT_OF_STOCK` from BOM availability **net of reserved**, per option too; "what's inside" leaves out COMPONENT packing materials. `/img` route `app/(store)/storefront/img/[file]` (sharp resize, EXIF dropped, cached in `UPLOAD_DIR/web-cache`, `immutable`); also serves a choice option's main photo when the option is inside a shown package. Test `npm run test:storefront-catalog` (rolled back, dev DB): sentinel SKU / code / avg + purchase cost / supplier / stock + reserved / floor / staff / customer values, every public read JSON-walked for forbidden keys and sentinel values; fails if the module exports an unscanned function; `app/(store)` + `components/storefront` may not import Prisma or ERP catalog code. W-4 pages must add their outputs to this scan.

### W-4. Website pages — [DONE]

- **Home** (sections from W-7: banners, featured categories, featured packages/products, "Customize Chocolate Box" highlight), **category** `/c/<slug>`, **product/package** `/p/<slug>`, **search** `/search?q=` (Bangla or English: name, slug, category), **policies** `/policy/<kind>`, 404.
- **Product/package page:** swipeable gallery; name, price (live total as choices change), compare-at price, badge; **choice pickers** — each option with its photo (the option product's photo) and extra price; availability; "what's inside"; delivery info (zones, times, "delivered anywhere in Bangladesh"); for an item with a print kit the note "After you order, send us the 14 photos on WhatsApp — we print them for the box"; **Order on WhatsApp / Messenger** buttons with a prefilled message (product, choices, price, link); Add to bag / Buy now pinned to the bottom on phones.
- Gift Valy brand theme (colours from the logo; a warm gift palette), never the ERP's violet; fonts that render Bangla names. **English** copy from one file (owner's decision).
- **Order on WhatsApp** (green, full width on phones) under Add to bag / Buy now on every product and package page, and on the confirmation page; it opens `wa.me/<number>?text=…` with the product, the chosen options, the price and the link. The number comes only from **Settings → Website**; no number = no button.
- Optional approx. price in the visitor's currency (Defaults) — off by default.
- **Done (25 Nov 2026, 8d2bdc9):** pages `/`, `/c/<slug>`, `/p/<slug>` (old address → 308), `/search?q=`, `/policy/<delivery|refund|privacy|terms>` (404 until the text is set), the website's own 404 for anything else (`[...missing]`). Home sections fixed until W-7: banner, category tiles (photo, or a plain tile with the name; categories with nothing shown stay out), featured, the Customize Chocolate Box highlight (first shown item whose print kit asks for photos), all gifts. Product/package page (`components/storefront/item-purchase.tsx`): live total = price + Σ the picks' `priceDelta`, which the gate works out with `packagePrice()` itself (`lib/storefront/picks.ts`); option stock = the option itself, the package's own stock = made with its starting picks (default, or first in stock); "what's inside" shows the current picks; delivery charges per zone from the item (times from Settings → Website); print-kit note with the kit's photo / card count. WhatsApp / Messenger from the `website_settings` row (`lib/storefront/settings-shape.ts`; the editor is W-7) — unset = no button; message template with `{product} {choices} {price} {link}`. Bag in the browser (`lib/storefront/bag-store.ts`); the Bag and Checkout pages are W-5. Theme from the logo: navy `#2C347C`, orange `#EC8C24` (navy text on orange for AA), cream `#FFFAF4`; Baloo Da 2 + Hind Siliguri (self-hosted); copy in `lib/storefront/copy.ts`. Approx. currency built, off until W-7's switch. Gate additions `relatedWebItems`, `getWebSettings`, `listWebCurrencies` — in the leak scan. Checked at 375 px and 1440 px: no sideways scroll, tap targets ≥ 48 px. Tests: `npm run test:storefront-pages`, `test:storefront-catalog`, `test:storefront`.

### W-5. Bag and checkout — [DONE]

- **Bag** in the browser (no account). **Checkout** asks:
  - **Your details (sender):** name, country (default from the browser, editable: KSA, UAE, Qatar, Oman, Kuwait, Bahrain, Malaysia, Singapore, Italy, UK, USA, Bangladesh, other), WhatsApp number with country code.
  - **Recipient in Bangladesh:** name, BD mobile (01XXXXXXXXX), relation (optional), full address, zone (Inside Dhaka / Dhaka sub-area / Outside Dhaka — the existing 3 zones and their charges).
  - **Delivery date:** As soon as possible / Any day / A fixed date (the existing modes).
  - **Occasion** (Birthday, Anniversary, …, optional) and a **note** (optional).
- `POST /api/shop/order` — the website's only public write: same-site only, small body, Zod. **Prices, delivery charge, total are worked out from the database**; the request carries only who, where, which items, which choices, qty. The prices the page showed are sent only so a mismatch answers **409 "the price just changed"**. Limits: per phone and per IP per hour (Settings → Website).
- In one transaction: find or create the customer by WhatsApp number (an existing customer's saved data is never overwritten; what was typed is kept on the order), create a **DRAFT** order (`DRAFT-XXXX`, source **Website**), lines with choiceSelections and their extra prices, the assignment (W-6), an audit row (actor: website, the visitor's IP). No stock reservation (Gift Valy reserves on confirm).
- **Confirmation page** `/order/<private link>`: order reference, items, total, "Our team will contact you on WhatsApp to confirm your order and take the advance", WhatsApp button; later the live status (Confirmed → Packed → Shipped → Delivered) and the Steadfast tracking link. No phone or address on it.
- **Done (25 Nov 2026, 97f692b):**
  - **Pages:** `/bag` and `/checkout`, never cached. The bag is re-read through the gate (`webBagLines`: today's price for the picks, stock word, zone charges). A line that's gone is dropped, and a choice no longer offered falls back to its default; the page says so in both cases. Checkout fields and checks live in one file shared by the form and the server (`lib/storefront/checkout-shape.ts`):
    - The sender's country (guessed from the browser's time zone) puts its WhatsApp code in front. A leading 0 or a retyped code is dropped; Bangla and Arabic digits are accepted; the number is stored as `+<code><number>`.
    - The recipient's mobile is stored as `01XXXXXXXXX`.
    - A fixed date runs from today (Dhaka) to a year ahead.
    - Each zone shows this bag's charge (Σ qty × the item's zone charge).
    - "Bangladesh" was added to the customer countries.
  - **`POST /api/shop/order`** (`lib/storefront/place-order.ts`):
    - Refusals: cross-site 403, non-JSON 415, body over 16 KB 413, strict Zod 400 (a `unitPrice`/`total` key is refused), honeypot 400.
    - Limits: 5 orders an hour per WhatsApp number (any spelling) and 20 per IP → 429. Advisory locks stop two requests racing past a limit. The limits live in the `website_settings` row as `orderLimits`; W-7 adds the editor.
    - The IP is `X-Real-IP`, as set by Nginx — W-10's giftvaly.com block must include the same `cloudflare-real-ip` + `antu-app-proxy` snippets.
    - Prices come from `packagePrice()`. The whole bag is exploded against stock minus reserved; anything gone, a choice not offered, or sold out → 409. The shown prices are read only in `assertShownPrices()` → 409.
    - Customer: found by any spelling of the number and never overwritten.
    - Each order also gets a Lead (source WEBSITE, COMMITTED) and is a DRAFT from `nextDraftNo` (moved to `lib/draft-number.ts`). It carries a stable `W-XXXXXX` reference (DRAFT numbers are reused) and a private `web_token`.
    - Nothing is reserved. The audit row's actor is the inactive "Website (system)" user, with the visitor's IP.
    - The same number with the same items within 30 minutes is flagged `LIKELY_DUPLICATE`, not refused.
  - **`/order/<token>`:** the reference (plus the GV number once confirmed), items with choices, money, paid/due, the steps, the tracking link once shipped, the photo/card note, and "Message us on WhatsApp/Messenger". No name, phone or address; trashed orders 404; noindex.
  - **Tests:** `npm run test:website-orders`. `test:order-paths` now allows exactly two create sites and pins the website's to DRAFT-only. `test:storefront-catalog` scans `webBagLines` and lets `place-order.ts` (only) touch the database.

### W-6. Website orders in the ERP — [DONE]

- **Orders → Website** tab ("Needs confirmation"), with a **Website** badge on the order. A bell notification to the assigned SE.
- **Assignment:** round-robin among Sales Executives **checked in today** (attendance); none checked in → among all active SEs, and their Team Leader is notified. TL/Manager can reassign. An unassigned count on the Orders page and the dashboard.
- **Website order panel** on the order page: what the customer typed, where it differs from the saved customer, **Confirm** (through the existing payment/confirm flow — `confirmDraftTx`, which gives the GV number, rule 6) and **Cancel** with a reason (Fake order / Unreachable / Changed mind / Duplicate). A website draft is edited freely before confirming.
- Source **Website** appears as a filter on the Orders page and in the reports' by-source tables. Website orders count for an SE's target only if Settings → Website says so (off by default).
- A Lead row with source WEBSITE is created and linked if R3-0 shows the lead→order reports need it.
- **Done (25 Nov 2026, 97f692b):**
  - **Assignment** (`lib/website-assignment.ts`, inside the order's transaction, under a lock):
    1. A repeat customer → the SE of their latest order, if still an active SE (owner OK'd, 25 Nov).
    2. Otherwise round-robin among SEs checked in today and not checked out: whoever got a website order longest ago.
    3. Nobody in → the same among all active SEs, and their Team Leader (no TL → the Managers) gets a bell.
    4. No active SE at all → held by "Website (system)" (`orders.sales_executive_id` is required). It's listed as unassigned and dealt out by `/api/cron/website-orders` (every 15 min, `deploy/cron/giftvaly`) and on every SE check-in.
    - `orders.web_assigned_at` and `web_assign_reason` say who got it and why; the lead moves with the order.
    - **Reassign:** new permission `orders.assign` (Manager, TL; Admin has everything). A TL works within their own teams plus unassigned orders. Draft only, audited, with a bell.
  - **The bell:** new `notifications` table, a header bell (unread count every minute; opening the list marks it read), `/api/notifications`.
  - **Orders list:**
    - A "Website · Needs confirmation" tab: website drafts from all time, with no month default.
    - A Website badge with the W- reference, a Source filter (All / Website / Staff), and search by reference.
    - The unassigned list, with Assign, for `orders.assign` holders.
    - A dashboard alert for SE, TL and Owner.
  - **Order page Website panel:**
    - What the customer typed, with name/country differences from the saved customer highlighted, the private link, flags, and who has it and why.
    - "WhatsApp the customer".
    - **Confirm — record the advance:** the existing payment dialog → `confirmDraftTx` → GV number, reserve, invoice.
    - **Cancel…** with a reason (Fake order / Unreachable / Changed mind / Duplicate): DRAFT → CANCELLED, lead LOST (Unreachable = No response; new lost reasons FAKE_ORDER / DUPLICATE / CHANGED_MIND), audited. Allowed with `orders.cancel` or by the assigned SE.
    - **Reassign.**
    - A website draft skips the edit window.
  - **Source in reports:** source WEBSITE is on the lead, so the lead report's by-source table shows Website.
  - **Targets:** user/team gauges, the leaderboard and rewards count `source: STAFF` only, unless `website_settings.countForTargets` is on (off by default; W-7 adds the switch).
  - **Migration** `20261125300000_w3_website_orders`.
  - **Checked in the browser on dev:** a package with a choice at 375 and 1440 px — bag, checkout, the order, the confirmation page — then the ERP's Website tab, the panel, and Cancel (Fake order). The test order was then trashed.

### W-7. Settings → Website and the home page manager — [DONE]

- **Settings → Website** (Admin; audited): website on/off ("Coming soon" page when off), contact phone, WhatsApp (stored 8801…), Messenger page username, Facebook page, office address, delivery times per zone (charges stay where they are), the WhatsApp/Messenger message templates (placeholders `{product} {choices} {price} {link} {order_ref} {total}` — unknown ones refused), policy texts (delivery, refund/return, privacy, terms), order limits, "count website orders for targets", approx. currency display.
- **Home page manager** (Admin, Manager): sections switched on/off and reordered — banner slider (each banner a **desktop and a mobile** image, link, start/end time), featured categories, featured packages/products, a text block; draft → preview on the real website → publish.
- A save shows on the **very next page load** (cache cleared on save).
- **Done (26 Nov 2026, 42a5de4):**
  - **Settings → Website** (`/settings/website`, `settings.manage`, audited `settings.website` before/after). One schema for the form and `PUT /api/settings/website` (`lib/storefront/settings-form.ts`), stored whole in the `website_settings` row:
    - WhatsApp typed any way → `8801XXXXXXXXX`; Messenger from a username or any m.me / facebook.com link.
    - Two templates: product page `{product} {choices} {price} {link}`, confirmation page `{order_ref} {total} {link}` (any other placeholder refused, naming the allowed ones).
    - Policies up to 20,000 characters (a text holding `[[…]]` refused), limits 1–50 / 1–1000, count for targets, approx. currency, home page title + description (W-8).
    - The order rules stay out of what the website receives.
  - **Website off** (`lib/storefront/coming-soon.ts`, from the proxy): every website address is one self-contained holding page with the shop's contacts (503, `Retry-After`, noindex, no-store); `/api/shop/*` 503; `robots.txt` disallows all. A customer's `/order/<link>` and `/img/` stay open. The on/off flag is cached 5 s on `globalThis` (`lib/website-status.ts`) and dropped by every save.
  - **Home page manager** (Catalog → Website Home Page, new permission `website.home`: Admin + Manager; migration `20261126100000_w4_home_page_meta`). `home_page` row with draft + published, one Zod schema (`lib/home-page/layout.ts`). Sections can be switched on/off, moved, added and removed:
    - banner slider: up to 8 banners, each with a desktop + mobile photo or a brand-coloured placeholder, a link, and show-from/until (Dhaka);
    - featured categories (Featured flag, or chosen by hand);
    - featured items (Featured flag / by hand / from one category);
    - the Customize Chocolate Box highlight (auto or chosen);
    - a text block (`**bold**`, lists, an optional button);
    - all gifts, and the promises strip.
  - **Draft, preview, publish:** "Save draft" changes nothing on the website. "Preview" opens the saved draft on the real website through an HMAC-signed link valid 2 h (`/preview/home?t=…`; never cached, noindex, no Meta event). "Publish" is audited `website.home.publish` and clears `sf:home`. "Discard changes" goes back to the published page. Until the first publish the website shows the starting layout (the W-4 page).
  - **Banners:** photos are re-encoded to WebP with EXIF stripped (desktop ≥1000 px wide, ≤1920 × 1200; mobile ≥600, ≤1080 × 1600) and served at `/img/banner-<uuid>-<720|1080|1600>.webp` only while the draft or published page uses them. The slider swipes on a phone, has arrows and dots on a computer, and turns every 6 s unless touched or the visitor asks for reduced motion. Start/end times are re-checked in the browser, so no refresh job is needed.
  - **Checked on a production build:** a cache HIT, then a Settings save or a Publish makes the very next load a MISS showing the change. Website off shows the holding page on the next load. The preview at 375 px uses the mobile photo with no sideways scroll. A banner no layout uses is a 404. The dev data was put back afterwards (empty Meta row left in `meta_tracking`; the home page is published as the starting layout).
  - **Tests:** `npm run test:website-home` (11). `test:storefront` gains the Coming soon cases and the ERP noindex header; `test:storefront-pages` gains the cache-clearing pins.

### W-8. SEO and Meta Pixel — [DONE]

- Titles, descriptions, Open Graph images (Facebook / WhatsApp link previews) per page; `sitemap.xml` (only shown items) and `robots.txt` on the website host; the ERP host stays `noindex`.
- **Meta Pixel + Conversions API** (Settings → Website: Pixel ID, CAPI token — the token stored encrypted, never shown again): ViewContent, AddToCart, InitiateCheckout, and **Lead** when a website order is placed (it isn't a purchase until confirmed); one `event_id` per browser + server pair; value from the database; phone only hashed. Nothing fires while they are unset.
- **Done (26 Nov 2026, 42a5de4):**
  - **SEO:** title, description, canonical, Open Graph and Twitter card on every page. Item and category pages use their first photo at 1080 px; everything else uses the branded 1200 × 630 `public/shop/og.png`. The home page title and description come from Settings → Website. Policy pages take their first 155 characters as the description. Product/package pages carry Product JSON-LD (name, photos, BDT price, In stock / Out of stock — in the leak scan).
  - **`/sitemap.xml`:** home, shown categories, shown items with a date-only lastmod, and the policies that have text (gate `listWebAddresses`).
  - **`/robots.txt`:** disallows bag, checkout, order, api, search and preview; under `STOREFRONT_NOINDEX` or Website off it disallows everything.
  - **ERP host:** `X-Robots-Tag: noindex, nofollow` on every answer.
  - **Meta Pixel + Conversions API:** Settings → Website → Meta card, `settings.manage`.
    - Settings: Pixel ID, a CAPI token encrypted with `encryptSecret` (shown only as `****…abc`; the audit says only "token changed"), a test event code, "Send test event", and an event log of the last 30 with Meta's answer.
    - Switching on needs the ID, the token and a live privacy policy. The privacy policy can't be emptied while tracking is on.
    - Tables: `meta_tracking`, `meta_events` (unique order + event name), `meta_order_signals`.
  - **Events:** each fires in the browser and on the server with one `event_id`.
    - PageView on every page except `/order/` and `/preview/`.
    - ViewContent on an item page.
    - AddToCart on Add to bag / Buy now.
    - InitiateCheckout when the checkout opens.
    - The server copy (`POST /api/shop/meta`: same-site, ≤4 KB, bots dropped, 60/min/IP, always 204) is priced through the catalog gate (`getWebItem`, `webBagLines`), never the browser.
    - **Lead** when a website order is placed: `<W-ref>.lead`. The server queues it after the commit (`queueOrderLead`), and the 201 carries `track` so the checkout fires the same id. Value = the order total from the database.
    - **Purchase** when `confirmDraftTx` confirms a website order: server only, `<W-ref>.purchase`, once, behind a savepoint. It carries the placement capture and the placement time, so Meta can still match the ad click; not sent if confirmed more than 7 days after placement. The `meta-events` sweep catches one missed while tracking was off.
  - **Hashing:** `user_data` is made only by `buildUserData()` (`lib/meta/user-data.ts`): the SENDER's WhatsApp (country code, digits), first/last name and ISO country, SHA-256; a hashed customer id; fbp/fbc only when they look like Meta's own; IP and browser. The recipient's name, phone and address, and the note, are never read. The browser pixel is `init(pixelId)` only — no advanced matching. `event_source_url` drops the query, and the private order link goes as `/order`.
  - **Sending:** events are sent after the response (`after()`). The `meta-events` cron runs every 5 min (`deploy/cron/giftvaly`, DEPLOYMENT.md §10): it retries at 1/5/15/60/180 min and then marks Failed, and keeps browsing events 30 days, order events 180 and the placement capture 30. When tracking is off nothing loads, nothing is queued, and anything still waiting is marked Skipped rather than sent later.
  - **Tests:** `npm run test:meta` (9), with a fake transport, so Meta is never reached. It places an order with sentinel sender/recipient names, phones, address and note, then walks every queued row, every body sent and the browser event: no spelling of either phone, no name, no address and no note appear, and `ph`/`fn`/`ln`/`country` equal the SHA-256 of the normalised values. Also covered: one event_id per pair, database prices, Purchase once, retry → Failed, off → nothing, and the token never returned or audited. `test:storefront-catalog` scans the new gate reads (`getWebPixelId` never the token).
  - **For W-10 / the owner:** the preview link, sitemap, canonical and share-image URLs use `STOREFRONT_URL`, else `https://<first STOREFRONT_HOSTS entry>` — list `giftvaly.com` first in production. The owner pastes the Pixel ID and token into Settings themselves, after putting the privacy policy on the website.

### W-9. Caching — [DONE]

- Pages and their data cached on the server and cleared straight after any change to a shown product/package/category, a price or extra price, a photo, a website switch, Settings → Website or the home page; a 10-minute rebuild as a safety net only. Bag, checkout and `/api/shop/order` never cached.
- One PM2 process per copy (production, staging) so one save clears every cache.
- **Done (25 Nov 2026, 8d2bdc9):** `lib/storefront/cached.ts` (unstable_cache, tags `sf:catalog` / `sf:settings` / `sf:home`, 600 s) and `lib/storefront/revalidate.ts` (`revalidateTag(tag, { expire: 0 })` — gone at once, never served stale after a save). Cleared by: product / package / category create, edit, delete; the bulk Website switch; currency rates (`sf:settings`); every stock movement (`applyMovements` — In stock / Out of stock); W-7 adds Settings → Website and the home page. Pages `revalidate = 600`; search is per request. Checked on a production build: a page is a cache HIT, an ERP save makes the very next load a MISS with the new value. PM2 fork × 1 pinned in `test:deploy`; `test:storefront-pages` fails if a catalog-writing route forgets to clear the cache. **For W-10:** the pages send `s-maxage=600` — Cloudflare must not cache the website's HTML (only `/_next/static`, `/img`, `/shop`), or a save would wait for the CDN.

### W-10. Deploy — [DONE]

- Nginx: `giftvaly.com` + `www.giftvaly.com` → `127.0.0.1:3200` (www → 301 to the bare domain); `shop-staging.giftvaly.com` → `127.0.0.1:3210` with basic auth and `noindex`. Files in `deploy/nginx/`, steps in `DEPLOYMENT.md`, the owner's steps in Bangla in `GO_LIVE.md`.
- Certificates as the server already does it (certbot, Cloudflare proxied, SSL Full (strict)).
- `STOREFRONT_HOSTS` in each copy's `.env`.
- `app.giftvaly.com` keeps redirecting to `dashboard.funnelliner.com`.
- **Done (26 Nov 2026):** Part 1 (staging, e9dd428) — see above. Part 2 (production): `deploy/nginx/giftvaly-shop.conf` (1288bd2; giftvaly.com → `:3200`, www → 301 to the bare name on 80 and 443, `/_c/` + `/go/` → 404, one Let's Encrypt certificate for both names, expires 2027-02-23), DEPLOYMENT.md step 5d / 6b / 14d, GO_LIVE ধাপ ৬.২. Fresh backup first, then production deployed f9b7bd6 with `STOREFRONT_HOSTS="giftvaly.com,www.giftvaly.com"` — the four Round 3 migrations applied cleanly. Checked from outside: `https://giftvaly.com` is the website (no password, no noindex, `cf-cache-status: DYNAMIC` for pages, `HIT` for `/_next/static`), the sitemap names `https://giftvaly.com` (61 addresses: 50 products, 3 packages, 7 categories and the home page); `http://` and `www.` → 301 to `https://giftvaly.com/<path>`; `/login`, `/api/orders`, `/uploads/x`, `/go/`, `/_c/giftvaly/…` and `/manifest.webmanifest` → 404 on the website; `dashboard.funnelliner.com/_c/giftvaly/` and `/_c/antu/` and antuboutique.com unchanged; the Funnel Liner platform endpoint answers 200 with production's secret. No test order on production (rule 6). Left for the owner: `app.giftvaly.com` still has no DNS record (GO_LIVE ধাপ ৪); Cloudflare's Managed robots.txt is still on — harmless (the website's own rules and Sitemap line follow Cloudflare's block), off is cleaner (ধাপ ৬.২).
- **Found in Part 1, fixed 26 Nov 2026:** a website order (and a staff draft) kept COD = the whole total after its advance landed, so the bulk Steadfast send would have collected the advance again. `recomputeDue` (every payment write, verify/reject, edit) now moves the COD with the due before handover (editable status, no shipment): `nextCodAmount` — a COD that was following the due keeps following it, one set by hand stays but never above the due; an order edit uses `editedCodAmount` (the form sends the stored COD back: unchanged → follows, typed → capped at the due). After handover nothing moves. Production had no open order with COD above its due, so no data was corrected. Test in `test:website-orders`.

---

## Information needed from the owner

| For | What |
|---|---|
| W2 | Brand colours, if not taken from the logo |
| After go-live | Website photos for each product/package (square or 4:5, at least 1080 px), added from its Edit page |
| After deploy | WhatsApp number (typed into Settings → Website), Messenger page, Facebook page, office address, delivery times, policy texts (Claude can draft them) |
| W4 | Banners: desktop 1920 × 700 and mobile 1080 × 1350 (placeholders until then) |
| W4 | Meta Pixel ID and a Conversions API token (pasted into Settings yourself, never into chat) |
| Deploy | Cloudflare DNS for `shop-staging`, `giftvaly.com` and `www` (Claude tells you exactly what) |
