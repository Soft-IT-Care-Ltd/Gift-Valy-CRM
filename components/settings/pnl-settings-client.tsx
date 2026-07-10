"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AD_ALLOCATION_METHODS,
  AD_ALLOCATION_LABELS,
  AD_ALLOCATION_HELP,
  type AdAllocationMethod,
  type PnlSettings,
} from "@/lib/pnl-constants";

// SPEC §9.2 — the two per-order profit settings: the standard packaging cost
// charged to every order, and how the day's ad spend is allocated across orders.
export function PnlSettingsClient({ initial }: { initial: PnlSettings }) {
  const router = useRouter();
  const [s, setS] = useState<PnlSettings>(initial);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<PnlSettings>) =>
    setS((prev) => ({ ...prev, ...patch }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/pnl", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setS(body as PnlSettings);
      toast.success("P&L settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">P&amp;L settings</h1>
        <p className="text-sm text-muted-foreground">
          Inputs to the per-order profit formula (SPEC §9.2). Changes apply to the
          per-order profit list immediately — costs already frozen on orders
          (product cost, actual courier cost) are unaffected.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packaging cost</CardTitle>
          <CardDescription>
            A standard per-order packaging rate subtracted from every order&apos;s
            profit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-xs gap-1">
            <Label className="text-xs">Packaging cost per order (৳)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={s.packagingCostPerOrder}
              onChange={(e) =>
                set({ packagingCostPerOrder: Number(e.target.value) })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ad-cost allocation</CardTitle>
          <CardDescription>
            How each order is charged its share of ad spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-md gap-1">
            <Label className="text-xs">Method</Label>
            <Select
              value={s.adAllocationMethod}
              onValueChange={(v) =>
                set({ adAllocationMethod: v as AdAllocationMethod })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AD_ALLOCATION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {AD_ALLOCATION_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {AD_ALLOCATION_HELP[s.adAllocationMethod]}
            </p>
          </div>

          {s.adAllocationMethod === "manual_percent" && (
            <div className="grid max-w-xs gap-1">
              <Label className="text-xs">Ad cost as % of sell value</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={s.adManualPercent}
                onChange={(e) =>
                  set({ adManualPercent: Number(e.target.value) })
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
