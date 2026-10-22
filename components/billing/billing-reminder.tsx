"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BillingReminder } from "@/lib/platform/billing-display";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// FUNNEL_LINER.md GV-9 — the 1st-to-7th reminder: a banner on every dashboard
// page for billing.view roles; amber, red on the due date.
export function BillingReminderBanner({ reminder }: { reminder: BillingReminder }) {
  const red = reminder.tone === "last-day";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2 text-sm print:hidden",
        red
          ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
      )}
    >
      <div className="min-w-0">
        <div className="font-medium">{reminder.en}</div>
        <div className="font-bangla text-xs">{reminder.bn}</div>
      </div>
      <Link href="/billing" className="shrink-0 font-semibold underline-offset-2 hover:underline">
        Pay now →
      </Link>
    </div>
  );
}

// Once per Dhaka day, for the Admin, on the first page they open. Recorded on
// the server as soon as it opens (POST /api/billing/reminder-seen).
export function BillingReminderPopup({ reminder }: { reminder: BillingReminder }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/billing/reminder-seen", { method: "POST" }).catch(() => {});
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Funnel Liner bill</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p className={cn("text-foreground", reminder.tone === "last-day" && "text-red-600 dark:text-red-400")}>
                {reminder.en}
              </p>
              <p className="font-bangla">{reminder.bn}</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Later
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              router.push("/billing");
            }}
          >
            Pay now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
