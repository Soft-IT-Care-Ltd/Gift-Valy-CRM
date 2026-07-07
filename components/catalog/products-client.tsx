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

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
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
  avgCost?: number; // absent for roles without cost visibility
}

interface CategoryOption {
  id: number;
  name: string;
}

const UNITS = ["pcs", "box", "set"] as const;

export const money = (n: number) => `৳${n.toLocaleString("en-IN")}`;

export function ProductsClient({
  products,
  categories,
  showCosts,
  canManage,
}: {
  products: ProductRow[];
  categories: CategoryOption[];
  showCosts: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState<string>("pcs");
  const [avgCost, setAvgCost] = useState("0");
  const [sellingPrice, setSellingPrice] = useState("");
  const [priceFloor, setPriceFloor] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("0");
  const [isStockTracked, setIsStockTracked] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [photoUrl, setPhotoUrl] = useState("");

  function openCreate() {
    setEditing(null);
    setName("");
    setCategoryId(categories[0] ? String(categories[0].id) : "");
    setUnit("pcs");
    setAvgCost("0");
    setSellingPrice("");
    setPriceFloor("0");
    setLowStockThreshold("0");
    setIsStockTracked(true);
    setIsActive(true);
    setPhotoUrl("");
    setDialogOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditing(p);
    setName(p.name);
    setCategoryId(String(p.categoryId));
    setUnit(p.unit);
    setAvgCost(String(p.avgCost ?? 0));
    setSellingPrice(String(p.sellingPrice));
    setPriceFloor(String(p.priceFloor));
    setLowStockThreshold(String(p.lowStockThreshold));
    setIsStockTracked(p.isStockTracked);
    setIsActive(p.isActive);
    setPhotoUrl(p.photoUrl ?? "");
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const payload = {
      name,
      categoryId: Number(categoryId),
      unit,
      avgCost: Number(avgCost) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      priceFloor: Number(priceFloor) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 0,
      isStockTracked,
      isActive,
      photoUrl: photoUrl.trim() || null,
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            Standalone catalog items; packages are built from these.
          </CardDescription>
        </div>
        {canManage && <Button onClick={openCreate}>New product</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              {showCosts && <TableHead className="text-right">Avg cost</TableHead>}
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Floor</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
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
                    {p.name}
                  </span>
                </TableCell>
                <TableCell>{p.categoryName}</TableCell>
                <TableCell>{p.unit}</TableCell>
                {showCosts && (
                  <TableCell className="text-right">
                    {money(p.avgCost ?? 0)}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {money(p.sellingPrice)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {money(p.priceFloor)}
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
            {products.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showCosts ? 10 : 9}
                  className="text-center text-muted-foreground"
                >
                  No products yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
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
              disabled={saving || !name.trim() || !categoryId || !sellingPrice}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
