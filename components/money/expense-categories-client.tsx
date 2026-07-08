"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  type CategoryRow,
  type CostTypeValue,
} from "@/lib/expense-constants";

export function ExpenseCategoriesClient({
  categories,
}: {
  categories: CategoryRow[];
}) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [costType, setCostType] = useState<CostTypeValue>("VARIABLE");

  function openCreate() {
    setEditing(null);
    setName("");
    setCostType("VARIABLE");
    setDialogOpen(true);
  }

  function openEdit(c: CategoryRow) {
    setEditing(c);
    setName(c.name);
    setCostType(c.costType);
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(
      editing ? `/api/expense-categories/${editing.id}` : "/api/expense-categories",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, costType }),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save category");
      return;
    }
    toast.success(editing ? "Category updated" : "Category created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(c: CategoryRow) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const res = await fetch(`/api/expense-categories/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete category");
      return;
    }
    toast.success("Category deleted");
    router.refresh();
  }

  const fixedCount = categories.filter((c) => c.costType === "FIXED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Expense categories</h1>
          <p className="text-sm text-muted-foreground">
            Each category is flagged Fixed or Variable — this drives the fixed vs
            variable split in the P&L and the R8 expense report.
          </p>
        </div>
        <Button onClick={openCreate}>New category</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Categories ({categories.length})</CardTitle>
          <CardDescription>
            {fixedCount} fixed, {categories.length - fixedCount} variable. A
            category with expenses on record can be renamed but not deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Expenses filed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={c.costType === "FIXED" ? "secondary" : "outline"}
                      >
                        {COST_TYPE_LABELS[c.costType]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.expenseCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => remove(c)}
                          disabled={c.expenseCount > 0}
                          title={
                            c.expenseCount > 0
                              ? "Has expenses on record — keep it so reports stay intact"
                              : undefined
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No categories yet. Add your first (e.g. Ad Cost, Salary,
                      Rent).
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New category"}
            </DialogTitle>
            <DialogDescription>
              Pick Fixed for recurring overhead (salary, rent, utilities) and
              Variable for spend that scales with sales (ad, packaging, courier).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Cost type</Label>
              <Select
                value={costType}
                onValueChange={(v) => setCostType(v as CostTypeValue)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {COST_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
