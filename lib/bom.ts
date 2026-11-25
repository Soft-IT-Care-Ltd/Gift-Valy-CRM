// ============ CORRECTIONS Products §1–§5 — the recursive BOM engine ============
//
// One package explodes into leaf PRODUCTS through three kinds of BOM line
// (PRODUCT / nested PACKAGE / CHOICE group) plus each product's own packing
// materials (product_components). Everything downstream — cost, weight, stock
// reserve/deduct, availability, the Requirement Planner, damage inspection —
// must run off the SAME explosion, so it lives here as pure functions over an
// in-memory catalog graph (unit-testable without a DB; lib/stock.ts and the
// serializers load the graph with loadBomCatalog and call these).
//
// Semantics:
//   explode(product)  = the product itself + qty × each of its components
//                       (components recurse defensively, though the API only
//                       allows one level: SELLABLE → COMPONENT)
//   explode(package)  = per line: PRODUCT → explode(product) × qty
//                                 PACKAGE → explode(child package) × qty
//                                 CHOICE  → explode(chosen | default option) × qty
//   Package BOMs list only products + package-level materials — a product's own
//   box arrives via explode(product), never re-listed (no double count, §2).
//
// Cycle prevention (§5): a package may never contain itself directly or
// indirectly; nesting is capped at MAX_PACKAGE_DEPTH levels. Both throw
// BomError so API validation and packing fail loudly instead of looping.

import type { PrintKitSpec } from "./print-kit";

export const MAX_PACKAGE_DEPTH = 3;

export class BomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BomError";
  }
}

export type BomProductType = "SELLABLE" | "COMPONENT";
export type BomLineKind = "PRODUCT" | "PACKAGE" | "CHOICE";

export interface BomProduct {
  id: number;
  name: string;
  productType: BomProductType;
  isStockTracked: boolean;
  stockQty: number;
  avgCost: number;
  weightKg: number | null;
  /** Product-level packing materials (CORRECTIONS Products §2). */
  components: { componentId: number; qty: number }[];
  /** PHOTO_PRINT PP-2 — photos/cards one unit needs (null/absent = none). */
  printKit?: PrintKitSpec | null;
}

export interface BomLine {
  /** package_items.id — the key choice selections are stored under. */
  id: number;
  kind: BomLineKind;
  productId: number | null;
  childPackageId: number | null;
  choiceLabel: string | null;
  qty: number;
  /** extraPrice (ROUND3 R3-2): ৳ per piece of the option when picked; absent = 0. */
  options: { productId: number; isDefault: boolean; extraPrice?: number }[];
}

export interface BomPackage {
  id: number;
  name: string;
  /** ROUND3 R3-2 — list price / floor before choice extras (absent = 0). */
  sellingPrice?: number;
  priceFloor?: number;
  /** Manual weight override — null means auto-sum from the explosion. */
  weightKg: number | null;
  items: BomLine[];
  /** PHOTO_PRINT PP-2 — the package's own photos/cards per unit (null = none). */
  printKit?: PrintKitSpec | null;
}

export interface BomCatalog {
  products: Map<number, BomProduct>;
  packages: Map<number, BomPackage>;
}

/** groupId (package_items.id of the CHOICE line) → chosen productId. */
export type ChoiceSelections = ReadonlyMap<number, number> | Record<number | string, number>;

/** The shape stored in order_items.choice_selections — label/name are
 *  snapshots so packing/detail views stay readable if the catalog changes. */
export interface StoredChoiceSelection {
  groupId: number;
  label: string;
  productId: number;
  name: string;
  /** ROUND3 R3-2 — the option's extra price (৳ per piece) when the line was
   *  saved, and the pieces per ONE package. Absent on lines saved before
   *  R3-2 — those count as +৳0 (their price never included an extra). */
  extraPrice?: number;
  qty?: number;
}

/** order_items.choice_selections (JSON) → groupId→productId map. Tolerates
 *  null/malformed values (legacy orders have none). */
export function selectionsFromJson(json: unknown): Map<number, number> {
  const map = new Map<number, number>();
  if (Array.isArray(json)) {
    for (const row of json) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as StoredChoiceSelection).groupId === "number" &&
        typeof (row as StoredChoiceSelection).productId === "number"
      ) {
        const r = row as StoredChoiceSelection;
        map.set(r.groupId, r.productId);
      }
    }
  }
  return map;
}

function selectionFor(
  selections: ChoiceSelections | undefined,
  groupId: number
): number | undefined {
  if (!selections) return undefined;
  if (selections instanceof Map) return selections.get(groupId);
  const v = (selections as Record<string, number>)[String(groupId)];
  return typeof v === "number" ? v : undefined;
}

function productOrThrow(catalog: BomCatalog, id: number): BomProduct {
  const p = catalog.products.get(id);
  if (!p) throw new BomError(`BOM references missing product #${id}`);
  return p;
}

function packageOrThrow(catalog: BomCatalog, id: number): BomPackage {
  const p = catalog.packages.get(id);
  if (!p) throw new BomError(`BOM references missing package #${id}`);
  return p;
}

/** The product a CHOICE line resolves to: explicit selection, else default,
 *  else the first option (a group should always carry a default). */
export function resolveChoice(
  line: BomLine,
  selections?: ChoiceSelections
): number {
  if (line.options.length === 0) {
    throw new BomError(
      `Choice group "${line.choiceLabel ?? line.id}" has no options`
    );
  }
  const chosen = selectionFor(selections, line.id);
  if (chosen !== undefined) {
    if (!line.options.some((o) => o.productId === chosen)) {
      throw new BomError(
        `Product #${chosen} is not an option of choice group "${line.choiceLabel ?? line.id}"`
      );
    }
    return chosen;
  }
  return (line.options.find((o) => o.isDefault) ?? line.options[0]).productId;
}

// ---------- the explosion ----------

/** Leaf requirement per product id, for ONE unit of the root item. */
export type Explosion = Map<number, number>;

function addTo(map: Explosion, productId: number, qty: number) {
  map.set(productId, (map.get(productId) ?? 0) + qty);
}

// Product explosion: the product itself + its packing materials. The API keeps
// this one level deep (SELLABLE → COMPONENT), but recurse defensively with a
// visited set so a hand-crafted cyclic graph errors instead of hanging.
function explodeProductInto(
  catalog: BomCatalog,
  out: Explosion,
  productId: number,
  qty: number,
  chain: number[]
) {
  if (chain.includes(productId)) {
    const p = catalog.products.get(productId);
    throw new BomError(
      `Component cycle detected at product "${p?.name ?? productId}"`
    );
  }
  const product = productOrThrow(catalog, productId);
  addTo(out, productId, qty);
  for (const c of product.components) {
    explodeProductInto(catalog, out, c.componentId, qty * c.qty, [
      ...chain,
      productId,
    ]);
  }
}

function explodePackageInto(
  catalog: BomCatalog,
  out: Explosion,
  packageId: number,
  qty: number,
  selections: ChoiceSelections | undefined,
  chain: number[]
) {
  if (chain.includes(packageId)) {
    const p = catalog.packages.get(packageId);
    throw new BomError(
      `Package cycle detected: "${p?.name ?? packageId}" contains itself (directly or via a sub-package)`
    );
  }
  if (chain.length + 1 > MAX_PACKAGE_DEPTH) {
    throw new BomError(
      `Package nesting exceeds the maximum of ${MAX_PACKAGE_DEPTH} levels`
    );
  }
  const pkg = packageOrThrow(catalog, packageId);
  const nextChain = [...chain, packageId];
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT") {
      explodeProductInto(catalog, out, line.productId!, qty * line.qty, []);
    } else if (line.kind === "PACKAGE") {
      explodePackageInto(
        catalog,
        out,
        line.childPackageId!,
        qty * line.qty,
        selections,
        nextChain
      );
    } else {
      const chosen = resolveChoice(line, selections);
      explodeProductInto(catalog, out, chosen, qty * line.qty, []);
    }
  }
}

/** Full leaf-product requirement for `qty` units of a product (incl. its
 *  packing materials). */
export function explodeProduct(
  catalog: BomCatalog,
  productId: number,
  qty = 1
): Explosion {
  const out: Explosion = new Map();
  explodeProductInto(catalog, out, productId, qty, []);
  return out;
}

/** Full leaf-product requirement for `qty` units of a package, honouring the
 *  order's choice selections (defaults when absent). */
export function explodePackage(
  catalog: BomCatalog,
  packageId: number,
  qty = 1,
  selections?: ChoiceSelections
): Explosion {
  const out: Explosion = new Map();
  explodePackageInto(catalog, out, packageId, qty, selections, []);
  return out;
}

// ---------- derived numbers (all run off the explosion) ----------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Effective unit cost of ONE product incl. its packing materials (§2). */
export function productEffectiveCost(
  catalog: BomCatalog,
  productId: number
): number {
  let cost = 0;
  for (const [id, qty] of explodeProduct(catalog, productId)) {
    cost += qty * productOrThrow(catalog, id).avgCost;
  }
  return round2(cost);
}

/** Package cost = Σ(leaf avg cost × exploded qty) for one package (§4/§5).
 *  Catalog views pass no selections (defaults); cost snapshots pass the
 *  order's actual picks. */
export function packageCost(
  catalog: BomCatalog,
  packageId: number,
  selections?: ChoiceSelections
): number {
  let cost = 0;
  for (const [id, qty] of explodePackage(catalog, packageId, 1, selections)) {
    cost += qty * productOrThrow(catalog, id).avgCost;
  }
  return round2(cost);
}

/** Auto weight of one product incl. components; products without a weight
 *  contribute 0 (weight is optional, §3). */
export function productWeightKg(
  catalog: BomCatalog,
  productId: number
): number {
  let kg = 0;
  for (const [id, qty] of explodeProduct(catalog, productId)) {
    kg += qty * (productOrThrow(catalog, id).weightKg ?? 0);
  }
  return round3(kg);
}

// Package weight: a manual override wins outright; otherwise sum the tree,
// respecting overrides on nested sub-packages (their real weight is whatever
// the team measured, not the component sum).
function packageWeightInto(
  catalog: BomCatalog,
  packageId: number,
  selections: ChoiceSelections | undefined,
  chain: number[]
): number {
  if (chain.includes(packageId)) {
    throw new BomError(`Package cycle detected at package #${packageId}`);
  }
  if (chain.length + 1 > MAX_PACKAGE_DEPTH) {
    throw new BomError(
      `Package nesting exceeds the maximum of ${MAX_PACKAGE_DEPTH} levels`
    );
  }
  const pkg = packageOrThrow(catalog, packageId);
  if (pkg.weightKg != null) return pkg.weightKg;
  let kg = 0;
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT") {
      kg += line.qty * productWeightKg(catalog, line.productId!);
    } else if (line.kind === "PACKAGE") {
      kg +=
        line.qty *
        packageWeightInto(catalog, line.childPackageId!, selections, [
          ...chain,
          packageId,
        ]);
    } else {
      kg += line.qty * productWeightKg(catalog, resolveChoice(line, selections));
    }
  }
  return round3(kg);
}

export function packageWeightKg(
  catalog: BomCatalog,
  packageId: number,
  selections?: ChoiceSelections
): number {
  return packageWeightInto(catalog, packageId, selections, []);
}

/** Available-to-sell = min over stock-tracked leaves of ⌊available ÷ qty per
 *  unit⌋ (§4/§5). `available` defaults to raw stockQty (catalog view); pass
 *  useAvailable to net out reservations where that matters. Non-tracked
 *  leaves never constrain; null = unconstrained (every leaf is per-order). */
export function packageAvailability(
  catalog: BomCatalog,
  packageId: number,
  selections?: ChoiceSelections
): number | null {
  let min: number | null = null;
  for (const [id, qty] of explodePackage(catalog, packageId, 1, selections)) {
    const p = productOrThrow(catalog, id);
    if (!p.isStockTracked) continue;
    const can = Math.floor(p.stockQty / qty);
    min = min === null ? can : Math.min(min, can);
  }
  return min;
}

/** Same, for a standalone product (its own stock AND its packing materials
 *  can constrain how many can ship). */
export function productAvailability(
  catalog: BomCatalog,
  productId: number
): number | null {
  let min: number | null = null;
  for (const [id, qty] of explodeProduct(catalog, productId)) {
    const p = productOrThrow(catalog, id);
    if (!p.isStockTracked) continue;
    const can = Math.floor(p.stockQty / qty);
    min = min === null ? can : Math.min(min, can);
  }
  return min;
}

// ---------- structured contents tree (packing view / invoice, §2.2) ----------

/** One node of an item's exploded contents, structure preserved: which
 *  component sits inside which package, which choice group a variant came
 *  from, and which lines are packing materials. The flat Explosion drives
 *  stock math; this tree drives what humans read. */
export interface BomTreeNode {
  kind: "PRODUCT" | "PACKAGE" | "MATERIAL";
  productId: number | null;
  packageId: number | null;
  name: string;
  /** Total quantity for the qty passed to the root call. */
  qty: number;
  /** Label of the CHOICE group this product was resolved from, if any. */
  choiceLabel: string | null;
  children: BomTreeNode[];
}

function productTreeNode(
  catalog: BomCatalog,
  productId: number,
  qty: number,
  asMaterial: boolean,
  choiceLabel: string | null,
  chain: number[]
): BomTreeNode {
  if (chain.includes(productId)) {
    const p = catalog.products.get(productId);
    throw new BomError(
      `Component cycle detected at product "${p?.name ?? productId}"`
    );
  }
  const product = productOrThrow(catalog, productId);
  return {
    kind: asMaterial ? "MATERIAL" : "PRODUCT",
    productId,
    packageId: null,
    name: product.name,
    qty,
    choiceLabel,
    children: product.components.map((c) =>
      productTreeNode(catalog, c.componentId, qty * c.qty, true, null, [
        ...chain,
        productId,
      ])
    ),
  };
}

function packageTreeNode(
  catalog: BomCatalog,
  packageId: number,
  qty: number,
  selections: ChoiceSelections | undefined,
  chain: number[]
): BomTreeNode {
  if (chain.includes(packageId)) {
    const p = catalog.packages.get(packageId);
    throw new BomError(
      `Package cycle detected: "${p?.name ?? packageId}" contains itself (directly or via a sub-package)`
    );
  }
  if (chain.length + 1 > MAX_PACKAGE_DEPTH) {
    throw new BomError(
      `Package nesting exceeds the maximum of ${MAX_PACKAGE_DEPTH} levels`
    );
  }
  const pkg = packageOrThrow(catalog, packageId);
  const nextChain = [...chain, packageId];
  const children: BomTreeNode[] = [];
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT") {
      // A COMPONENT-type product on a package BOM is a package-level packing
      // material (big carton, wrap) — mark it so views can badge/hide it.
      const isMaterial =
        productOrThrow(catalog, line.productId!).productType === "COMPONENT";
      children.push(
        productTreeNode(
          catalog,
          line.productId!,
          qty * line.qty,
          isMaterial,
          null,
          []
        )
      );
    } else if (line.kind === "PACKAGE") {
      children.push(
        packageTreeNode(
          catalog,
          line.childPackageId!,
          qty * line.qty,
          selections,
          nextChain
        )
      );
    } else {
      children.push(
        productTreeNode(
          catalog,
          resolveChoice(line, selections),
          qty * line.qty,
          false,
          line.choiceLabel ?? "Choose one",
          []
        )
      );
    }
  }
  return {
    kind: "PACKAGE",
    productId: null,
    packageId,
    name: pkg.name,
    qty,
    choiceLabel: null,
    children,
  };
}

/** Contents tree for `qty` units of a standalone product — the product with
 *  its packing materials as MATERIAL children. */
export function productContentsTree(
  catalog: BomCatalog,
  productId: number,
  qty = 1
): BomTreeNode {
  return productTreeNode(catalog, productId, qty, false, null, []);
}

/** Contents tree for `qty` units of a package, honouring the order's choice
 *  selections (defaults when absent). Same walk as explodePackage, keeping
 *  the nesting instead of flattening. */
export function packageContentsTree(
  catalog: BomCatalog,
  packageId: number,
  qty = 1,
  selections?: ChoiceSelections
): BomTreeNode {
  return packageTreeNode(catalog, packageId, qty, selections, []);
}

// ---------- print kits (PHOTO_PRINT.md PP-2) ----------

/** One kit inside an item, per ONE unit of that item: a kit-carrying product,
 *  or a package's own kit. `path` names where it sits — stable across catalog
 *  edits because it is built from package/product ids, never from
 *  package_items ids (a BOM save recreates those): "P5" (the product itself /
 *  a PRODUCT line), "K7/P5" (inside sub-package 7), "C5" (chosen option of a
 *  choice group), "PKG" / "K7/PKG" (the package's — or sub-package 7's — own
 *  kit). Exactly one of productId / packageId is set. */
export interface PrintKitNeed {
  productId: number | null;
  packageId: number | null;
  path: string;
  units: number;
  kit: PrintKitSpec;
}

/** Print kits for one unit of a standalone product. Only the product's own
 *  kit counts — packing materials never carry one. */
export function productPrintKitNeeds(
  catalog: BomCatalog,
  productId: number
): PrintKitNeed[] {
  const p = productOrThrow(catalog, productId);
  return p.printKit ? [{ productId, packageId: null, path: `P${productId}`, units: 1, kit: p.printKit }] : [];
}

/** Print kits for one unit of a package: the same walk as explodePackage
 *  (nested packages, the chosen — or default — option of each choice group),
 *  so a package inherits the kit of every kit-carrying product inside it —
 *  plus its own kit, and the own kit of every sub-package. */
export function packagePrintKitNeeds(
  catalog: BomCatalog,
  packageId: number,
  selections?: ChoiceSelections
): PrintKitNeed[] {
  const out = new Map<string, PrintKitNeed>();
  printKitsInto(catalog, out, packageId, 1, "", selections, []);
  return [...out.values()];
}

function printKitsInto(
  catalog: BomCatalog,
  out: Map<string, PrintKitNeed>,
  packageId: number,
  qty: number,
  prefix: string,
  selections: ChoiceSelections | undefined,
  chain: number[]
) {
  if (chain.includes(packageId)) {
    const p = catalog.packages.get(packageId);
    throw new BomError(
      `Package cycle detected: "${p?.name ?? packageId}" contains itself (directly or via a sub-package)`
    );
  }
  if (chain.length + 1 > MAX_PACKAGE_DEPTH) {
    throw new BomError(
      `Package nesting exceeds the maximum of ${MAX_PACKAGE_DEPTH} levels`
    );
  }
  const pkg = packageOrThrow(catalog, packageId);
  if (pkg.printKit) {
    const path = `${prefix}PKG`;
    const prev = out.get(path);
    if (prev) prev.units += qty;
    else out.set(path, { productId: null, packageId, path, units: qty, kit: pkg.printKit });
  }
  const add = (productId: number, path: string, units: number) => {
    const p = productOrThrow(catalog, productId);
    if (!p.printKit) return;
    const prev = out.get(path);
    // Two choice groups of one package may resolve to the same product.
    if (prev) prev.units += units;
    else out.set(path, { productId, packageId: null, path, units, kit: p.printKit });
  };
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT") {
      add(line.productId!, `${prefix}P${line.productId}`, qty * line.qty);
    } else if (line.kind === "PACKAGE") {
      printKitsInto(
        catalog,
        out,
        line.childPackageId!,
        qty * line.qty,
        `${prefix}K${line.childPackageId}/`,
        selections,
        [...chain, packageId]
      );
    } else {
      const chosen = resolveChoice(line, selections);
      add(chosen, `${prefix}C${chosen}`, qty * line.qty);
    }
  }
}

// ---------- choice groups of a package tree (order form / detail) ----------

export interface ChoiceGroupInfo {
  groupId: number;
  label: string;
  qty: number; // per one root package (line qty × parent multipliers)
  /** Path of package names from the root (["Probashi Combo", "Chocolate Box"]). */
  path: string[];
  /** The same path as package ids (the website shows each one's website name). */
  pathIds: number[];
  options: { productId: number; isDefault: boolean; extraPrice: number }[];
}

/** Every CHOICE group in the package's tree, root-first — what the order form
 *  must prompt for and what the detail/packing views label picks with. */
export function collectChoiceGroups(
  catalog: BomCatalog,
  packageId: number,
  chain: number[] = [],
  path: string[] = [],
  multiplier = 1
): ChoiceGroupInfo[] {
  if (chain.includes(packageId)) {
    throw new BomError(`Package cycle detected at package #${packageId}`);
  }
  if (chain.length + 1 > MAX_PACKAGE_DEPTH) {
    throw new BomError(
      `Package nesting exceeds the maximum of ${MAX_PACKAGE_DEPTH} levels`
    );
  }
  const pkg = packageOrThrow(catalog, packageId);
  const groups: ChoiceGroupInfo[] = [];
  for (const line of pkg.items) {
    if (line.kind === "CHOICE") {
      groups.push({
        groupId: line.id,
        label: line.choiceLabel ?? "Choose one",
        qty: line.qty * multiplier,
        path,
        pathIds: [...chain, packageId].slice(1),
        options: line.options.map((o) => ({
          productId: o.productId,
          isDefault: o.isDefault,
          extraPrice: o.extraPrice ?? 0,
        })),
      });
    } else if (line.kind === "PACKAGE") {
      groups.push(
        ...collectChoiceGroups(
          catalog,
          line.childPackageId!,
          [...chain, packageId],
          [...path, packageOrThrow(catalog, line.childPackageId!).name],
          line.qty * multiplier
        )
      );
    }
  }
  return groups;
}

// ---------- choice prices (ROUND3 R3-2) ----------
//
// Price of ONE package = its selling price + Σ over every choice group in the
// whole nested tree of (pieces of that group per package × the picked
// option's extra price). The floor rises (or falls) by the same amount, never
// below 0. A line's total is that × the line qty — the caller's job.
//
// choiceExtraTotal is THE rule. It is pure and client-safe, so the order form
// prices with the very function the server (packagePrice → order API) and,
// later, the website and website orders use.

/** The client-safe shape choiceExtraTotal prices over (collectChoiceGroups
 *  output, or the order form's copy of it). */
export interface PricedChoiceGroup {
  groupId: number;
  /** Pieces of this group per ONE root package. */
  qty: number;
  options: { productId: number; isDefault: boolean; extraPrice?: number }[];
}

/** groupId:productId → extra price saved on the order (edits keep it). */
export type FrozenExtras = ReadonlyMap<string, number>;

export const frozenKey = (groupId: number, productId: number) =>
  `${groupId}:${productId}`;

/** A saved order's picks → the extras frozen on them. Lines saved before
 *  R3-2 carry no extraPrice and freeze at 0: their price never had one. */
export function frozenExtrasFromJson(jsons: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const json of jsons) {
    if (!Array.isArray(json)) continue;
    for (const row of json) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as StoredChoiceSelection).groupId === "number" &&
        typeof (row as StoredChoiceSelection).productId === "number"
      ) {
        const r = row as StoredChoiceSelection;
        out.set(
          frozenKey(r.groupId, r.productId),
          typeof r.extraPrice === "number" && Number.isFinite(r.extraPrice) ? r.extraPrice : 0
        );
      }
    }
  }
  return out;
}

/** The extra price of one option of a group, frozen value first. */
export function optionExtra(
  groupId: number,
  option: { productId: number; extraPrice?: number },
  frozen?: FrozenExtras
): number {
  const f = frozen?.get(frozenKey(groupId, option.productId));
  return f !== undefined ? f : option.extraPrice ?? 0;
}

/** The option a group is priced at: a valid pick, else the default, else the
 *  first option (resolveChoice without the throw — the server validates). */
export function pricedOption<O extends { productId: number; isDefault: boolean }>(
  group: { groupId: number; options: O[] },
  selections?: ChoiceSelections
): O | undefined {
  const chosen = selectionFor(selections, group.groupId);
  return (
    (chosen !== undefined ? group.options.find((o) => o.productId === chosen) : undefined) ??
    group.options.find((o) => o.isDefault) ??
    group.options[0]
  );
}

/** Σ qty × extra of the picked option over all groups, for ONE package. */
export function choiceExtraTotal(
  groups: readonly PricedChoiceGroup[],
  selections?: ChoiceSelections,
  frozen?: FrozenExtras
): number {
  let extra = 0;
  for (const g of groups) {
    const o = pricedOption(g, selections);
    if (o) extra += g.qty * optionExtra(g.groupId, o, frozen);
  }
  return round2(extra);
}

export interface PackagePrice {
  /** Selling price / floor before choice extras. */
  basePrice: number;
  baseFloor: number;
  /** Σ extras of the picks, for ONE package. */
  extra: number;
  /** basePrice + extra — the suggested unit price. */
  unitPrice: number;
  /** max(0, baseFloor + extra). */
  floor: number;
  /** Every group's resolved pick with its extra — what order_items stores. */
  picks: StoredChoiceSelection[];
}

/** ROUND3 R3-2 — the one package price function (order API, website, website
 *  order). Throws BomError for a pick that is not an option of its group. */
export function packagePrice(
  catalog: BomCatalog,
  packageId: number,
  selections?: ChoiceSelections,
  frozen?: FrozenExtras
): PackagePrice {
  const pkg = packageOrThrow(catalog, packageId);
  const groups = collectChoiceGroups(catalog, packageId);
  const picks: StoredChoiceSelection[] = groups.map((g) => {
    const productId = resolveChoice(
      {
        id: g.groupId,
        kind: "CHOICE",
        productId: null,
        childPackageId: null,
        choiceLabel: g.label,
        qty: g.qty,
        options: g.options,
      },
      selections
    );
    const option = g.options.find((o) => o.productId === productId)!;
    return {
      groupId: g.groupId,
      label: g.label,
      productId,
      name: catalog.products.get(productId)?.name ?? `#${productId}`,
      extraPrice: optionExtra(g.groupId, option, frozen),
      qty: g.qty,
    };
  });
  const basePrice = pkg.sellingPrice ?? 0;
  const baseFloor = pkg.priceFloor ?? 0;
  const extra = round2(picks.reduce((s, p) => s + p.qty! * p.extraPrice!, 0));
  return {
    basePrice,
    baseFloor,
    extra,
    unitPrice: round2(basePrice + extra),
    floor: Math.max(0, round2(baseFloor + extra)),
    picks,
  };
}

/** Throws BomError when the cheapest combination of picks would take any of
 *  `packageIds` (default: every package) below ৳0 — a negative extra price
 *  may lower a package's price, never past zero. */
export function assertPackagePricesNonNegative(
  catalog: BomCatalog,
  packageIds?: Iterable<number>
): void {
  for (const id of packageIds ?? catalog.packages.keys()) {
    const pkg = packageOrThrow(catalog, id);
    let min = pkg.sellingPrice ?? 0;
    let worst: { name: string; extra: number } | null = null;
    for (const g of collectChoiceGroups(catalog, id)) {
      let cheapest = g.options[0];
      for (const o of g.options) if (o.extraPrice < cheapest.extraPrice) cheapest = o;
      if (!cheapest || cheapest.extraPrice >= 0) continue;
      min += g.qty * cheapest.extraPrice;
      if (!worst || cheapest.extraPrice < worst.extra) {
        worst = {
          name: catalog.products.get(cheapest.productId)?.name ?? `#${cheapest.productId}`,
          extra: cheapest.extraPrice,
        };
      }
    }
    if (round2(min) < 0) {
      throw new BomError(
        `"${pkg.name}" would cost −৳${Math.abs(round2(min))} with its cheapest options${
          worst ? ` ("${worst.name}" −৳${Math.abs(worst.extra)})` : ""
        } — an extra price may lower a package's price, but never below ৳0`
      );
    }
  }
}

// ---------- validation (package save) ----------

/** Throws BomError if adding `items` to package `packageId` would create a
 *  cycle or exceed the nesting cap — called BEFORE the API writes a BOM.
 *  Simulates the new BOM in a copied catalog so the check sees the edit. */
export function assertValidPackageBom(
  catalog: BomCatalog,
  packageId: number,
  items: BomLine[],
  sellingPrice?: number
): void {
  const simulated: BomCatalog = {
    products: catalog.products,
    packages: new Map(catalog.packages),
  };
  const existing = catalog.packages.get(packageId);
  simulated.packages.set(packageId, {
    id: packageId,
    name: existing?.name ?? `#${packageId}`,
    weightKg: existing?.weightKg ?? null,
    sellingPrice: sellingPrice ?? existing?.sellingPrice ?? 0,
    priceFloor: existing?.priceFloor ?? 0,
    items,
  });
  // Explode once with defaults — walks every branch, so cycles and the depth
  // cap surface here. Also validates that referenced products/packages exist
  // and every choice group has at least one option.
  explodePackage(simulated, packageId, 1);
  // A parent package containing this one may now exceed the depth cap through
  // the new sub-tree — re-walk every package that can reach this one.
  for (const [id] of simulated.packages) {
    if (id !== packageId) explodePackage(simulated, id, 1);
  }
  // ROUND3 R3-2 — this package and every package containing it are priced
  // with the new extras: none may drop below ৳0 with its cheapest picks.
  assertPackagePricesNonNegative(simulated);
}
