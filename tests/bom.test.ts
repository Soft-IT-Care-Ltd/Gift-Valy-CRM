// Unit tests for the recursive BOM engine (lib/bom.ts) — CORRECTIONS
// Products §1–§5. Pure in-memory graphs, no DB. Run: npm run test:bom
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BomError,
  MAX_PACKAGE_DEPTH,
  assertValidPackageBom,
  collectChoiceGroups,
  explodePackage,
  explodeProduct,
  packageContentsTree,
  productContentsTree,
  packageAvailability,
  packageCost,
  packageWeightKg,
  productAvailability,
  productEffectiveCost,
  productWeightKg,
  resolveChoice,
  selectionsFromJson,
  type BomCatalog,
  type BomLine,
  type BomProduct,
  type BomPackage,
} from "../lib/bom";

// ---------- terse catalog builders ----------

let lineId = 1000;

function product(
  id: number,
  name: string,
  over: Partial<BomProduct> = {}
): BomProduct {
  return {
    id,
    name,
    productType: "SELLABLE",
    isStockTracked: true,
    stockQty: 100,
    avgCost: 0,
    weightKg: null,
    components: [],
    ...over,
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

function pkg(
  id: number,
  name: string,
  items: BomLine[],
  weightKg: number | null = null
): BomPackage {
  return { id, name, weightKg, items };
}

function catalogOf(products: BomProduct[], packages: BomPackage[]): BomCatalog {
  return {
    products: new Map(products.map((p) => [p.id, p])),
    packages: new Map(packages.map((p) => [p.id, p])),
  };
}

// The running example from CORRECTIONS Products §2/§5:
//   Products: Dairy Milk(1), KitKat(2), Safety Box(10, component),
//             Wishing Card(3), Red Teddy(4), Pink Teddy(5), Saree(6),
//             Big Carton(11, component), Combo Box(12, component),
//             Cake(7, per-order)
//   Chocolate Box product(8) has its own component: 1 Safety Box
//   Chocolate Box PACKAGE(100) = 1 Choc-Box-product + 5 Dairy Milk + 6 KitKat + 1 Card
//   Saree Box PACKAGE(101)     = 1 Saree (saree has 1 Combo Box component)
//   Probashi Combo PACKAGE(102)= ChocolateBox pkg + SareeBox pkg
//                                + choice[Red|Pink Teddy] + 1 Big Carton
const GROUP_TEDDY = 500;

function demoCatalog(): BomCatalog {
  return catalogOf(
    [
      product(1, "Dairy Milk", { avgCost: 100, weightKg: 0.05, stockQty: 60 }),
      product(2, "KitKat", { avgCost: 50, weightKg: 0.04, stockQty: 120 }),
      product(3, "Wishing Card", { avgCost: 10, weightKg: 0.01, stockQty: 40 }),
      product(4, "Red Teddy", { avgCost: 450, weightKg: 0.35, stockQty: 9 }),
      product(5, "Pink Teddy", { avgCost: 480, weightKg: 0.35, stockQty: 2 }),
      product(6, "Saree", {
        avgCost: 2200,
        weightKg: 0.5,
        stockQty: 8,
        components: [{ componentId: 12, qty: 1 }],
      }),
      product(7, "Cake", {
        avgCost: 550,
        isStockTracked: false,
        stockQty: 0,
        weightKg: 1,
      }),
      product(8, "Chocolate Box (product)", {
        avgCost: 950,
        weightKg: 0.4,
        stockQty: 30,
        components: [{ componentId: 10, qty: 1 }],
      }),
      product(10, "Safety Box", {
        productType: "COMPONENT",
        avgCost: 30,
        weightKg: 0.05,
        stockQty: 150,
      }),
      product(11, "Big Carton", {
        productType: "COMPONENT",
        avgCost: 60,
        weightKg: 0.2,
        stockQty: 5,
      }),
      product(12, "Combo Box", {
        productType: "COMPONENT",
        avgCost: 45,
        weightKg: 0.1,
        stockQty: 60,
      }),
    ],
    [
      pkg(100, "Chocolate Box (package)", [
        line({ productId: 8, qty: 1 }),
        line({ productId: 1, qty: 5 }),
        line({ productId: 2, qty: 6 }),
        line({ productId: 3, qty: 1 }),
      ]),
      pkg(101, "Saree Box", [line({ productId: 6, qty: 1 })]),
      pkg(102, "Probashi Combo", [
        line({ kind: "PACKAGE", childPackageId: 100, qty: 1 }),
        line({ kind: "PACKAGE", childPackageId: 101, qty: 1 }),
        line({
          id: GROUP_TEDDY,
          kind: "CHOICE",
          choiceLabel: "Teddy colour",
          qty: 1,
          options: [
            { productId: 4, isDefault: true },
            { productId: 5, isDefault: false },
          ],
        }),
        line({ productId: 11, qty: 1 }),
      ]),
    ]
  );
}

// ---------- explosion / stock deduction ----------

describe("explosion (stock deduction quantities)", () => {
  test("product explosion includes its packing materials, scaled by qty", () => {
    const c = demoCatalog();
    // 3 Chocolate Box products → 3 boxes + 3 safety boxes (§2)
    const leaves = explodeProduct(c, 8, 3);
    assert.deepEqual(
      [...leaves.entries()].sort(),
      [
        [8, 3],
        [10, 3],
      ].sort()
    );
  });

  test("BOM qty drives everything: 3 packages × KitKat 6 = 18 (§4)", () => {
    const c = demoCatalog();
    const leaves = explodePackage(c, 100, 3);
    assert.equal(leaves.get(2), 18); // KitKat 6 × 3
    assert.equal(leaves.get(1), 15); // Dairy Milk 5 × 3
    assert.equal(leaves.get(8), 3);
    assert.equal(leaves.get(10), 3); // safety box via product component — NOT re-listed
  });

  test("nested combo explodes recursively with default choice (§5)", () => {
    const c = demoCatalog();
    const leaves = explodePackage(c, 102, 1);
    assert.equal(leaves.get(8), 1); // choc box product (via sub-package)
    assert.equal(leaves.get(10), 1); // its safety box, auto-included
    assert.equal(leaves.get(1), 5);
    assert.equal(leaves.get(2), 6);
    assert.equal(leaves.get(3), 1);
    assert.equal(leaves.get(6), 1); // saree via sub-package
    assert.equal(leaves.get(12), 1); // combo box via saree's component
    assert.equal(leaves.get(4), 1); // default teddy = Red
    assert.equal(leaves.get(5), undefined); // pink not chosen
    assert.equal(leaves.get(11), 1); // big carton (package-level material)
  });

  test("choice selection routes stock to the chosen variant (§5)", () => {
    const c = demoCatalog();
    const leaves = explodePackage(c, 102, 2, new Map([[GROUP_TEDDY, 5]]));
    assert.equal(leaves.get(5), 2); // pink chosen ×2 packages
    assert.equal(leaves.get(4), undefined);
  });

  test("selection for a product that is not an option throws", () => {
    const c = demoCatalog();
    assert.throws(
      () => explodePackage(c, 102, 1, new Map([[GROUP_TEDDY, 6]])),
      BomError
    );
  });
});

// ---------- cost ----------

describe("cost", () => {
  test("product effective cost = own avg + components (§2)", () => {
    const c = demoCatalog();
    assert.equal(productEffectiveCost(c, 8), 950 + 30);
    assert.equal(productEffectiveCost(c, 1), 100); // no components
  });

  test("package cost = Σ(leaf avg × exploded qty), auto components included (§4)", () => {
    const c = demoCatalog();
    // 1×(950+30) + 5×100 + 6×50 + 1×10 = 980 + 500 + 300 + 10
    assert.equal(packageCost(c, 100), 1790);
  });

  test("nested combo cost uses default vs chosen variant (§5)", () => {
    const c = demoCatalog();
    const base = 1790 /* choc pkg */ + (2200 + 45) /* saree + combo box */ + 60; /* carton */
    assert.equal(packageCost(c, 102), base + 450); // default Red Teddy
    assert.equal(
      packageCost(c, 102, new Map([[GROUP_TEDDY, 5]])),
      base + 480 // chosen Pink Teddy
    );
  });
});

// ---------- weight ----------

describe("weight", () => {
  test("product weight includes components; missing weights count 0 (§3)", () => {
    const c = demoCatalog();
    assert.equal(productWeightKg(c, 8), 0.45); // 0.4 + safety box 0.05
    const noWeight = catalogOf([product(1, "X", { weightKg: null })], []);
    assert.equal(productWeightKg(noWeight, 1), 0);
  });

  test("package auto-weight sums the whole tree (§3)", () => {
    const c = demoCatalog();
    // choc pkg: 0.45 + 5×0.05 + 6×0.04 + 0.01 = 0.95
    assert.equal(packageWeightKg(c, 100), 0.95);
    // combo: 0.95 + (0.5+0.1) + 0.35 (red teddy) + 0.2 (carton) = 2.1
    assert.equal(packageWeightKg(c, 102), 2.1);
  });

  test("manual override wins, including on nested sub-packages", () => {
    const c = demoCatalog();
    c.packages.get(100)!.weightKg = 1.5;
    assert.equal(packageWeightKg(c, 100), 1.5);
    // combo now uses the sub-package's override: 1.5 + 0.6 + 0.35 + 0.2
    assert.equal(packageWeightKg(c, 102), 2.65);
  });
});

// ---------- availability ----------

describe("availability", () => {
  test("min over stock-tracked leaves of ⌊stock ÷ qty⌋ (§4)", () => {
    const c = demoCatalog();
    // choc pkg: choc 30/1, safety 150/1, milk 60/5=12, kitkat 120/6=20, card 40/1
    assert.equal(packageAvailability(c, 100), 12);
  });

  test("per-order (non-tracked) leaves never constrain; all-per-order → null", () => {
    const c = catalogOf(
      [product(7, "Cake", { isStockTracked: false, stockQty: 0 })],
      [pkg(200, "Cake pack", [line({ productId: 7, qty: 1 })])]
    );
    assert.equal(packageAvailability(c, 200), null);
  });

  test("nested combo availability follows the chosen variant (§5)", () => {
    const c = demoCatalog();
    // default (Red, stock 9): binding leaf is big carton 5
    assert.equal(packageAvailability(c, 102), 5);
    // pink teddy stock 2 → becomes the binding constraint
    assert.equal(
      packageAvailability(c, 102, new Map([[GROUP_TEDDY, 5]])),
      2
    );
  });

  test("standalone product availability constrained by its packing materials (§2)", () => {
    const c = demoCatalog();
    c.products.get(10)!.stockQty = 4; // only 4 safety boxes left
    assert.equal(productAvailability(c, 8), 4); // not 30
  });
});

// ---------- choice groups ----------

describe("choice groups", () => {
  test("collectChoiceGroups walks the nested tree with paths", () => {
    const c = demoCatalog();
    const groups = collectChoiceGroups(c, 102);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].groupId, GROUP_TEDDY);
    assert.equal(groups[0].label, "Teddy colour");
    assert.deepEqual(
      groups[0].options.map((o) => o.productId),
      [4, 5]
    );
  });

  test("resolveChoice: explicit pick > default > first; empty group throws", () => {
    const l = line({
      kind: "CHOICE",
      options: [
        { productId: 4, isDefault: false },
        { productId: 5, isDefault: true },
      ],
    });
    assert.equal(resolveChoice(l, new Map([[l.id, 4]])), 4);
    assert.equal(resolveChoice(l), 5);
    assert.throws(() => resolveChoice(line({ kind: "CHOICE" })), BomError);
  });

  test("selectionsFromJson parses stored picks and ignores junk", () => {
    const map = selectionsFromJson([
      { groupId: 500, label: "Teddy", productId: 5, name: "Pink" },
      { bogus: true },
      "junk",
    ]);
    assert.equal(map.get(500), 5);
    assert.equal(map.size, 1);
    assert.equal(selectionsFromJson(null).size, 0);
    assert.equal(selectionsFromJson({ 500: 5 }).size, 0); // not an array
  });
});

// ---------- contents tree (packing view / invoice, CORRECTIONS §2.2) ----------

describe("contents tree (§2.2)", () => {
  test("package tree keeps nesting: sub-packages, choices, materials", () => {
    const c = demoCatalog();
    const tree = packageContentsTree(c, 102);
    assert.equal(tree.kind, "PACKAGE");
    assert.equal(tree.name, "Probashi Combo");
    assert.deepEqual(
      tree.children.map((n) => [n.kind, n.name]),
      [
        ["PACKAGE", "Chocolate Box (package)"],
        ["PACKAGE", "Saree Box"],
        ["PRODUCT", "Red Teddy"], // default choice resolved
        ["MATERIAL", "Big Carton"], // package-level COMPONENT product
      ]
    );
    // The chosen variant carries its group label for the packing view.
    assert.equal(tree.children[2].choiceLabel, "Teddy colour");
    // Inside the sub-package: the choc-box product with its OWN packing
    // material as a MATERIAL child (never re-listed at package level).
    const chocBox = tree.children[0];
    assert.deepEqual(
      chocBox.children.map((n) => [n.kind, n.name, n.qty]),
      [
        ["PRODUCT", "Chocolate Box (product)", 1],
        ["PRODUCT", "Dairy Milk", 5],
        ["PRODUCT", "KitKat", 6],
        ["PRODUCT", "Wishing Card", 1],
      ]
    );
    assert.deepEqual(
      chocBox.children[0].children.map((n) => [n.kind, n.name]),
      [["MATERIAL", "Safety Box"]]
    );
  });

  test("selections route the choice node; qty scales the whole tree", () => {
    const c = demoCatalog();
    const tree = packageContentsTree(c, 102, 2, new Map([[GROUP_TEDDY, 5]]));
    const teddy = tree.children[2];
    assert.equal(teddy.name, "Pink Teddy");
    assert.equal(teddy.qty, 2);
    // Dairy Milk sits two levels deep: 5 per package × 2 packages.
    assert.equal(tree.children[0].children[1].qty, 10);
    // Saree's own Combo Box material also scales.
    assert.deepEqual(
      tree.children[1].children[0].children.map((n) => [n.kind, n.qty]),
      [["MATERIAL", 2]]
    );
  });

  test("product tree = the product with its materials as children", () => {
    const c = demoCatalog();
    const tree = productContentsTree(c, 8, 3);
    assert.equal(tree.kind, "PRODUCT");
    assert.equal(tree.qty, 3);
    assert.deepEqual(
      tree.children.map((n) => [n.kind, n.name, n.qty]),
      [["MATERIAL", "Safety Box", 3]]
    );
  });

  test("tree walk enforces cycles and the depth cap like the explosion", () => {
    const cyc = catalogOf(
      [product(1, "X")],
      [pkg(200, "Self", [line({ kind: "PACKAGE", childPackageId: 200 })])]
    );
    assert.throws(() => packageContentsTree(cyc, 200), BomError);
  });
});

// ---------- cycle prevention & depth cap ----------

describe("cycle prevention (§5)", () => {
  test("a package directly containing itself throws", () => {
    const c = catalogOf(
      [product(1, "X")],
      [pkg(100, "Self", [line({ kind: "PACKAGE", childPackageId: 100 })])]
    );
    assert.throws(() => explodePackage(c, 100, 1), /cycle/i);
  });

  test("an indirect cycle (A → B → A) throws", () => {
    const c = catalogOf(
      [product(1, "X")],
      [
        pkg(100, "A", [line({ kind: "PACKAGE", childPackageId: 101 })]),
        pkg(101, "B", [line({ kind: "PACKAGE", childPackageId: 100 })]),
      ]
    );
    assert.throws(() => explodePackage(c, 100, 1), /cycle/i);
    assert.throws(() => packageWeightKg(c, 100), /cycle/i);
    assert.throws(() => collectChoiceGroups(c, 100), /cycle/i);
  });

  test("product-component cycles throw instead of hanging", () => {
    const c = catalogOf(
      [
        product(1, "A", { components: [{ componentId: 2, qty: 1 }] }),
        product(2, "B", { components: [{ componentId: 1, qty: 1 }] }),
      ],
      []
    );
    assert.throws(() => explodeProduct(c, 1), /cycle/i);
  });

  test(`nesting beyond ${MAX_PACKAGE_DEPTH} levels throws`, () => {
    const chain = [
      pkg(100, "L1", [line({ kind: "PACKAGE", childPackageId: 101 })]),
      pkg(101, "L2", [line({ kind: "PACKAGE", childPackageId: 102 })]),
      pkg(102, "L3", [line({ kind: "PACKAGE", childPackageId: 103 })]),
      pkg(103, "L4", [line({ productId: 1 })]),
    ];
    const c = catalogOf([product(1, "X")], chain);
    assert.throws(() => explodePackage(c, 100, 1), /nesting/i);
    // …but the allowed depth explodes fine from one level down
    assert.equal(explodePackage(c, 101, 1).get(1), 1);
  });

  test("assertValidPackageBom rejects an edit that introduces a cycle", () => {
    const c = demoCatalog();
    // Editing "Chocolate Box (package)" (100) to contain the combo (102),
    // which already contains 100 → cycle.
    assert.throws(
      () =>
        assertValidPackageBom(c, 100, [
          line({ kind: "PACKAGE", childPackageId: 102 }),
        ]),
      /cycle/i
    );
    // A legal edit passes.
    assert.doesNotThrow(() =>
      assertValidPackageBom(c, 100, [line({ productId: 1, qty: 2 })])
    );
  });

  test("assertValidPackageBom re-walks parents for the depth cap", () => {
    // grandparent(300) → parent(301) → leaf(302); editing leaf to contain a
    // new sub-package pushes the chain past MAX_PACKAGE_DEPTH.
    const c = catalogOf(
      [product(1, "X")],
      [
        pkg(300, "GP", [line({ kind: "PACKAGE", childPackageId: 301 })]),
        pkg(301, "P", [line({ kind: "PACKAGE", childPackageId: 302 })]),
        pkg(302, "Leaf", [line({ productId: 1 })]),
        pkg(303, "New sub", [line({ productId: 1 })]),
      ]
    );
    assert.throws(
      () =>
        assertValidPackageBom(c, 302, [
          line({ kind: "PACKAGE", childPackageId: 303 }),
        ]),
      /nesting/i
    );
  });
});
