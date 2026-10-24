# Gift Valy — Customize Chocolate Box: photo + wishing-card print

**Raised by:** the owner, 24 Oct 2026. **Goes in:** the root of the Gift Valy CRM repo, next to `CORRECTIONS.md` and `FUNNEL_LINER.md`.
**Sample layouts:** `docs/print-layout-3-pages.pdf` (default) and `docs/print-layout-2-pages-borderless.pdf` — the owner's own sample photos and cards, every piece at its real size.

> **কীভাবে ব্যবহার করবেন:** নিচের "Build order" এর prompt গুলো **Gift Valy CRM repo** (`Soft-IT-Care-Ltd/Gift-Valy-CRM`) তে, Claude Code এ, একটা একটা করে দিন। প্রতিটার পর `/clear`। প্রতিটা prompt আগে plan দেখাবে — পড়ে OK দিলে তবেই build করবে। শেষ prompt টা staging এ test করে তারপর live এ দেবে।

How to use this file (for Claude Code):
- The **Build order** section has the prompts; the **Items** (PP-1 …) are the spec.
- When an item is built, mark it `[DONE]` with a one-line note and the commit.
- All existing rules in `CLAUDE.md` hold — especially rule 6 (**no test order on production**; test on staging) and rule 8 (no destructive database command without the owner's OK).

---

## What the owner wants

Customers who order the **Customize Chocolate Box** (or any package that contains it) send **14 photos** on WhatsApp, and the box also gets **2 wishing cards**. Today all of this is made by hand.

1. While taking the order, the Sales Executive **uploads the 14 photos** (downloaded from WhatsApp, any size) and, for each of the 2 cards, **picks a design and a message** — or types the customer's own message. Names (to / from) are optional.
2. The software **resizes and crops every photo to its exact print size** and puts the card message onto the card design at its exact size.
3. The Packing team opens the order, clicks **Print**, and gets a ready PDF: **A4 photo paper, 3 pages (2 with a borderless printer)**. They print it, cut each photo and card along its edge, and put them in the box.

## Decisions made by the owner (24 Oct 2026)

| Question | Decision |
|---|---|
| Card language | **Bangla, English and mixed** messages, all available; the SE picks whichever fits. |
| Names on the card | **Optional.** Some messages have name slots ("প্রিয় {to}" … "— {from}"), others are common and have none. On a message with name slots the SE types the names; if left empty, the name lines are dropped cleanly. |
| Crop or fit | **Crop to fill.** No white border around a photo. The photo is cut exactly on its edge and goes in the box. |
| Sizes | **Exactly the owner's sizes. Never scaled to fit the page.** |
| Pages | Try **2 A4 pages**; use 3 only if 2 is impossible. → see "The layout": 3 pages works on any printer; 2 pages only with borderless printing. |
| Space for scissors (24 Oct, later) | **A little white space around every piece**, so it can be cut with scissors. |
| Which order is it? (24 Oct, later) | **One info box per sheet, in one corner**: order number, recipient's name, recipient's phone, delivery date (and "Page 1 of 3"). Packing reads it, then cuts it off. **No numbers or text on the photos or cards themselves.** |

---

## The sizes (measured from the owner's sample)

| Slot | Count per box | Size (mm, W × H) | Pixels at 300 DPI |
|---|---|---|---|
| Big photo (`PHOTO_L`) | 10 | **76.2 × 77.6** | 900 × 917 |
| Small photo (`PHOTO_S`) | 4 | **38.3 × 37.2** | 452 × 439 |
| Card 1 (`CARD_1`) | 1 | **126.3 × 126.5** | 1492 × 1494 |
| Card 2 (`CARD_2`) | 1 | **99.2 × 99.5** | 1172 × 1175 |

The sizes were measured from the owner's sample pages (±0.5 mm). They are **stored in Settings, not hard-coded**, so the owner can correct them to the exact numbers from the design file without a code change. Changing a size re-checks the layouts (PP-6) and warns if a layout no longer fits.

## The layout

Every piece keeps its exact size. Around every piece there is **white space for the scissors** (the gap), and a hairline light-grey outline on the piece's exact edge shows where to cut. Each sheet has **one info box** (dashed outline) in one place: order number, recipient name, recipient phone, delivery date, "Page N of M". Nothing is written on a photo or a card. Positions are the top-left corner in mm from the top-left of the A4 page.

### "3 pages (safe)" — the default. Any printer. Gap 4 mm, margin 5 mm.

**Page 1 — 6 big + 4 small + info box**

| Piece | x | y | | Piece | x | y |
|---|---|---|---|---|---|---|
| Big 1 | 5.00 | 5.00 | | Small 1 | 165.40 | 5.00 |
| Big 2 | 85.20 | 5.00 | | Small 2 | 165.40 | 46.20 |
| Big 3 | 5.00 | 86.60 | | Small 3 | 165.40 | 87.40 |
| Big 4 | 85.20 | 86.60 | | Small 4 | 165.40 | 128.60 |
| Big 5 | 5.00 | 168.20 | | Info box (38.3 × 48) | 165.40 | 169.80 |
| Big 6 | 85.20 | 168.20 | | | | |

**Page 2 — 4 big + Card 2 + info box**

| Piece | x | y |
|---|---|---|
| Big 7 | 5.00 | 5.00 |
| Big 8 | 85.20 | 5.00 |
| Big 9 | 5.00 | 86.60 |
| Big 10 | 85.20 | 86.60 |
| Card 2 | 5.00 | 168.20 |
| Info box (60 × 48) | 108.20 | 168.20 |

**Page 3 — Card 1 + info box**

| Piece | x | y |
|---|---|---|
| Card 1 | 5.00 | 5.00 |
| Info box (60 × 48) | 135.30 | 5.00 |

### "2 pages (borderless)" — optional. Gap 3 mm.

Card 1 (126.3) + a big photo (76.2) must sit side by side on one sheet: 126.3 + 3 + 76.2 = 205.5 mm on a 210 mm sheet, so the outer pieces are only **2.25 mm** from the left and right edges. Every other 2-page arrangement was checked: without that, only 9 of the 10 big photos fit. Use this layout only if the printer prints **borderless without enlarging** (Epson/Canon borderless mode usually enlarges the page a little — that would change every size; set the enlargement/extension to the minimum or zero and check one test print with a ruler).

**Page 1:** Card 1 (2.25, 4.65) · Big 1 (131.55, 4.65) · Small 1 (131.55, 85.25) · Info box 34.9 × 45.9 (172.85, 85.25) · Big 2 (2.25, 134.15) · Big 3 (81.45, 134.15) · Big 4 (2.25, 214.75) · Big 5 (81.45, 214.75) · Small 2 (160.65, 134.15) · Small 3 (160.65, 174.35) · Small 4 (160.65, 214.55)

**Page 2:** Card 2 (15.80, 18.15) · Big 6 (15.80, 120.65) · Big 7 (15.80, 201.25) · Big 8 (118.00, 18.15) · Big 9 (118.00, 98.75) · Big 10 (118.00, 179.35) · Info box 76.2 × 30 (118.00, 259.95)

Both layouts are stored as **data** (per page, a list of `{ slot, x, y }` plus the info box), not drawing code, so a test can check them, and the layout is chosen in Settings.

**Printing rule (shown on the Print screen, Bangla + English):** print at **100% / Actual size**, never "Fit to page" — fit-to-page would shrink every piece.

---

## Build order

| # | Prompt | Runs in | Needs |
|---|---|---|---|
| 1 | PP0 — Read and plan | Gift Valy repo | — |
| 2 | PP1 — Print sizes, kits, card library | Gift Valy repo | PP0 |
| 3 | PP2 — Photos and cards on the order | Gift Valy repo | PP1 |
| 4 | PP3 — The print PDF and the Packing screen | Gift Valy repo | PP2 |
| 5 | Verify PP, staging, then production | Gift Valy repo, then the server (`ssh antu`) | PP3 |

### PP0 — Read and plan (Gift Valy repo)

```
Read PHOTO_PRINT.md fully, then CLAUDE.md and AGENTS.md (this Next.js version differs from your training data — read node_modules/next/dist/docs/ before writing routes). Open docs/print-layout-3-pages.pdf and docs/print-layout-2-pages-borderless.pdf to see the target.

Read how these work today: the order form (components/orders/order-form.tsx, app/api/orders/), the BOM explosion (lib/bom.ts), uploads (lib/file-storage.ts, app/api/uploads/route.ts, app/uploads/[...path]/route.ts), invoice PDFs (lib/invoice.ts — pdfkit with NotoSansBengali), the Packing queue (components/packing/), lib/settings.ts, lib/permissions.ts and lib/audit.ts.

Write nothing. Report back:
(a) the schema you propose for PP-1…PP-4 (tables, columns, enums) and how it ties to Order / OrderItem;
(b) how "this order line needs a print kit" is decided — the kit sits on the Customize Chocolate Box product, and a package containing it (directly, nested, or as a choice) inherits it through lib/bom.ts; qty 2 = two kits;
(c) how a photo becomes its print file (sharp: EXIF rotate, sRGB, cover crop, exact pixels at 300 DPI), where originals and print files are stored, and that both are served only through the signed-in route;
(d) whether pdfkit + fontkit shapes Bangla conjuncts correctly (render "শুভ বিবাহ বার্ষিকী প্রিয়তম", "জন্মদিনের শুভেচ্ছা", "ক্ষমা" and look at the PDF as an image) — if not, render card text with sharp + SVG (Pango shapes Bangla) and place the card as an image;
(e) which roles can do what (PP-5).
```

### PP1 — Print sizes, kits, card library (Gift Valy repo)

```
Read PHOTO_PRINT.md items PP-1, PP-2, PP-3 and PP-5.

Before writing code, show me the migration and the seed for the card messages (PP-3 list) — I'll check the Bangla.

Then build PP-1 (print sizes + layouts in Settings), PP-2 (print kit on a product, inherited by packages) and PP-3 (card designs + card messages, with admin pages under Settings → Gift print). New migration via prisma migrate diff with SHADOW_DATABASE_URL only (rule 8). Seed the PP-3 messages with an idempotent script (npm run db:seed-card-messages) that is safe on production — it adds messages only, never orders. Tests for: kit inheritance through nested packages and choice groups; layout validation (PP-6). Mark the items [DONE], commit, push.
```

### PP2 — Photos and cards on the order (Gift Valy repo)

```
Read PHOTO_PRINT.md item PP-4 and PP-5.

Before writing code, show me: (a) where the "Photos & cards" section appears on the order form and on the order detail page; (b) how 14 photos are uploaded at once from a phone (multi-select, progress, retry one), reordered, and marked big / small; (c) the crop preview (fill the frame; drag to move, slider to zoom; default focus from sharp's attention strategy); (d) the card picker (design → occasion → message, or custom text; name boxes only on a message with name slots; live preview at the card's real proportions); (e) what happens when the order is saved with photos still missing.

Then build PP-4. Every message the SE sees in Bangla and English. The order can be saved without the photos; the kit shows "Photos pending 9/14". Audit rows for every upload, replace, delete and card change. Mark PP-4 [DONE], commit, push.
```

### PP3 — The print PDF and the Packing screen (Gift Valy repo)

```
Read PHOTO_PRINT.md items PP-6 and PP-7, and the section "The layout". Look at docs/print-layout-3-pages.pdf and docs/print-layout-2-pages-borderless.pdf.

Before writing code, show me: (a) the function that turns a kit + a layout into PDF pages, and the test that checks every piece is at its exact mm size and position, inside the page, and never overlaps another; (b) how the PDF is cached and when it is rebuilt; (c) the Packing screen changes.

Then build PP-6 and PP-7. Default layout "3 pages (safe)". The PDF page is exactly A4 (595.28 × 841.89 pt), images placed at exact mm with no scaling of the page, 300 DPI images. Render one PDF from test photos at both layouts and look at it as an image before you finish. Mark the items [DONE], commit, push.
```

### Verify PP, staging, then production (Gift Valy repo, then `ssh antu`)

```
Reviewer pass on PP1–PP3 by reading the code and testing on dev:
1. A package containing the Customize Chocolate Box (directly, nested, as a choice) gets a kit; qty 2 gets two kits; a package without it gets none.
2. Upload 14 photos of mixed sizes and shapes (portrait 1080×1920, landscape 1600×900, square, a tiny 300×300, a rotated phone photo with EXIF) — each print file is exactly its pixel size, the right way up, filling the frame; the tiny one shows the low-quality warning.
3. Cards: a Bangla, an English and a mixed message, one with names and one without; a message with name slots and empty names drops the name lines; a long custom message shrinks to fit and never runs outside the text area. Bangla conjuncts look right in the PDF (check it as an image).
4. The PDF: 3 pages in "3 pages (safe)", 2 pages in "2 pages (borderless)"; every piece is the exact mm size from Settings (measure in the PDF); the gap between pieces is never less than the layout's gap; each sheet has exactly one info box with order number, recipient name, recipient phone and delivery date (a Bangla name renders correctly); nothing is printed on a photo or card.
5. A Sales Executive can upload and choose cards only until the order is PACKED; Packing can print but not change; nobody without the permission can open a photo URL; photos are not in public/.
6. Replacing a photo after printing marks the kit "Changed after print — reprint".
7. The cleanup deletes the photos of kits whose order was delivered or returned more than 60 days ago, and never while suspended.
8. npm run build passes; every test and verify:* script passes.
Report findings, fix them, commit, push.

Then deploy to staging (scripts/deploy.sh --staging main), run db:seed-card-messages there, and make one full test order on staging with 14 photos and 2 cards; send me the PDF. Stop and wait for my OK.

After my OK: deploy to production (scripts/deploy.sh main) and run db:seed-card-messages. No test order on production (rule 6). Mark the plan [DONE], commit, push.
```

---

## Items

### PP-1. Print sizes and layouts — in Settings — [OPEN]

- Settings → **Gift print** (Admin only): the four sizes from "The sizes" in mm (one decimal) and the layout choice ("3 pages (safe)" default / "2 pages (borderless)").
- The two layouts from "The layout" are stored as data: per page, a list of `{ slot, x, y }` in mm. Sizes come from the size settings.
- Saving a size runs the layout check (PP-6) and refuses a size that makes the chosen layout overlap or run off the page — it says which piece and by how much.

### PP-2. Print kit on a product — [OPEN]

- A product can carry a **print kit**: how many photos of each size and which cards, e.g. `{ photos: { PHOTO_L: 10, PHOTO_S: 4 }, cards: ["CARD_1", "CARD_2"] }`. Set on the product's edit page (Admin/Manager) — "This product needs customer photos / cards".
- The **Customize Chocolate Box** product gets the 10 + 4 + 2 kit.
- A package line gets a kit for every kit-carrying product inside it, through the existing BOM explosion (`lib/bom.ts`: nested packages, chosen option of a choice group). Line qty 2 → 2 kits.
- A kit is snapshotted onto the order when the line is saved, so changing the product later never changes an existing order.

### PP-3. Card designs and card messages — [OPEN]

**Card designs** (Settings → Gift print → Card designs, Admin/Manager): a name, which card size it is for, a **background image without text** (uploaded, cropped to the card's size), the **text area** (drawn as a box on the preview, stored in % of the card), text colour, alignment, and a font (Noto Sans Bengali Bold by default; an admin may upload another .ttf). Active / inactive.

> The owner's two sample cards have the text baked into the picture. **The owner sends the same backgrounds without text**; they become the first two designs.

**Card messages** (same section): occasion, language (Bangla / English / Mixed), the text, and whether it has name slots. `{to}` and `{from}` are the slots. A line that contains only an empty slot is dropped. Active / inactive; an admin can add more at any time.

**Seed messages** (`npm run db:seed-card-messages`, idempotent — matches by text, never duplicates):

**জন্মদিন / Birthday**
1. *(Bangla, common)* শুভ জন্মদিন! আজকের দিনটা তোমার মতোই সুন্দর হোক। হাসি, ভালোবাসা আর সুখে ভরে উঠুক তোমার প্রতিটা দিন।
2. *(Bangla, names)* প্রিয় {to}, শুভ জন্মদিন! দূরে আছি, কিন্তু মনটা সবসময় তোমার কাছেই। আল্লাহ তোমাকে সবসময় ভালো রাখুক। — {from}
3. *(Bangla, names)* প্রিয় {to}, আজ পৃথিবীতে তোমার আসার দিন — আমার জীবনের সবচেয়ে সুন্দর দিন। শুভ জন্মদিন, ভালোবাসি অনেক। — তোমার {from}
4. *(English, common)* Happy Birthday! May your day be filled with love, laughter and everything that makes you smile.
5. *(English, names)* Dear {to}, Happy Birthday! Miles apart, but you are always in my heart. — {from}
6. *(Mixed, names)* Happy Birthday, {to}! তোমার হাসিটাই আমার সবচেয়ে প্রিয় উপহার। Stay happy forever. — {from}

**বিবাহবার্ষিকী / Anniversary**
7. *(Bangla, common)* শুভ বিবাহবার্ষিকী! একসাথে কাটানো প্রতিটা দিন আরও ভালোবাসায় ভরে উঠুক।
8. *(Bangla, names)* প্রিয় {to}, তোমাকে নিয়ে লিখতে গেলে শেষ হবে না। আমাদের ভালোবাসা প্রতিদিন নতুন করে জন্মায়। সারাজীবন এভাবেই পাশে থেকো। শুভ বিবাহবার্ষিকী। — {from}
9. *(Bangla, names)* প্রিয় {to}, দূরে থাকলেও আমাদের বন্ধন একটুও কমেনি। এই বিশেষ দিনে তোমাকে অনেক অনেক ভালোবাসা। শুভ বিবাহবার্ষিকী। — তোমার {from}
10. *(English, common)* Happy Anniversary! Every year with you is a gift. Here's to forever together.
11. *(Mixed, names)* Happy Anniversary, {to}! তুমি আমার জীবনে এসে জীবনটাকে রাঙিয়ে দিয়েছ। Love you always. — {from}

**ভালোবাসা / Love**
12. *(Bangla, common)* তুমি আমার জীবনে এসে জীবনটাকে আরও দ্বিগুণ রাঙিয়ে দিয়েছ। আমার জীবনকে রাঙিয়ে দেওয়ার জন্য অনেক ধন্যবাদ।
13. *(Bangla, names)* প্রিয় {to}, হাজার মাইল দূরে থেকেও প্রতিটা মুহূর্তে তোমাকেই মনে পড়ে। খুব তাড়াতাড়ি দেখা হবে। — {from}
14. *(English, common)* You are my today and all of my tomorrows. I love you.
15. *(English, names)* Dear {to}, distance means so little when someone means so much. — {from}

**মিস করছি / Missing you** (প্রবাসীদের জন্য)
16. *(Bangla, common)* দেশ থেকে অনেক দূরে, কিন্তু মন পড়ে আছে তোমাদের কাছেই। খুব মিস করছি।
17. *(Bangla, names)* প্রিয় {to}, এই ছোট্ট উপহারটা আমার ভালোবাসার একটু ছোঁয়া। খুব মিস করছি তোমাকে। — {from}
18. *(Mixed, names)* Missing you so much, {to}। খুব শিগগিরই দেশে ফিরে তোমার কাছে আসছি। — {from}

**মা / Mother**
19. *(Bangla, names)* প্রিয় মা, তোমার দোয়াতেই আমি আজ এতদূর। দূরে আছি, কিন্তু তুমি সবসময় আমার হৃদয়ে। ভালো থেকো মা। — তোমার {from}
20. *(English, common)* To the best mom in the world — thank you for everything. Love you, Ma.

**ঈদ / Eid**
21. *(Bangla, common)* ঈদ মোবারক! ঈদের আনন্দ ছড়িয়ে পড়ুক তোমার জীবনের প্রতিটা দিনে।
22. *(Bangla, names)* প্রিয় {to}, ঈদ মোবারক! এবারের ঈদে কাছে থাকতে পারলাম না, তাই ভালোবাসাটুকু পাঠিয়ে দিলাম। — {from}
23. *(English, common)* Eid Mubarak! Wishing you joy, peace and endless blessings.

**দুঃখিত / Sorry**
24. *(Bangla, names)* প্রিয় {to}, ভুল হয়ে গেছে, ক্ষমা করে দিও। তোমার রাগ ভাঙাতে এই ছোট্ট উপহার। — {from}
25. *(English, common)* I'm sorry. You mean the world to me — please forgive me.

**অভিনন্দন / Congratulations**
26. *(Bangla, common)* অভিনন্দন! তোমার এই সাফল্যে আমরা সবাই অনেক খুশি। সামনে আরও এগিয়ে যাও।
27. *(English, names)* Congratulations, {to}! So proud of you. — {from}

### PP-4. Photos and cards on the order — [OPEN]

- On the order form and the order detail page, every kit gets a **"Photos & cards"** section (one per kit when qty > 1).
- **Photos:** pick all 14 at once from the phone or computer (JPEG / PNG / WebP / HEIC if sharp supports it; up to 15 MB each). Upload shows progress per photo and retries one that failed. The first 10 go to big slots and the last 4 to small slots; the SE can drag to reorder or move a photo between big and small. Each slot shows the crop preview at the slot's real proportions — drag to move, slider to zoom, "Reset". Default crop focus: sharp's `attention` strategy (keeps faces).
- **Low quality warning** (not a block): a photo whose crop would print below 150 DPI shows "ছবিটা ছোট — প্রিন্ট ঝাপসা হতে পারে / Low resolution — print may be blurry".
- **Cards (one picker per card):** design (only designs for that card size) → occasion → message (filter by language), or **"Custom message"** to type the customer's own words. Name boxes "যাকে দেবেন / To" and "যে দিচ্ছেন / From" appear only on a message with name slots. A live preview shows the card exactly as it will print. Long text shrinks to fit the text area (down to a minimum size; beyond that the SE is told to shorten it).
- The order **can be saved with photos missing** (customers often send them later). The kit shows **"Photos pending 9/14"** / **"Cards pending"** / **"Ready to print"**, on the order list as a badge and as a filter.
- Every upload, replace, delete, crop change and card change writes an audit row.

### PP-5. Who can do what — [OPEN]

New permissions in `lib/permissions.ts`:

| Permission | Roles | Allows |
|---|---|---|
| `print.edit` | Admin, Manager, Team Leader, Sales Executive | upload / replace photos, crop, choose cards — **only until the order is PACKED** (Admin/Manager any time) |
| `print.print` | Admin, Manager, Packing | open the print PDF, mark printed, reprint |
| `print.settings` | Admin (sizes, layouts), Admin + Manager (designs, messages) | Settings → Gift print |

Photos are the customer's private pictures: stored only in `UPLOAD_DIR` (never `public/`), served only through the signed-in route, and only to a role with `print.edit` or `print.print`.

### PP-6. The print PDF — [OPEN]

- One PDF per order (all its kits; each kit starts on a new page). Exactly A4 (595.28 × 841.89 pt). Every piece placed at its exact mm position and size from PP-1 — **never scaled**.
- Photos: the 300 DPI print file from PP-4 (EXIF-rotated, sRGB, crop-to-fill, JPEG quality 92). Cards: background + text, rendered at 300 DPI.
- White space around every piece (the layout's gap: 4 mm safe / 3 mm borderless) for cutting with scissors; a hairline (0.25 pt, light grey) outline on each piece's exact edge = the cutting line.
- **Nothing is printed on a photo or a card.** Each sheet has **one info box** at the layout's info-box position, dashed outline, Noto Sans Bengali (names may be Bangla): **order number** (bold, large), **recipient name**, **recipient phone** (the BD recipient number, not the customer abroad), **delivery date** (or "ASAP" / "Any day" per the order's delivery-date mode), and "Page 1 of 3". Packing reads it, then cuts it off.
- **Layout check** (used by PP-1 and a test): every piece inside the page, no two pieces closer than the gap, sizes exact.
- The PDF is built when the kit becomes ready and cached in `INVOICE_DIR/print/` (private, like invoices); any change to a photo, crop, card or setting rebuilds it.

### PP-7. Packing screen — [OPEN]

- The Packing queue shows a **"Photos & cards"** column: Pending / Ready to print / Printed / Changed after print.
- **"Print photos & cards"** opens the PDF in a new tab, with the reminder above it: "A4 photo paper · 100% / Actual size (and Borderless, only for the 2-page layout)" in Bangla and English.
- **"Mark printed"** records who and when; reprinting is allowed and logged. A kit changed after it was printed shows **"Changed after print — reprint"**.
- An order with a kit that is not "Printed" shows a warning (not a block) when it is marked PACKED.
- **Cleanup:** the nightly trash-cleanup also deletes original and print photos of kits whose order was DELIVERED or RETURNED more than 60 days ago (and the cached PDF), and does nothing while the account is suspended (FUNNEL_LINER GV-7).

---

## Information needed from the owner

| For | What |
|---|---|
| PP1 | The **exact sizes** from the design file, if they differ from the measured ones (they can also be corrected later in Settings). |
| PP1 | The **card backgrounds without text** (Card 1 and Card 2, and any more designs). |
| PP3 | Optional: if the packing printer prints **borderless without enlarging**, the 2-page layout can be switched on in Settings after one test print checked with a ruler. |
| Verify | A real test order on **staging** only. |
