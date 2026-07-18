"use client";

// CORRECTIONS Orders §R8 — the small refresh icon on the dashboard's Total
// Collection widget: triggers the Steadfast payments sync and reloads the
// server-rendered figures, so right after a payout the owner pulls the latest
// Courier COD numbers without leaving the dashboard. Rendered only for
// courier.manage viewers with the integration enabled.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollectionSyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    const res = await fetch("/api/couriers/steadfast/payments/sync", {
      method: "POST",
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSyncing(false);
    if (!res?.ok) {
      toast.error(data?.error ?? "Payments sync failed");
      return;
    }
    toast.success(
      `Payments synced — ${data.payments} checked, ${data.ordersSettled} order${
        data.ordersSettled === 1 ? "" : "s"
      } reconciled`
    );
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void sync()}
      disabled={syncing}
      aria-label="Sync Steadfast payments"
      title="Sync Steadfast payments"
      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
    </button>
  );
}
