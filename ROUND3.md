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
| 2 | R3-A — Category photo, choice prices, packing invoices | Gift Valy repo | R3-0 |
| 3 | W1 — Website foundation: host, catalog Website panel, public catalog gate | Gift Valy repo | R3-A |
| 4 | W2 — Website pages: home, category, product/package, search | Gift Valy repo | W1 |
| 5 | W3 — Bag, checkout, website orders in the ERP | Gift Valy repo | W2 |
| 6 | W4 — Settings → Website, home page manager, SEO, Meta Pixel | Gift Valy repo | W3 |
| 7 | Verify R3 | Gift Valy repo | W4 |
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

### Deploy R3 — staging, then production (Gift Valy repo, on the server via `ssh antu`)

```
Read ROUND3.md item W-10 and this repo's DEPLOYMENT.md. The server is reached with ssh antu. Stop at every point marked "owner".

Part 1 — staging. Add the website host for staging (shop-staging.giftvaly.com → 127.0.0.1:3210, basic auth, noindex) to deploy/nginx/, update DEPLOYMENT.md, deploy main to staging (scripts/deploy.sh --staging main), run migrations, set STOREFRONT_HOSTS in the staging .env, reload. Tell me exactly which DNS record to add in Cloudflare (I add it myself). Then: show a product, a package with a choice group and a category on the staging website; place one website order on staging; confirm it in staging's ERP; print its invoice as a Packing user. Send me screenshots of each step. Stop and wait for my OK.

Part 2 — production, only after my OK. Add the giftvaly.com server block (www → bare domain, certificate, the same real-IP, body-size and timeout rules as the dashboard block), set STOREFRONT_HOSTS=giftvaly.com,www.giftvaly.com in the production .env, deploy main (scripts/deploy.sh main), reload Nginx and PM2. Tell me exactly what to change in Cloudflare for giftvaly.com and www (I do it myself) — and that the old app.giftvaly.com redirect rule stays. Check: https://giftvaly.com loads the website; https://giftvaly.com/login is a 404; dashboard.funnelliner.com still works for Gift Valy and Antu; the Funnel Liner admin panel's Test connection still passes. No test order on production (rule 6) — I place the first real one. Mark W-10 [DONE] with the date, commit, push.
```

---

## Items

### R3-1. Category photo — [OPEN]

- A category gets an optional **photo** (upload on the category form, Create and Edit; JPEG / PNG / WebP up to 10 MB). Stored like other uploads (`UPLOAD_DIR`, resized to at most 1200 px, WebP, EXIF stripped); shown on the category list in the ERP and as the category tile on the website (W-4).
- Remove / replace the photo at any time; a category without a photo works everywhere (the website draws a plain tile with the name).
- Audit row on add / replace / remove.

### R3-2. Extra price per choice option — [OPEN]

- `package_item_options` gets **`extraPrice`** (Decimal, ৳, default 0, may be negative but never so that the package price goes below 0). Set in the package form, next to each option: "Red saree +৳0", "Blue saree +৳300".
- **Price of a package line** = package selling price + the sum of the chosen options' extra prices across the whole nested tree (an option inside a child package counts too), × qty. The **price floor** rises by the same amount.
- **Order form:** each option in a choice picker shows its extra price ("Blue saree (+৳300)"); the line price updates when the choice changes; the default option's extra price is in the starting price.
- **Snapshot:** the chosen options and their extra prices are saved in `order_items.choiceSelections` with the line, so changing an extra price later never changes an existing order. Invoices print the chosen option ("Saree: Blue") as today; the line price already includes the extra.
- Stock and cost already follow the chosen variant — unchanged.
- The website shows the same price (W-4) from the same function — **one** price function used by the order form API, the website and the website order.

### R3-3. Packing team prints invoices — [OPEN]

- New permission **`invoice.print`** for **Packing** (and every role that has `invoice.generate`): open an existing invoice PDF and print single or bulk invoices — **only for orders in the Packing queue's statuses** (Confirmed, Packed, Handed to courier, In transit). Generating a new invoice version stays with `invoice.generate`.
- **Packing screen:** a **Print invoice** button on each order row and **Print invoices** for the selected rows (the same half-A4 bulk print the Confirmed/Packed tabs have).
- Packing still never sees cost, profit, payment history or the customer's abroad phone beyond what the printed invoice itself shows.
- Everything else about invoices is unchanged.

### W-1. Two front doors — [OPEN]

- One app, one database. **`giftvaly.com`** (and `www`) is the website; **`dashboard.funnelliner.com`** stays the ERP (with `/_c/giftvaly/…` for machines). Hosts come from `STOREFRONT_HOSTS` (rule 9).
- On the website host every path is rewritten into the internal storefront section (`app/(store)/storefront/…`). Any ERP path there (`/login`, `/api/orders`, `/uploads/…`, `/api/cron/…`, `/billing`) is a plain **404** — never a login redirect. The staff session cookie is never read there.
- On the ERP host the storefront section doesn't exist (404). `/go/` and `/_c/` stay the Funnel Liner proxy's (rule 7).
- Separate root layouts: the website loads none of the ERP's providers, theme, PWA or service worker.
- **Billing lock (FUNNEL_LINER GV-7):** the website and `POST /api/shop/*` stay open while suspended — customers can still order; the orders wait as drafts. The gate's open list is updated and its tests extended.

### W-2. Website panel in the Catalog — [OPEN]

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

### W-3. One public catalog gate — [OPEN]

- Every public read goes through one module (e.g. `lib/storefront/catalog.ts`) that names each field it returns: name, slug, description, category, photos, price (with the choice options and their extra prices), compare-at price, badge, availability, "what's inside" (names and qty only).
- **Availability** only as **In stock / Out of stock** from the existing BOM availability (for a package: every component of the default choices available; per option too). Never a stock number.
- Never cost, avgCost, cost snapshot, stock numbers, SKU, supplier, staff or customer data — **a test scans every public page and API response**.
- Product photos on the website are served at `/img/<photo>-<360|720|1080>.webp` (only photos of shown items; long cache — a new photo gets a new name); `/uploads` stays behind the staff login.

### W-4. Website pages — [OPEN]

- **Home** (sections from W-7: banners, featured categories, featured packages/products, "Customize Chocolate Box" highlight), **category** `/c/<slug>`, **product/package** `/p/<slug>`, **search** `/search?q=` (Bangla or English: name, slug, category), **policies** `/policy/<kind>`, 404.
- **Product/package page:** swipeable gallery; name, price (live total as choices change), compare-at price, badge; **choice pickers** — each option with its photo (the option product's photo) and extra price; availability; "what's inside"; delivery info (zones, times, "delivered anywhere in Bangladesh"); for an item with a print kit the note "After you order, send us the 14 photos on WhatsApp — we print them for the box"; **Order on WhatsApp / Messenger** buttons with a prefilled message (product, choices, price, link); Add to bag / Buy now pinned to the bottom on phones.
- Gift Valy brand theme (colours from the logo; a warm gift palette), never the ERP's violet; fonts that render Bangla names. **English** copy from one file (owner's decision).
- **Order on WhatsApp** (green, full width on phones) under Add to bag / Buy now on every product and package page, and on the confirmation page; it opens `wa.me/<number>?text=…` with the product, the chosen options, the price and the link. The number comes only from **Settings → Website**; no number = no button.
- Optional approx. price in the visitor's currency (Defaults) — off by default.

### W-5. Bag and checkout — [OPEN]

- **Bag** in the browser (no account). **Checkout** asks:
  - **Your details (sender):** name, country (default from the browser, editable: KSA, UAE, Qatar, Oman, Kuwait, Bahrain, Malaysia, Singapore, Italy, UK, USA, Bangladesh, other), WhatsApp number with country code.
  - **Recipient in Bangladesh:** name, BD mobile (01XXXXXXXXX), relation (optional), full address, zone (Inside Dhaka / Dhaka sub-area / Outside Dhaka — the existing 3 zones and their charges).
  - **Delivery date:** As soon as possible / Any day / A fixed date (the existing modes).
  - **Occasion** (Birthday, Anniversary, …, optional) and a **note** (optional).
- `POST /api/shop/order` — the website's only public write: same-site only, small body, Zod. **Prices, delivery charge, total are worked out from the database**; the request carries only who, where, which items, which choices, qty. The prices the page showed are sent only so a mismatch answers **409 "the price just changed"**. Limits: per phone and per IP per hour (Settings → Website).
- In one transaction: find or create the customer by WhatsApp number (an existing customer's saved data is never overwritten; what was typed is kept on the order), create a **DRAFT** order (`DRAFT-XXXX`, source **Website**), lines with choiceSelections and their extra prices, the assignment (W-6), an audit row (actor: website, the visitor's IP). No stock reservation (Gift Valy reserves on confirm).
- **Confirmation page** `/order/<private link>`: order reference, items, total, "Our team will contact you on WhatsApp to confirm your order and take the advance", WhatsApp button; later the live status (Confirmed → Packed → Shipped → Delivered) and the Steadfast tracking link. No phone or address on it.

### W-6. Website orders in the ERP — [OPEN]

- **Orders → Website** tab ("Needs confirmation"), with a **Website** badge on the order. A bell notification to the assigned SE.
- **Assignment:** round-robin among Sales Executives **checked in today** (attendance); none checked in → among all active SEs, and their Team Leader is notified. TL/Manager can reassign. An unassigned count on the Orders page and the dashboard.
- **Website order panel** on the order page: what the customer typed, where it differs from the saved customer, **Confirm** (through the existing payment/confirm flow — `confirmDraftTx`, which gives the GV number, rule 6) and **Cancel** with a reason (Fake order / Unreachable / Changed mind / Duplicate). A website draft is edited freely before confirming.
- Source **Website** appears as a filter on the Orders page and in the reports' by-source tables. Website orders count for an SE's target only if Settings → Website says so (off by default).
- A Lead row with source WEBSITE is created and linked if R3-0 shows the lead→order reports need it.

### W-7. Settings → Website and the home page manager — [OPEN]

- **Settings → Website** (Admin; audited): website on/off ("Coming soon" page when off), contact phone, WhatsApp (stored 8801…), Messenger page username, Facebook page, office address, delivery times per zone (charges stay where they are), the WhatsApp/Messenger message templates (placeholders `{product} {choices} {price} {link} {order_ref} {total}` — unknown ones refused), policy texts (delivery, refund/return, privacy, terms), order limits, "count website orders for targets", approx. currency display.
- **Home page manager** (Admin, Manager): sections switched on/off and reordered — banner slider (each banner a **desktop and a mobile** image, link, start/end time), featured categories, featured packages/products, a text block; draft → preview on the real website → publish.
- A save shows on the **very next page load** (cache cleared on save).

### W-8. SEO and Meta Pixel — [OPEN]

- Titles, descriptions, Open Graph images (Facebook / WhatsApp link previews) per page; `sitemap.xml` (only shown items) and `robots.txt` on the website host; the ERP host stays `noindex`.
- **Meta Pixel + Conversions API** (Settings → Website: Pixel ID, CAPI token — the token stored encrypted, never shown again): ViewContent, AddToCart, InitiateCheckout, and **Lead** when a website order is placed (it isn't a purchase until confirmed); one `event_id` per browser + server pair; value from the database; phone only hashed. Nothing fires while they are unset.

### W-9. Caching — [OPEN]

- Pages and their data cached on the server and cleared straight after any change to a shown product/package/category, a price or extra price, a photo, a website switch, Settings → Website or the home page; a 10-minute rebuild as a safety net only. Bag, checkout and `/api/shop/order` never cached.
- One PM2 process per copy (production, staging) so one save clears every cache.

### W-10. Deploy — [OPEN]

- Nginx: `giftvaly.com` + `www.giftvaly.com` → `127.0.0.1:3200` (www → 301 to the bare domain); `shop-staging.giftvaly.com` → `127.0.0.1:3210` with basic auth and `noindex`. Files in `deploy/nginx/`, steps in `DEPLOYMENT.md`, the owner's steps in Bangla in `GO_LIVE.md`.
- Certificates as the server already does it (certbot, Cloudflare proxied, SSL Full (strict)).
- `STOREFRONT_HOSTS` in each copy's `.env`.
- `app.giftvaly.com` keeps redirecting to `dashboard.funnelliner.com`.

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
