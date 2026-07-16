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
}

export interface BomLine {
  /** package_items.id — the key choice selections are stored under. */
  id: number;
  kind: BomLineKind;
  productId: number | null;
  childPackageId: number | null;
  choiceLabel: string | null;
  qty: number;
  options: { productId: number; isDefault: boolean }[];
}

export interface BomPackage {
  id: number;
  name: string;
  /** Manual weight override — null means auto-sum from the explosion. */
  weightKg: number | null;
  items: BomLine[];
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

// ---------- choice groups of a package tree (order form / detail) ----------

export interface ChoiceGroupInfo {
  groupId: number;
  label: string;
  qty: number; // per one root package (line qty × parent multipliers)
  /** Path of package names from the root (["Probashi Combo", "Chocolate Box"]). */
  path: string[];
  options: { productId: number; isDefault: boolean }[];
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
        options: line.options.map((o) => ({
          productId: o.productId,
          isDefault: o.isDefault,
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

// ---------- validation (package save) ----------

/** Throws BomError if adding `items` to package `packageId` would create a
 *  cycle or exceed the nesting cap — called BEFORE the API writes a BOM.
 *  Simulates the new BOM in a copied catalog so the check sees the edit. */
export function assertValidPackageBom(
  catalog: BomCatalog,
  packageId: number,
  items: BomLine[]
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
}
