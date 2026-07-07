"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { BD_DISTRICTS } from "@/lib/order-constants";

export interface CourierRow {
  id: number;
  name: string;
  contact: string | null;
  codFeePercent: number;
  notes: string | null;
  isActive: boolean;
  shipmentCount: number;
  zoneCharges: { district: string; charge: number }[];
}

interface ZoneDraft {
  district: string;
  charge: string;
}

export function CourierCompaniesClient({ couriers }: { couriers: CourierRow[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CourierRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [codFeePercent, setCodFeePercent] = useState("0");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [zones, setZones] = useState<ZoneDraft[]>([]);

  function openCreate() {
    setEditing(null);
    setName("");
    setContact("");
    setCodFeePercent("0");
    setNotes("");
    setIsActive(true);
    setZones([]);
    setDialogOpen(true);
  }

  function openEdit(c: CourierRow) {
    setEditing(c);
    setName(c.name);
    setContact(c.contact ?? "");
    setCodFeePercent(String(c.codFeePercent));
    setNotes(c.notes ?? "");
    setIsActive(c.isActive);
    setZones(c.zoneCharges.map((z) => ({ district: z.district, charge: String(z.charge) })));
    setDialogOpen(true);
  }

  function addZone() {
    const used = new Set(zones.map((z) => z.district));
    const next = BD_DISTRICTS.find((d) => !used.has(d));
    if (!next) return;
    setZones((z) => [...z, { district: next, charge: "" }]);
  }

  function updateZone(i: number, patch: Partial<ZoneDraft>) {
    setZones((z) => z.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function removeZone(i: number) {
    setZones((z) => z.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Guard duplicate districts client-side (the API rejects them too).
    const districts = zones.map((z) => z.district);
    if (new Set(districts).size !== districts.length) {
      toast.error("Each district can appear only once");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      contact: contact.trim() || null,
      codFeePercent: Number(codFeePercent) || 0,
      notes: notes.trim() || null,
      isActive,
      zoneCharges: zones.map((z) => ({
        district: z.district,
        charge: Number(z.charge) || 0,
      })),
    };
    const res = await fetch(
      editing ? `/api/couriers/${editing.id}` : "/api/couriers",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save courier");
      return;
    }
    toast.success(editing ? "Courier updated" : "Courier created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(c: CourierRow) {
    if (!confirm(`Delete courier "${c.name}"?`)) return;
    const res = await fetch(`/api/couriers/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete courier");
      return;
    }
    toast.success("Courier deleted");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Courier companies</CardTitle>
          <CardDescription>
            COD fee % (deducted on remittance) and per-district delivery charges.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>New courier</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">COD fee %</TableHead>
              <TableHead className="text-right">Zones</TableHead>
              <TableHead className="text-right">Shipments</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {couriers.map((c) => (
              <TableRow key={c.id} className={!c.isActive ? "opacity-50" : undefined}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.contact ?? "—"}
                </TableCell>
                <TableCell className="text-right">{c.codFeePercent}%</TableCell>
                <TableCell className="text-right">{c.zoneCharges.length}</TableCell>
                <TableCell className="text-right">{c.shipmentCount}</TableCell>
                <TableCell>
                  {c.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => remove(c)}>
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {couriers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No couriers yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New courier"}</DialogTitle>
            <DialogDescription>
              Zone charges are optional — add a row per district you serve.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Contact (optional)</Label>
                <Input value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>COD fee (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={codFeePercent}
                  onChange={(e) => setCodFeePercent(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>Per-district zone charges</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addZone}
                  disabled={zones.length >= BD_DISTRICTS.length}
                >
                  Add district
                </Button>
              </div>
              {zones.length === 0 ? (
                <p className="text-xs text-muted-foreground">No zone charges set.</p>
              ) : (
                <div className="grid gap-2">
                  {zones.map((z, i) => {
                    const used = new Set(
                      zones.filter((_, idx) => idx !== i).map((r) => r.district)
                    );
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <Select
                          value={z.district}
                          onValueChange={(v) => updateZone(i, { district: v })}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BD_DISTRICTS.filter(
                              (d) => d === z.district || !used.has(d)
                            ).map((d) => (
                              <SelectItem key={d} value={d}>
                                {d}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="0"
                          placeholder="৳ charge"
                          className="w-28"
                          value={z.charge}
                          onChange={(e) => updateZone(i, { charge: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeZone(i)}
                        >
                          ✕
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
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
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
