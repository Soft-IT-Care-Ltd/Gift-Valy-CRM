"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationView } from "@/lib/notifications";

// ROUND3 W-6 — the bell in the ERP header: the unread count (checked again
// every minute while the tab is visible), the latest notifications on a
// click — opening the list marks them read. A website order assigned to an
// SE, or a word to the Team Leader that nobody was checked in, lands here.

const POLL_MS = 60_000;

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationView[] | null>(null);

  const refreshCount = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const res = await fetch("/api/notifications?count=1", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setUnread(((await res.json()) as { unread: number }).unread);
  }, []);

  useEffect(() => {
    const t = setInterval(refreshCount, POLL_MS);
    document.addEventListener("visibilitychange", refreshCount);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", refreshCount);
    };
  }, [refreshCount]);

  async function open() {
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { unread: number; items: NotificationView[] };
    setItems(data.items);
    const fresh = data.items.filter((i) => !i.read).map((i) => i.id);
    if (fresh.length > 0) {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: fresh }),
      }).catch(() => null);
      setUnread(Math.max(0, data.unread - fresh.length));
    }
  }

  return (
    <DropdownMenu onOpenChange={(isOpen) => void (isOpen && open())}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items === null ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex flex-col items-start gap-0.5 whitespace-normal"
                onSelect={() => {
                  if (n.href) router.push(n.href);
                }}
              >
                <span className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</span>
                {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[11px] text-muted-foreground">{formatDateTime(n.at)}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
