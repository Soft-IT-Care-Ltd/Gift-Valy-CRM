"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WebsiteValues } from "@/lib/catalog-website-shape";

// ROUND3 W-2 — the product and package lists' Website column, its filter and
// the bulk "Show on website / Hide".

export type WebsiteFilter = "ALL" | "SHOWN" | "HIDDEN" | "NO_PHOTO";

export function matchesWebsiteFilter(w: WebsiteValues, f: WebsiteFilter): boolean {
  if (f === "SHOWN") return w.showOnWebsite;
  if (f === "HIDDEN") return !w.showOnWebsite;
  if (f === "NO_PHOTO") return w.showOnWebsite && w.photos.length === 0;
  return true;
}

export function WebsiteFilterTabs({ value, onChange }: { value: WebsiteFilter; onChange: (f: WebsiteFilter) => void }) {
  const tabs: [WebsiteFilter, string][] = [
    ["ALL", "Website: all"],
    ["SHOWN", "Shown"],
    ["HIDDEN", "Hidden"],
    ["NO_PHOTO", "No website photo"],
  ];
  return (
    <div className="flex rounded-md border p-0.5">
      {tabs.map(([f, label]) => (
        <Button key={f} variant={value === f ? "secondary" : "ghost"} size="sm" onClick={() => onChange(f)}>
          {label}
        </Button>
      ))}
    </div>
  );
}

export function WebsiteCell({ website, eligible }: { website: WebsiteValues; eligible: boolean }) {
  if (!website.showOnWebsite) return <Badge variant="outline">Hidden</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={eligible ? "secondary" : "outline"} title={website.slug ? `/p/${website.slug}` : undefined}>
        {eligible ? "Shown" : "On (inactive)"}
      </Badge>
      {website.photos.length === 0 && (
        <Badge variant="outline" className="border-amber-400 text-amber-700">
          no photo
        </Badge>
      )}
    </span>
  );
}

export function WebsiteBulkBar({ kind, ids, onDone }: { kind: "product" | "package"; ids: number[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (ids.length === 0) return null;

  async function run(show: boolean) {
    setBusy(true);
    const res = await fetch("/api/catalog/website/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ids, show }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to update the website");
      return;
    }
    toast.success(`${data.changed} ${kind === "product" ? "product" : "package"}${data.changed === 1 ? "" : "s"} ${show ? "shown on" : "hidden from"} the website`);
    onDone();
  }

  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span>{ids.length} selected</span>
      <Button size="sm" disabled={busy} onClick={() => run(true)}>
        Show on website
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(false)}>
        Hide
      </Button>
    </div>
  );
}
