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

interface PackageItemRow {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  unit: string;
  qty: number;
  isStockTracked: boolean;
  stockQty: number;
  unitCost?: number;
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
  items: PackageItemRow[];
  cost?: number; // absent for roles without cost visibility
  margin?: number;
}

interface ProductOption {
  id: number;
  name: string;
  sku: string;
  unit: string;
  stockQty: number;
  isStockTracked: boolean;
  avgCost?: number;
}

interface BomLine {
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
  const [lines, setLines] = useState<BomLine[]>([]);

  const productById = new Map(products.map((p) => [p.id, p]));

  function openCreate() {
    setEditing(null);
    setName("");
    setSellingPrice("");
    setPriceFloor("0");
    setIsActive(true);
    setPhotoUrl("");
    setLines([{ productId: "", qty: "1" }]);
    setDialogOpen(true);
  }

  function openEdit(pkg: PackageRow) {
    setEditing(pkg);
    setName(pkg.name);
    setSellingPrice(String(pkg.sellingPrice));
    setPriceFloor(String(pkg.priceFloor));
    setIsActive(pkg.isActive);
    setPhotoUrl(pkg.photoUrl ?? "");
    setLines(
      pkg.items.map((it) => ({
        productId: String(it.productId),
        qty: String(it.qty),
      }))
    );
    setDialogOpen(true);
  }

  function setLine(idx: number, patch: Partial<BomLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    );
  }

  const validLines = lines.filter(
    (l) => l.productId !== "" && Number(l.qty) >= 1
  );
  const previewCost = validLines.reduce((sum, l) => {
    const p = productById.get(Number(l.productId));
    return sum + (p?.avgCost ?? 0) * Number(l.qty);
  }, 0);

  async function save() {
    setSaving(true);
    const payload = {
      name,
      sellingPrice: Number(sellingPrice) || 0,
      priceFloor: Number(priceFloor) || 0,
      isActive,
      photoUrl: photoUrl.trim() || null,
      items: validLines.map((l) => ({
        productId: Number(l.productId),
        qty: Number(l.qty),
      })),
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Packages</CardTitle>
          <CardDescription>
            Sellable bundles built from products (BOM). “Can make” = how many
            more can be assembled from current stock.
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
              <TableHead className="text-right">Can make</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((pkg) => (
              <TableRow key={pkg.id}>
                <TableCell className="font-mono text-xs">{pkg.code}</TableCell>
                <TableCell className="font-medium">{pkg.name}</TableCell>
                <TableCell className="max-w-xs text-sm text-muted-foreground">
                  {pkg.items
                    .map((it) => `${it.qty}× ${it.productName}`)
                    .join(", ")}
                </TableCell>
                <TableCell className="text-right">
                  {money(pkg.sellingPrice)}
                </TableCell>
                {showCosts && (
                  <TableCell className="text-right">
                    {money(pkg.cost ?? 0)}
                  </TableCell>
                )}
                {showCosts && (
                  <TableCell
                    className={`text-right ${
                      (pkg.margin ?? 0) < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {money(pkg.margin ?? 0)}
                  </TableCell>
                )}
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
                  colSpan={showCosts ? 9 : 7}
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
        <DialogContent className="sm:max-w-xl">
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
            <div className="grid grid-cols-3 gap-3">
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
              <div className="grid gap-2">
                <Label>Photo URL (optional)</Label>
                <Input
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Contents (BOM)</Label>
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      value={line.productId}
                      onValueChange={(v) => setLine(idx, { productId: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} ({p.sku})
                            {p.isStockTracked ? ` — stock ${p.stockQty}` : " — per-order"}
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
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setLines((prev) => [...prev, { productId: "", qty: "1" }])
                }
              >
                + Add item
              </Button>
            </div>

            {showCosts && validLines.length > 0 && (
              <div className="rounded-md border bg-muted/50 p-3 text-sm">
                Package cost {money(previewCost)} · margin{" "}
                <span
                  className={
                    (Number(sellingPrice) || 0) - previewCost < 0
                      ? "text-destructive"
                      : ""
                  }
                >
                  {money((Number(sellingPrice) || 0) - previewCost)}
                </span>
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
              disabled={
                saving ||
                !name.trim() ||
                !sellingPrice ||
                validLines.length === 0 ||
                validLines.length !== lines.length
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
