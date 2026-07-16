"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "./products-client";
import { PhotoField } from "./photo-field";

type LineKind = "PRODUCT" | "PACKAGE" | "CHOICE";

interface PackageItemRow {
  id: number;
  kind: LineKind;
  productId: number | null;
  childPackageId: number | null;
  choiceLabel: string | null;
  name: string;
  code: string | null;
  unit: string | null;
  qty: number;
  isStockTracked: boolean;
  stockQty: number | null;
  options: { productId: number; name: string; isDefault: boolean }[];
  unitCost?: number;
}

interface ChoiceGroupRow {
  groupId: number;
  label: string;
  qty: number;
  path: string[];
  options: {
    productId: number;
    name: string;
    isDefault: boolean;
    stockQty: number;
    availability: number | null;
  }[];
}

interface ExplosionRow {
  productId: number;
  name: string;
  qty: number;
  isComponentType: boolean;
  autoIncludedQty: number;
}

interface PackageRow {
  id: number;
  code: string;
  name: string;
  photoUrl: string | null;
  sellingPrice: number;
  priceFloor: number;
  isActive: boolean;
  availableToSell: number | null;
  weightKg: number | null; // manual override
  autoWeightKg: number | null; // BOM-summed
  deliveryChargeInsideDhaka: number;
  deliveryChargeSubDhaka: number;
  deliveryChargeOutsideDhaka: number;
  items: PackageItemRow[];
  choiceGroups: ChoiceGroupRow[];
  explosion: ExplosionRow[];
  cost?: number; // absent for roles without cost visibility
  margin?: number;
}

interface ProductOption {
  id: number;
  name: string;
  sku: string;
  unit: string;
  productType: "SELLABLE" | "COMPONENT";
  stockQty: number;
  isStockTracked: boolean;
  avgCost?: number;
}

interface OptionState {
  productId: string;
  isDefault: boolean;
}

interface BomLineState {
  kind: LineKind;
  productId: string; // kind=PRODUCT, "" = not picked yet
  childPackageId: string; // kind=PACKAGE
  choiceLabel: string; // kind=CHOICE
  qty: string;
  options: OptionState[]; // kind=CHOICE
}

// Package-level packing materials (big carton, wrap…) — edited in their own
// section like the product form, but stored as ordinary PRODUCT BOM lines.
interface MaterialLineState {
  productId: string; // "" = not picked yet
  qty: string;
}

export function PackagesClient({
  packages,
  products,
  showCosts,
  canManage,
}: {
  packages: PackageRow[];
  products: ProductOption[];
  showCosts: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [priceFloor, setPriceFloor] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [photoUrl, setPhotoUrl] = useState("");
  const [weightKg, setWeightKg] = useState(""); // "" = auto
  const [chargeInside, setChargeInside] = useState("0");
  const [chargeSub, setChargeSub] = useState("0");
  const [chargeOutside, setChargeOutside] = useState("0");
  const [lines, setLines] = useState<BomLineState[]>([]);
  const [materialLines, setMaterialLines] = useState<MaterialLineState[]>([]);

  const productById = new Map(products.map((p) => [p.id, p]));
  // Main BOM picker shows sellable products only; packing materials get their
  // own section below (mirrors the product form) so the list stays clean.
  const sellableProducts = products.filter((p) => p.productType === "SELLABLE");
  const componentProducts = products.filter(
    (p) => p.productType === "COMPONENT"
  );

  const emptyLine = (kind: LineKind = "PRODUCT"): BomLineState => ({
    kind,
    productId: "",
    childPackageId: "",
    choiceLabel: "",
    qty: "1",
    options: kind === "CHOICE" ? [{ productId: "", isDefault: true }] : [],
  });

  function openCreate() {
    setEditing(null);
    setName("");
    setSellingPrice("");
    setPriceFloor("0");
    setIsActive(true);
    setPhotoUrl("");
    setWeightKg("");
    setChargeInside("0");
    setChargeSub("0");
    setChargeOutside("0");
    setLines([emptyLine()]);
    setMaterialLines([]);
    setDialogOpen(true);
  }

  function openEdit(pkg: PackageRow) {
    setEditing(pkg);
    setName(pkg.name);
    setSellingPrice(String(pkg.sellingPrice));
    setPriceFloor(String(pkg.priceFloor));
    setIsActive(pkg.isActive);
    setPhotoUrl(pkg.photoUrl ?? "");
    setWeightKg(pkg.weightKg == null ? "" : String(pkg.weightKg));
    setChargeInside(String(pkg.deliveryChargeInsideDhaka));
    setChargeSub(String(pkg.deliveryChargeSubDhaka));
    setChargeOutside(String(pkg.deliveryChargeOutsideDhaka));
    // Component-only PRODUCT lines are edited in the packing-materials
    // section; everything else stays in the main BOM list.
    const isMaterial = (it: PackageItemRow) =>
      it.kind === "PRODUCT" &&
      it.productId != null &&
      productById.get(it.productId)?.productType === "COMPONENT";
    setLines(
      pkg.items
        .filter((it) => !isMaterial(it))
        .map((it) => ({
          kind: it.kind,
          productId: it.productId ? String(it.productId) : "",
          childPackageId: it.childPackageId ? String(it.childPackageId) : "",
          choiceLabel: it.choiceLabel ?? "",
          qty: String(it.qty),
          options: it.options.map((o) => ({
            productId: String(o.productId),
            isDefault: o.isDefault,
          })),
        }))
    );
    setMaterialLines(
      pkg.items
        .filter(isMaterial)
        .map((it) => ({ productId: String(it.productId), qty: String(it.qty) }))
    );
    setDialogOpen(true);
  }

  function setLine(idx: number, patch: Partial<BomLineState>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    );
  }

  function lineComplete(l: BomLineState): boolean {
    if (Number(l.qty) < 1) return false;
    if (l.kind === "PRODUCT") return l.productId !== "";
    if (l.kind === "PACKAGE") return l.childPackageId !== "";
    return (
      l.choiceLabel.trim() !== "" &&
      l.options.length >= 2 &&
      l.options.every((o) => o.productId !== "") &&
      l.options.filter((o) => o.isDefault).length === 1
    );
  }

  const materialsComplete = materialLines.every(
    (l) => l.productId !== "" && Number(l.qty) >= 1
  );
  const allComplete =
    lines.length > 0 && lines.every(lineComplete) && materialsComplete;

  // Live cost preview (cost-visible roles): product lines from avg cost,
  // sub-package lines from the server-computed package cost, choice groups
  // from their default option, plus the package-level packing materials.
  // Each product's OWN packing materials are added server-side — the saved
  // cost can be slightly higher.
  const packageCostById = new Map(
    packages.filter((p) => p.cost != null).map((p) => [p.id, p.cost!])
  );
  const previewCost =
    lines.reduce((sum, l) => {
      const qty = Number(l.qty) || 0;
      if (l.kind === "PRODUCT" && l.productId) {
        return sum + qty * (productById.get(Number(l.productId))?.avgCost ?? 0);
      }
      if (l.kind === "PACKAGE" && l.childPackageId) {
        return sum + qty * (packageCostById.get(Number(l.childPackageId)) ?? 0);
      }
      if (l.kind === "CHOICE") {
        const def = l.options.find((o) => o.isDefault) ?? l.options[0];
        if (def?.productId) {
          return sum + qty * (productById.get(Number(def.productId))?.avgCost ?? 0);
        }
      }
      return sum;
    }, 0) +
    materialLines.reduce(
      (sum, l) =>
        sum +
        (Number(l.qty) || 0) *
          (productById.get(Number(l.productId))?.avgCost ?? 0),
      0
    );

  async function save() {
    setSaving(true);
    const payload = {
      name,
      sellingPrice: Number(sellingPrice) || 0,
      priceFloor: Number(priceFloor) || 0,
      isActive,
      photoUrl: photoUrl.trim() || null,
      weightKg: weightKg.trim() === "" ? null : Number(weightKg) || 0,
      deliveryChargeInsideDhaka: Number(chargeInside) || 0,
      deliveryChargeSubDhaka: Number(chargeSub) || 0,
      deliveryChargeOutsideDhaka: Number(chargeOutside) || 0,
      items: [
        ...lines.map((l) => ({
          kind: l.kind,
          productId: l.kind === "PRODUCT" ? Number(l.productId) : null,
          childPackageId: l.kind === "PACKAGE" ? Number(l.childPackageId) : null,
          choiceLabel: l.kind === "CHOICE" ? l.choiceLabel.trim() : null,
          qty: Number(l.qty),
          options:
            l.kind === "CHOICE"
              ? l.options.map((o) => ({
                  productId: Number(o.productId),
                  isDefault: o.isDefault,
                }))
              : [],
        })),
        // Packing materials are plain PRODUCT lines under the hood.
        ...materialLines.map((l) => ({
          kind: "PRODUCT" as const,
          productId: Number(l.productId),
          childPackageId: null,
          choiceLabel: null,
          qty: Number(l.qty),
          options: [],
        })),
      ],
    };
    const res = await fetch(
      editing ? `/api/packages/${editing.id}` : "/api/packages",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save package");
      return;
    }
    toast.success(editing ? "Package updated" : "Package created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(pkg: PackageRow) {
    if (!confirm(`Delete package "${pkg.name}" (${pkg.code})?`)) return;
    const res = await fetch(`/api/packages/${pkg.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete package");
      return;
    }
    toast.success("Package deleted");
    router.refresh();
  }

  const contentsLabel = (pkg: PackageRow) =>
    pkg.items
      .map((it) =>
        it.kind === "CHOICE"
          ? `${it.qty}× [${it.choiceLabel}: ${it.options
              .map((o) => o.name + (o.isDefault ? "*" : ""))
              .join(" / ")}]`
          : `${it.qty}× ${it.name}${it.kind === "PACKAGE" ? " (pkg)" : ""}`
      )
      .join(", ");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Packages</CardTitle>
          <CardDescription>
            Sellable bundles built from products, sub-packages and choice
            groups (BOM). “Can make” = how many more can be assembled from
            current stock, full explosion included.
          </CardDescription>
        </div>
        {canManage && <Button onClick={openCreate}>New package</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Contents</TableHead>
              <TableHead className="text-right">Price</TableHead>
              {showCosts && <TableHead className="text-right">Cost</TableHead>}
              {showCosts && <TableHead className="text-right">Margin</TableHead>}
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Can make</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((pkg) => (
              <TableRow key={pkg.id}>
                <TableCell className="font-mono text-xs">{pkg.code}</TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {pkg.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pkg.photoUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded border object-cover"
                      />
                    )}
                    {pkg.name}
                  </span>
                </TableCell>
                <TableCell className="max-w-xs text-sm text-muted-foreground">
                  {/* TableCell is whitespace-nowrap — clip long BOMs behind an
                      ellipsis (full contents on hover) so they never paint
                      over the numeric columns. */}
                  <div className="truncate" title={contentsLabel(pkg)}>
                    {contentsLabel(pkg)}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {money(pkg.sellingPrice)}
                </TableCell>
                {showCosts && (
                  <TableCell className="text-right">
                    {pkg.cost == null ? "—" : money(pkg.cost)}
                  </TableCell>
                )}
                {showCosts && (
                  <TableCell
                    className={`text-right ${
                      (pkg.margin ?? 0) < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {pkg.margin == null ? "—" : money(pkg.margin)}
                  </TableCell>
                )}
                <TableCell className="text-right text-muted-foreground">
                  {pkg.weightKg != null
                    ? `${pkg.weightKg} kg`
                    : pkg.autoWeightKg
                      ? `~${pkg.autoWeightKg} kg`
                      : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {pkg.availableToSell === null ? (
                    <Badge variant="outline">per-order</Badge>
                  ) : (
                    <span
                      className={
                        pkg.availableToSell === 0 ? "text-destructive" : ""
                      }
                    >
                      {pkg.availableToSell}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {pkg.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(pkg)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(pkg)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {packages.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showCosts ? 10 : 8}
                  className="text-center text-muted-foreground"
                >
                  No packages yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New package"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.code} — BOM changes affect future orders only.`
                : "Code is generated automatically on save."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Selling price (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Price floor (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={priceFloor}
                  onChange={(e) => setPriceFloor(e.target.value)}
                />
              </div>
            </div>
            <PhotoField value={photoUrl} onChange={setPhotoUrl} />

            <div className="grid gap-2">
              <Label>Contents (BOM)</Label>
              {lines.map((line, idx) => (
                <div key={idx} className="grid gap-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={line.kind}
                      onValueChange={(v) => {
                        const kind = v as LineKind;
                        setLine(idx, {
                          kind,
                          options:
                            kind === "CHOICE" && line.options.length === 0
                              ? [{ productId: "", isDefault: true }]
                              : line.options,
                        });
                      }}
                    >
                      <SelectTrigger className="w-32 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRODUCT">Product</SelectItem>
                        <SelectItem value="PACKAGE">Sub-package</SelectItem>
                        <SelectItem value="CHOICE">Choice group</SelectItem>
                      </SelectContent>
                    </Select>

                    {line.kind === "PRODUCT" && (
                      <div className="flex-1">
                        <Select
                          value={line.productId}
                          onValueChange={(v) => setLine(idx, { productId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a product" />
                          </SelectTrigger>
                          <SelectContent>
                            {sellableProducts.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name} ({p.sku})
                                {p.isStockTracked
                                  ? ` — stock ${p.stockQty}`
                                  : " — per-order"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {line.kind === "PACKAGE" && (
                      <div className="flex-1">
                        <Select
                          value={line.childPackageId}
                          onValueChange={(v) =>
                            setLine(idx, { childPackageId: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a package" />
                          </SelectTrigger>
                          <SelectContent>
                            {packages
                              .filter((p) => !editing || p.id !== editing.id)
                              .map((p) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.name} ({p.code})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {line.kind === "CHOICE" && (
                      <Input
                        className="flex-1"
                        placeholder='Label, e.g. "Teddy colour"'
                        value={line.choiceLabel}
                        onChange={(e) =>
                          setLine(idx, { choiceLabel: e.target.value })
                        }
                      />
                    )}

                    <Input
                      className="w-20"
                      type="number"
                      min="1"
                      value={line.qty}
                      onChange={(e) => setLine(idx, { qty: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, i) => i !== idx))
                      }
                      disabled={lines.length <= 1}
                    >
                      ✕
                    </Button>
                  </div>

                  {line.kind === "CHOICE" && (
                    <div className="grid gap-1 pl-2">
                      <span className="text-xs text-muted-foreground">
                        Options — pick one as default (used for catalog
                        estimates; the SE picks the real one at order entry)
                      </span>
                      {line.options.map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`default-${idx}`}
                            checked={opt.isDefault}
                            onChange={() =>
                              setLine(idx, {
                                options: line.options.map((o, i) => ({
                                  ...o,
                                  isDefault: i === oIdx,
                                })),
                              })
                            }
                          />
                          <div className="flex-1">
                            <Select
                              value={opt.productId}
                              onValueChange={(v) =>
                                setLine(idx, {
                                  options: line.options.map((o, i) =>
                                    i === oIdx ? { ...o, productId: v } : o
                                  ),
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Pick a variant product" />
                              </SelectTrigger>
                              <SelectContent>
                                {products
                                  .filter((p) => p.productType === "SELLABLE")
                                  .map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                      {p.name} ({p.sku})
                                      {p.isStockTracked
                                        ? ` — stock ${p.stockQty}`
                                        : ""}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setLine(idx, {
                                options: line.options.filter(
                                  (_, i) => i !== oIdx
                                ),
                              })
                            }
                            disabled={line.options.length <= 1}
                          >
                            ✕
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() =>
                          setLine(idx, {
                            options: [
                              ...line.options,
                              { productId: "", isDefault: false },
                            ],
                          })
                        }
                      >
                        + Add option
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                + Add line
              </Button>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div>
                <Label>Packing materials (package-level)</Label>
                <p className="text-xs text-muted-foreground">
                  Component-only items packed with THIS package — e.g. the big
                  shipping carton. Each product’s own packing materials are
                  added automatically (see the explosion below), so don’t
                  re-list them here.
                </p>
              </div>
              {materialLines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      value={line.productId}
                      onValueChange={(v) =>
                        setMaterialLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, productId: v } : l
                          )
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a packing material" />
                      </SelectTrigger>
                      <SelectContent>
                        {componentProducts.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} ({p.sku}) — stock {p.stockQty}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="w-20"
                    type="number"
                    min="1"
                    value={line.qty}
                    onChange={(e) =>
                      setMaterialLines((prev) =>
                        prev.map((l, i) =>
                          i === idx ? { ...l, qty: e.target.value } : l
                        )
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setMaterialLines((prev) =>
                        prev.filter((_, i) => i !== idx)
                      )
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setMaterialLines((prev) => [
                    ...prev,
                    { productId: "", qty: "1" },
                  ])
                }
                disabled={componentProducts.length === 0}
              >
                + Add packing material
              </Button>
              {componentProducts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Create a Component-only product first (e.g. “Big Shipping
                  Carton”).
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Weight (kg)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder={
                    editing?.autoWeightKg
                      ? `auto: ${editing.autoWeightKg} kg`
                      : "auto-sums from BOM"
                  }
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to auto-sum from the BOM (incl. components).
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Delivery charge by zone (৳)</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    min="0"
                    title="Inside Dhaka"
                    value={chargeInside}
                    onChange={(e) => setChargeInside(e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    title="Sub Dhaka"
                    value={chargeSub}
                    onChange={(e) => setChargeSub(e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    title="Outside Dhaka"
                    value={chargeOutside}
                    onChange={(e) => setChargeOutside(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Inside / Sub / Outside Dhaka — 0 = free delivery.
                </p>
              </div>
            </div>

            {showCosts && allComplete && (
              <div className="rounded-md border bg-muted/50 p-3 text-sm">
                Estimated cost {money(Math.round(previewCost * 100) / 100)} ·
                margin{" "}
                <span
                  className={
                    (Number(sellingPrice) || 0) - previewCost < 0
                      ? "text-destructive"
                      : ""
                  }
                >
                  {money(
                    Math.round(((Number(sellingPrice) || 0) - previewCost) * 100) /
                      100
                  )}
                </span>{" "}
                <span className="text-xs text-muted-foreground">
                  (final cost adds product packing materials on save)
                </span>
              </div>
            )}

            {editing && editing.explosion.length > 0 && (
              <div className="grid gap-1 rounded-md border p-3">
                <Label>Full explosion (per 1 package, default variants)</Label>
                <p className="text-xs text-muted-foreground">
                  What packing will actually deduct — auto-included packing
                  materials shown with ⊕.
                </p>
                <ul className="text-sm">
                  {editing.explosion.map((row) => (
                    <li key={row.productId} className="flex justify-between">
                      <span>
                        {row.qty}× {row.name}
                        {row.autoIncludedQty > 0 && (
                          <span
                            className="text-muted-foreground"
                            title={`${row.autoIncludedQty} auto-included from product packing materials`}
                          >
                            {" "}
                            ⊕
                          </span>
                        )}
                        {row.isComponentType && (
                          <Badge variant="outline" className="ml-2">
                            component
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {editing && editing.choiceGroups.length > 0 && (
              <div className="grid gap-1 rounded-md border p-3">
                <Label>Per-variant availability</Label>
                <ul className="text-sm">
                  {editing.choiceGroups.map((g) => (
                    <li key={g.groupId}>
                      <span className="font-medium">
                        {g.path.length > 0 ? `${g.path.join(" → ")} · ` : ""}
                        {g.label}:
                      </span>{" "}
                      {g.options
                        .map(
                          (o) =>
                            `${o.name}${o.isDefault ? "*" : ""} (can make ${
                              o.availability ?? "∞"
                            })`
                        )
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving || !name.trim() || !sellingPrice || !allComplete}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
