// PHOTO_PRINT.md PP-1 / PP-2 / PP-3 — pure tests, no DB. Run: npm run test:print
//   - print-kit inheritance through lib/bom.ts (direct, nested, choice, qty)
//     and the stable order source keys
//   - the layout check (both layouts fit the owner's sizes; a size that
//     breaks a layout is reported by piece and millimetres)
//   - card text: name slots, dropped name lines, tidy punctuation
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BomError,
  packagePrintKitNeeds,
  productPrintKitNeeds,
  type BomCatalog,
  type BomLine,
  type BomPackage,
  type BomProduct,
} from "../lib/bom";
import { desiredPrintKits, type OrderLineForKits } from "../lib/print-kits";
import {
  DEFAULT_PRINT_KIT,
  PRINT_KIT_MAX,
  describePrintKit,
  normalizePrintKit,
  type PrintKitSpec,
} from "../lib/print-kit";
import {
  A4_MM,
  DEFAULT_PRINT_SIZES,
  PRINT_LAYOUTS,
  checkLayout,
  layoutSlotCounts,
  mmToPx,
  normalizePrintSettings,
  placedBoxes,
  slotPixels,
} from "../lib/print-layouts";
import { cardLines } from "../lib/print-card-text";
import { SEED_CARD_MESSAGES } from "../lib/card-message-seed";
import { hasNameSlots } from "../lib/print-constants";

// ---------- catalog builders ----------

let lineId = 9000;

function product(id: number, name: string, printKit: PrintKitSpec | null = null): BomProduct {
  return {
    id,
    name,
    productType: "SELLABLE",
    isStockTracked: true,
    stockQty: 100,
    avgCost: 0,
    weightKg: null,
    components: [],
    printKit,
  };
}

function line(over: Partial<BomLine>): BomLine {
  return {
    id: lineId++,
    kind: "PRODUCT",
    productId: null,
    childPackageId: null,
    choiceLabel: null,
    qty: 1,
    options: [],
    ...over,
  };
}

const pkg = (id: number, name: string, items: BomLine[]): BomPackage => ({
  id,
  name,
  weightKg: null,
  items,
});

// Customize Chocolate Box (1) carries the kit. Packages:
//   200 Box Package          = 1 × box + 2 × Dairy Milk
//   201 Gift Combo           = Box Package (nested) + 1 × Teddy
//   202 Mega Combo           = Gift Combo (nested twice deep) + 2 × box directly
//   203 Pick-a-box           = choice[ box | Plain Box ] × 1
//   204 Two boxes by choice  = choice[ box | Plain ] × 2
//   205 No kit               = Dairy Milk + Teddy
const KIT = DEFAULT_PRINT_KIT;
const CHOICE = 700;
const CHOICE2 = 701;

function catalog(): BomCatalog {
  const products = [
    product(1, "Customize Chocolate Box", KIT),
    product(2, "Dairy Milk"),
    product(3, "Teddy"),
    product(4, "Plain Box"),
    { ...product(9, "Safety Box"), productType: "COMPONENT" as const },
  ];
  const packages = [
    pkg(200, "Box Package", [
      line({ productId: 1 }),
      line({ productId: 2, qty: 2 }),
    ]),
    pkg(201, "Gift Combo", [
      line({ kind: "PACKAGE", childPackageId: 200 }),
      line({ productId: 3 }),
    ]),
    pkg(202, "Mega Combo", [
      line({ kind: "PACKAGE", childPackageId: 201 }),
      line({ productId: 1, qty: 2 }),
    ]),
    pkg(203, "Pick-a-box", [
      line({
        id: CHOICE,
        kind: "CHOICE",
        choiceLabel: "Box",
        options: [
          { productId: 4, isDefault: true },
          { productId: 1, isDefault: false },
        ],
      }),
    ]),
    pkg(204, "Two boxes by choice", [
      line({
        id: CHOICE2,
        kind: "CHOICE",
        choiceLabel: "Box",
        qty: 2,
        options: [
          { productId: 1, isDefault: true },
          { productId: 4, isDefault: false },
        ],
      }),
    ]),
    pkg(205, "No kit", [line({ productId: 2 }), line({ productId: 3 })]),
  ];
  return {
    products: new Map(products.map((p) => [p.id, p])),
    packages: new Map(packages.map((p) => [p.id, p])),
  };
}

const units = (needs: { units: number }[]) => needs.reduce((n, k) => n + k.units, 0);

const pkgLine = (packageId: number, qty = 1, choiceSelections: unknown = null): OrderLineForKits => ({
  itemType: "PACKAGE",
  productId: null,
  packageId,
  qty,
  choiceSelections,
});
const prodLine = (productId: number, qty = 1): OrderLineForKits => ({
  itemType: "PRODUCT",
  productId,
  packageId: null,
  qty,
  choiceSelections: null,
});

describe("PP-2 print kit inheritance", () => {
  test("the kit-carrying product itself", () => {
    const c = catalog();
    assert.deepEqual(productPrintKitNeeds(c, 1), [{ productId: 1, path: "P1", units: 1, kit: KIT }]);
    assert.deepEqual(productPrintKitNeeds(c, 2), []);
  });

  test("a package containing the box directly", () => {
    const needs = packagePrintKitNeeds(catalog(), 200);
    assert.equal(units(needs), 1);
    assert.equal(needs[0].path, "P1");
    assert.deepEqual(needs[0].kit, KIT);
  });

  test("nested one and two levels deep", () => {
    const c = catalog();
    assert.deepEqual(
      packagePrintKitNeeds(c, 201).map((n) => [n.path, n.units]),
      [["K200/P1", 1]]
    );
    assert.deepEqual(
      packagePrintKitNeeds(c, 202).map((n) => [n.path, n.units]),
      [
        ["K201/K200/P1", 1],
        ["P1", 2],
      ]
    );
  });

  test("a choice group: only the chosen option counts", () => {
    const c = catalog();
    assert.equal(units(packagePrintKitNeeds(c, 203)), 0, "default pick = Plain Box");
    const chosen = packagePrintKitNeeds(c, 203, new Map([[CHOICE, 1]]));
    assert.deepEqual(chosen.map((n) => [n.path, n.units]), [["C1", 1]]);
    assert.equal(units(packagePrintKitNeeds(c, 204)), 2, "default pick = the box, × 2");
    assert.equal(units(packagePrintKitNeeds(c, 204, new Map([[CHOICE2, 4]]))), 0);
  });

  test("a package without the box gets none", () => {
    assert.deepEqual(packagePrintKitNeeds(catalog(), 205), []);
  });

  test("cycles still fail loudly", () => {
    const c = catalog();
    c.packages.set(200, pkg(200, "Box Package", [line({ kind: "PACKAGE", childPackageId: 202 })]));
    assert.throws(() => packagePrintKitNeeds(c, 202), BomError);
  });
});

describe("PP-2 kits on an order", () => {
  test("qty 2 = two kits, one per unit", () => {
    const kits = desiredPrintKits(catalog(), [pkgLine(200, 2)]);
    assert.deepEqual(
      kits.map((k) => k.sourceKey),
      ["K200.1/P1#1", "K200.1/P1#2"]
    );
    assert.ok(kits.every((k) => k.productId === 1));
  });

  test("units multiply through nesting and line qty", () => {
    // Mega Combo = 1 nested + 2 direct boxes per unit; qty 2 → 6 kits.
    assert.equal(desiredPrintKits(catalog(), [pkgLine(202, 2)]).length, 6);
  });

  test("standalone product line and a choice picked on the order", () => {
    const kits = desiredPrintKits(catalog(), [
      prodLine(1, 1),
      pkgLine(203, 1, [{ groupId: CHOICE, label: "Box", productId: 1, name: "Customize Chocolate Box" }]),
      pkgLine(205, 3),
    ]);
    assert.deepEqual(
      kits.map((k) => k.sourceKey),
      ["P1.1/P1#1", "K203.1/C1#1"]
    );
  });

  test("the same item twice gets distinct, stable keys", () => {
    const lines = [pkgLine(200), pkgLine(205), pkgLine(200)];
    const a = desiredPrintKits(catalog(), lines).map((k) => k.sourceKey);
    assert.deepEqual(a, ["K200.1/P1#1", "K200.2/P1#1"]);
    // An edit recreates the items in the same order → the same keys, so the
    // existing kits (and their photos) are matched back.
    const b = desiredPrintKits(catalog(), lines.map((l) => ({ ...l }))).map((k) => k.sourceKey);
    assert.deepEqual(a, b);
  });

  test("keys don't depend on package_items ids (a BOM save recreates them)", () => {
    const c = catalog();
    const before = desiredPrintKits(c, [pkgLine(201)]).map((k) => k.sourceKey);
    const rebuilt = c.packages.get(200)!;
    c.packages.set(200, { ...rebuilt, items: rebuilt.items.map((it) => ({ ...it, id: it.id + 100000 })) });
    assert.deepEqual(desiredPrintKits(c, [pkgLine(201)]).map((k) => k.sourceKey), before);
  });

  test("ad-hoc lines with no product/package are skipped", () => {
    assert.deepEqual(
      desiredPrintKits(catalog(), [{ itemType: "PACKAGE", productId: null, packageId: null, qty: 1, choiceSelections: null }]),
      []
    );
  });
});

describe("PP-2 kit spec", () => {
  test("normalize: valid, empty, out of range, malformed", () => {
    assert.deepEqual(normalizePrintKit(KIT), KIT);
    assert.equal(normalizePrintKit({ photos: { PHOTO_L: 0, PHOTO_S: 0 }, cards: [] }), null);
    assert.equal(normalizePrintKit({ photos: { PHOTO_L: PRINT_KIT_MAX.PHOTO_L + 1, PHOTO_S: 0 }, cards: [] }), null);
    assert.equal(normalizePrintKit("x"), null);
    assert.deepEqual(normalizePrintKit({ photos: { PHOTO_L: 2, PHOTO_S: 0 }, cards: ["CARD_2", "BOGUS"] }), {
      photos: { PHOTO_L: 2, PHOTO_S: 0 },
      cards: ["CARD_2"],
    });
  });

  test("the box kit fits every layout", () => {
    for (const layout of Object.values(PRINT_LAYOUTS)) {
      const c = layoutSlotCounts(layout);
      assert.ok(c.PHOTO_L >= KIT.photos.PHOTO_L && c.PHOTO_S >= KIT.photos.PHOTO_S, layout.id);
      assert.ok(c.CARD_1 >= 1 && c.CARD_2 >= 1, layout.id);
    }
    assert.equal(describePrintKit(KIT), "10 big + 4 small photos · Card 1 + Card 2");
  });
});

describe("PP-1 sizes and the layout check", () => {
  test("300 DPI pixel sizes from PHOTO_PRINT.md", () => {
    assert.deepEqual(slotPixels(DEFAULT_PRINT_SIZES.PHOTO_L), { w: 900, h: 917 });
    assert.deepEqual(slotPixels(DEFAULT_PRINT_SIZES.PHOTO_S), { w: 452, h: 439 });
    assert.deepEqual(slotPixels(DEFAULT_PRINT_SIZES.CARD_1), { w: 1492, h: 1494 });
    assert.deepEqual(slotPixels(DEFAULT_PRINT_SIZES.CARD_2), { w: 1172, h: 1175 });
    assert.equal(mmToPx(25.4), 300);
  });

  for (const layout of Object.values(PRINT_LAYOUTS)) {
    test(`${layout.id}: fits with the owner's sizes, one info box per page`, () => {
      assert.deepEqual(checkLayout(layout, DEFAULT_PRINT_SIZES), []);
      assert.deepEqual(layoutSlotCounts(layout), { PHOTO_L: 10, PHOTO_S: 4, CARD_1: 1, CARD_2: 1 });
      for (const page of layout.pages) {
        const boxes = placedBoxes(page, DEFAULT_PRINT_SIZES);
        assert.equal(boxes.filter((b) => b.name === "Info box").length, 1);
        for (const b of boxes) {
          assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= A4_MM.w + 1e-9 && b.y + b.h <= A4_MM.h + 1e-9, b.name);
        }
      }
      // Every Big 1…10 / Small 1…4 exactly once.
      const names = layout.pages.flatMap((p) => p.pieces.map((x) => `${x.slot}${x.n}`)).sort();
      assert.equal(new Set(names).size, names.length);
    });
  }

  test("page counts: 3 safe, 2 borderless; gaps 4 / 3 mm", () => {
    assert.equal(PRINT_LAYOUTS.SAFE_3.pages.length, 3);
    assert.equal(PRINT_LAYOUTS.SAFE_3.gap, 4);
    assert.equal(PRINT_LAYOUTS.BORDERLESS_2.pages.length, 2);
    assert.equal(PRINT_LAYOUTS.BORDERLESS_2.gap, 3);
  });

  test("a bigger photo is refused with the pieces and millimetres", () => {
    const sizes = { ...DEFAULT_PRINT_SIZES, PHOTO_L: { w: 78, h: 77.6 } };
    const problems = checkLayout(PRINT_LAYOUTS.SAFE_3, sizes).map((p) => p.message);
    assert.ok(problems.includes("Page 1: Big 1 and Big 2 are 1.8 mm too close (need a 4 mm gap)"), problems.join("\n"));
  });

  test("overlap and off-page are reported", () => {
    const overlap = checkLayout(PRINT_LAYOUTS.SAFE_3, { ...DEFAULT_PRINT_SIZES, PHOTO_L: { w: 85, h: 77.6 } });
    assert.ok(overlap.some((p) => /Big 1 and Big 2 overlap by 4\.8 mm/.test(p.message)));
    const off = checkLayout(PRINT_LAYOUTS.SAFE_3, { ...DEFAULT_PRINT_SIZES, CARD_2: { w: 99.2, h: 140 } });
    assert.ok(off.some((p) => /Page 2: Card 2 runs 11\.2 mm off the page/.test(p.message)), off.map((p) => p.message).join("\n"));
  });

  test("a smaller size is always fine (pieces never move)", () => {
    const sizes = { ...DEFAULT_PRINT_SIZES, CARD_1: { w: 120, h: 120 } };
    assert.deepEqual(checkLayout(PRINT_LAYOUTS.SAFE_3, sizes), []);
    assert.deepEqual(checkLayout(PRINT_LAYOUTS.BORDERLESS_2, sizes), []);
  });

  test("settings JSON falls back to defaults per field", () => {
    assert.deepEqual(normalizePrintSettings(null), { sizes: DEFAULT_PRINT_SIZES, layout: "SAFE_3" });
    const s = normalizePrintSettings({ layout: "BORDERLESS_2", sizes: { PHOTO_L: { w: 76.24, h: 77.6 }, PHOTO_S: { w: 1, h: 2 } } });
    assert.equal(s.layout, "BORDERLESS_2");
    assert.deepEqual(s.sizes.PHOTO_L, { w: 76.2, h: 77.6 });
    assert.deepEqual(s.sizes.PHOTO_S, DEFAULT_PRINT_SIZES.PHOTO_S);
  });
});

describe("PP-3 card text", () => {
  test("names fill the slots; greeting and signature get their own lines", () => {
    assert.deepEqual(
      cardLines("প্রিয় {to}, ভুল হয়ে গেছে, ক্ষমা করে দিও। তোমার রাগ ভাঙাতে এই ছোট্ট উপহার। — {from}", {
        to: "নুসরাত",
        from: "রিফাত",
      }),
      ["প্রিয় নুসরাত,", "ভুল হয়ে গেছে, ক্ষমা করে দিও। তোমার রাগ ভাঙাতে এই ছোট্ট উপহার।", "— রিফাত"]
    );
  });

  test("empty names drop the name lines cleanly", () => {
    assert.deepEqual(
      cardLines("প্রিয় {to}, শুভ জন্মদিন! — {from}", { to: " ", from: "" }),
      ["শুভ জন্মদিন!"]
    );
    assert.deepEqual(
      cardLines("প্রিয় মা, তোমার দোয়াতেই আমি আজ এতদূর। — তোমার {from}"),
      ["প্রিয় মা,", "তোমার দোয়াতেই আমি আজ এতদূর।"]
    );
    // Only the empty one goes.
    assert.deepEqual(cardLines("Dear {to}, Happy Birthday! — {from}", { from: "Rifat" }), [
      "Happy Birthday!",
      "— Rifat",
    ]);
  });

  test("a slot inside a sentence is removed with its punctuation", () => {
    assert.deepEqual(cardLines("Happy Birthday, {to}! Stay happy. — {from}"), ["Happy Birthday! Stay happy."]);
    assert.deepEqual(cardLines("Missing you so much, {to}। খুব শিগগিরই আসছি। — {from}"), [
      "Missing you so much। খুব শিগগিরই আসছি।",
    ]);
  });

  test("a dropped English greeting capitalises the next line", () => {
    assert.deepEqual(cardLines("Dear {to}, distance means so little. — {from}"), ["Distance means so little."]);
  });

  test("a dash inside the message is not a signature", () => {
    assert.deepEqual(cardLines("I'm sorry. You mean the world to me — please forgive me."), [
      "I'm sorry. You mean the world to me — please forgive me.",
    ]);
    assert.deepEqual(cardLines("আজ তোমার আসার দিন — আমার জীবনের সবচেয়ে সুন্দর দিন।"), [
      "আজ তোমার আসার দিন — আমার জীবনের সবচেয়ে সুন্দর দিন।",
    ]);
  });

  test("explicit line breaks are kept; blank lines dropped", () => {
    assert.deepEqual(cardLines("Line one\n\n  Line two  "), ["Line one", "Line two"]);
  });

  test("every seed message renders with and without names, never leaving a slot", () => {
    assert.equal(SEED_CARD_MESSAGES.length, 27);
    assert.equal(new Set(SEED_CARD_MESSAGES.map((m) => m.text)).size, 27, "texts are unique");
    for (const m of SEED_CARD_MESSAGES) {
      for (const names of [{}, { to: "নুসরাত", from: "Rifat" }]) {
        const out = cardLines(m.text, names);
        assert.ok(out.length > 0, m.text);
        assert.ok(out.every((l) => !/\{(to|from)\}/.test(l) && l === l.trim() && !/\s{2}/.test(l)), m.text);
      }
      if (hasNameSlots(m.text)) {
        const joined = cardLines(m.text, { to: "TO_NAME", from: "FROM_NAME" }).join(" ");
        if (m.text.includes("{to}")) assert.ok(joined.includes("TO_NAME"), m.text);
        if (m.text.includes("{from}")) assert.ok(joined.includes("FROM_NAME"), m.text);
      }
    }
  });
});
