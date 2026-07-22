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
import { PhotoField } from "./photo-field";

export interface ProductComponentRow {
  componentId: number;
  name: string;
  sku: string;
  unit: string;
  qty: number;
  stockQty: number;
}

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  productType: "SELLABLE" | "COMPONENT";
  categoryId: number;
  categoryName: string;
  photoUrl: string | null;
  unit: string;
  sellingPrice: number;
  priceFloor: number;
  lowStockThreshold: number;
  isStockTracked: boolean;
  isActive: boolean;
  stockQty: number;
  weightKg: number | null;
  deliveryChargeInsideDhaka: number;
  deliveryChargeSubDhaka: number;
  deliveryChargeOutsideDhaka: number;
  components: ProductComponentRow[];
  avgCost?: number; // absent for roles without cost visibility
  effectiveCost?: number | null; // avg cost + packing materials
}

interface CategoryOption {
  id: number;
  name: string;
}

export interface ComponentOption {
  id: number;
  name: string;
  sku: string;
  stockQty: number;
}

interface ComponentLine {
  componentId: string; // "" = not picked yet
  qty: string;
}

const UNITS = ["pcs", "box", "set"] as const;

export const money = (n: number) => `৳${n.toLocaleString("en-IN")}`;

export function ProductsClient({
  products,
  categories,
  componentOptions,
  showCosts,
  canManage,
}: {
  products: ProductRow[];
  categories: CategoryOption[];
  componentOptions: ComponentOption[];
  showCosts: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "SELLABLE" | "COMPONENT">(
    "ALL"
  );
  // §2.3 — live name/SKU filter on the list.
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"SELLABLE" | "COMPONENT">(
    "SELLABLE"
  );
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState<string>("pcs");
  const [avgCost, setAvgCost] = useState("0");
  const [sellingPrice, setSellingPrice] = useState("");
  const [priceFloor, setPriceFloor] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("0");
  const [isStockTracked, setIsStockTracked] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [photoUrl, setPhotoUrl] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [chargeInside, setChargeInside] = useState("0");
  const [chargeSub, setChargeSub] = useState("0");
  const [chargeOutside, setChargeOutside] = useState("0");
  const [componentLines, setComponentLines] = useState<ComponentLine[]>([]);

  const isComponent = productType === "COMPONENT";

  function openCreate() {
    setEditing(null);
    setName("");
    setProductType("SELLABLE");
    setCategoryId(categories[0] ? String(categories[0].id) : "");
    setUnit("pcs");
    setAvgCost("0");
    setSellingPrice("");
    setPriceFloor("0");
    setLowStockThreshold("0");
    setIsStockTracked(true);
    setIsActive(true);
    setPhotoUrl("");
    setWeightKg("");
    setChargeInside("0");
    setChargeSub("0");
    setChargeOutside("0");
    setComponentLines([]);
    setDialogOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditing(p);
    setName(p.name);
    setProductType(p.productType);
    setCategoryId(String(p.categoryId));
    setUnit(p.unit);
    setAvgCost(String(p.avgCost ?? 0));
    setSellingPrice(String(p.sellingPrice));
    setPriceFloor(String(p.priceFloor));
    setLowStockThreshold(String(p.lowStockThreshold));
    setIsStockTracked(p.isStockTracked);
    setIsActive(p.isActive);
    setPhotoUrl(p.photoUrl ?? "");
    setWeightKg(p.weightKg == null ? "" : String(p.weightKg));
    setChargeInside(String(p.deliveryChargeInsideDhaka));
    setChargeSub(String(p.deliveryChargeSubDhaka));
    setChargeOutside(String(p.deliveryChargeOutsideDhaka));
    setComponentLines(
      p.components.map((c) => ({
        componentId: String(c.componentId),
        qty: String(c.qty),
      }))
    );
    setDialogOpen(true);
  }

  const validComponents = componentLines.filter(
    (l) => l.componentId !== "" && Number(l.qty) >= 1
  );

  async function save() {
    setSaving(true);
    const payload = {
      name,
      productType,
      categoryId: Number(categoryId),
      unit,
      avgCost: Number(avgCost) || 0,
      sellingPrice: isComponent ? 0 : Number(sellingPrice) || 0,
      priceFloor: isComponent ? 0 : Number(priceFloor) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 0,
      isStockTracked,
      isActive,
      photoUrl: photoUrl.trim() || null,
      weightKg: weightKg.trim() === "" ? null : Number(weightKg) || 0,
      deliveryChargeInsideDhaka: isComponent ? 0 : Number(chargeInside) || 0,
      deliveryChargeSubDhaka: isComponent ? 0 : Number(chargeSub) || 0,
      deliveryChargeOutsideDhaka: isComponent ? 0 : Number(chargeOutside) || 0,
      components: isComponent
        ? []
        : validComponents.map((l) => ({
            componentId: Number(l.componentId),
            qty: Number(l.qty),
          })),
    };
    const res = await fetch(
      editing ? `/api/products/${editing.id}` : "/api/products",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save product");
      return;
    }
    toast.success(editing ? "Product updated" : "Product created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(p: ProductRow) {
    if (!confirm(`Delete product "${p.name}" (${p.sku})?`)) return;
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete product");
      return;
    }
    toast.success("Product deleted");
    router.refresh();
  }

  const q = search.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      (typeFilter === "ALL" || p.productType === typeFilter) &&
      (q === "" ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q))
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            Sellable catalog items plus component-only packing materials
            (cartons, safety boxes) consumed by BOMs.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-48"
            placeholder="Search name / SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex rounded-md border p-0.5">
            {(
              [
                ["ALL", "All"],
                ["SELLABLE", "Sellable"],
                ["COMPONENT", "Components"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={typeFilter === value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {canManage && <Button onClick={openCreate}>New product</Button>}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              {showCosts && <TableHead className="text-right">Avg cost</TableHead>}
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {p.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.photoUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded border object-cover"
                      />
                    )}
                    <span>
                      {p.name}
                      {p.components.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          + {p.components
                            .map((c) => `${c.qty}× ${c.name}`)
                            .join(", ")}
                        </span>
                      )}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  {p.productType === "COMPONENT" ? (
                    <Badge variant="outline">Component</Badge>
                  ) : (
                    <Badge variant="secondary">Sellable</Badge>
                  )}
                </TableCell>
                <TableCell>{p.categoryName}</TableCell>
                {showCosts && (
                  <TableCell className="text-right">
                    {money(p.avgCost ?? 0)}
                    {p.effectiveCost != null &&
                      p.effectiveCost !== (p.avgCost ?? 0) && (
                        <span
                          className="block text-xs text-muted-foreground"
                          title="Including packing materials"
                        >
                          eff. {money(p.effectiveCost)}
                        </span>
                      )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {p.productType === "COMPONENT" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    money(p.sellingPrice)
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {p.weightKg == null ? "—" : `${p.weightKg} kg`}
                </TableCell>
                <TableCell className="text-right">
                  {p.isStockTracked ? (
                    <span className="inline-flex items-center gap-1">
                      {p.stockQty}
                      {p.stockQty <= p.lowStockThreshold && (
                        <Badge variant="destructive">low</Badge>
                      )}
                    </span>
                  ) : (
                    <Badge variant="outline">per-order</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {p.isActive ? (
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
                        onClick={() => openEdit(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(p)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showCosts ? 10 : 9}
                  className="text-center text-muted-foreground"
                >
                  {q || typeFilter !== "ALL"
                    ? "No products match the search/filter."
                    : "No products yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New product"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `SKU ${editing.sku}`
                : "SKU is generated automatically on save."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2 rounded-md border p-3">
              <Label>Product type</Label>
              <Select
                value={productType}
                onValueChange={(v) =>
                  setProductType(v as "SELLABLE" | "COMPONENT")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELLABLE">Sellable</SelectItem>
                  <SelectItem value="COMPONENT">
                    Component only (packing material)
                  </SelectItem>
                </SelectContent>
              </Select>
              {isComponent && (
                <p className="text-xs text-muted-foreground">
                  No selling price — stocked, purchased and used inside BOMs
                  only. Never appears in the order form.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Unit</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {showCosts && (
                <div className="grid gap-2">
                  <Label>Avg cost (৳)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={avgCost}
                    onChange={(e) => setAvgCost(e.target.value)}
                  />
                </div>
              )}
              {!isComponent && (
                <>
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
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Low-stock threshold</Label>
                <Input
                  type="number"
                  min="0"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  disabled={!isStockTracked}
                />
              </div>
              <div className="grid gap-2">
                <Label>Weight (kg, optional)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="e.g. 0.45"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                />
              </div>
            </div>

            {!isComponent && (
              <div className="grid gap-2 rounded-md border p-3">
                <Label>Delivery charge by zone (৳ — 0 = free delivery)</Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">
                      Inside Dhaka
                    </span>
                    <Input
                      type="number"
                      min="0"
                      value={chargeInside}
                      onChange={(e) => setChargeInside(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">
                      Sub Dhaka
                    </span>
                    <Input
                      type="number"
                      min="0"
                      value={chargeSub}
                      onChange={(e) => setChargeSub(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">
                      Outside Dhaka
                    </span>
                    <Input
                      type="number"
                      min="0"
                      value={chargeOutside}
                      onChange={(e) => setChargeOutside(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isComponent && (
              <div className="grid gap-2 rounded-md border p-3">
                <div>
                  <Label>Packing materials</Label>
                  <p className="text-xs text-muted-foreground">
                    Component-only products consumed per unit sold (standalone
                    or inside any package) — e.g. 1 Safety Box per Chocolate
                    Box.
                  </p>
                </div>
                {componentLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select
                        value={line.componentId}
                        onValueChange={(v) =>
                          setComponentLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, componentId: v } : l
                            )
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a packing material" />
                        </SelectTrigger>
                        <SelectContent>
                          {componentOptions
                            .filter((c) => !editing || c.id !== editing.id)
                            .map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name} ({c.sku}) — stock {c.stockQty}
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
                        setComponentLines((prev) =>
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
                        setComponentLines((prev) =>
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
                    setComponentLines((prev) => [
                      ...prev,
                      { componentId: "", qty: "1" },
                    ])
                  }
                  disabled={componentOptions.length === 0}
                >
                  + Add packing material
                </Button>
                {componentOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Create a Component-only product first (e.g. “Safety Box”).
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <PhotoField value={photoUrl} onChange={setPhotoUrl} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Stock tracked</Label>
                <p className="text-xs text-muted-foreground">
                  Off for perishables (cake, flowers) bought per order.
                </p>
              </div>
              <Switch
                checked={isStockTracked}
                onCheckedChange={setIsStockTracked}
              />
            </div>
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
              disabled={
                saving ||
                !name.trim() ||
                !categoryId ||
                (!isComponent && !sellingPrice) ||
                validComponents.length !== componentLines.length
              }
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
