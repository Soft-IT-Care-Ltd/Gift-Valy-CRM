"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, money } from "@/lib/format";

// ROUND3 W-6 — website orders nobody could be given (no active Sales
// Executive when they came in). Shown to orders.assign holders on the Orders
// page until the website-orders job, an SE's check-in or a hand gives them out.

export type UnassignedWebsiteRow = { id: number; ref: string; placedAt: string; total: number; customer: string | null };

export function WebsiteUnassignedList({ rows, sellers }: { rows: UnassignedWebsiteRow[]; sellers: { id: number; name: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  async function assign(id: number) {
    const userId = Number(pick[id]);
    if (!userId) return;
    setSaving(id);
    const res = await fetch(`/api/orders/${id}/website/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setSaving(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't assign the order");
      return;
    }
    toast.success("Assigned — the Sales Executive got a notification");
    router.refresh();
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-medium">
        {rows.length} unassigned website {rows.length === 1 ? "order" : "orders"} — nobody was there to take{" "}
        {rows.length === 1 ? "it" : "them"}. Give {rows.length === 1 ? "it" : "each"} to a Sales Executive.
      </p>
      <ul className="mt-2 grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/orders/${r.id}`} className="font-mono font-semibold hover:underline">
              {r.ref}
            </Link>
            <span className="text-xs opacity-80">
              {formatDateTime(r.placedAt)} · {money(r.total)}
              {r.customer ? ` · ${r.customer}` : ""}
            </span>
            {sellers.length > 0 && (
              <span className="ml-auto flex items-center gap-2">
                <Select value={pick[r.id] ?? ""} onValueChange={(v) => setPick((p) => ({ ...p, [r.id]: v }))}>
                  <SelectTrigger className="h-8 w-44 bg-background">
                    <SelectValue placeholder="Sales Executive" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!pick[r.id] || saving === r.id} onClick={() => assign(r.id)}>
                  {saving === r.id ? "Assigning…" : "Assign"}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
