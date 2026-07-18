"use client";

// CORRECTIONS §R11 — phone/tablet navigation. The sidebar is hidden below md,
// and until now there was NO way to navigate on a phone. A hamburger in the
// header opens a slide-over drawer carrying the exact same SidebarNav tree;
// it closes on route change (link tapped) and on backdrop/Escape.
import { useEffect, useState } from "react";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-background shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <Image
                src="/gift-valy-logo.png"
                alt="Gift Valy"
                width={815}
                height={246}
                className="h-7 w-auto"
              />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            {/* A tapped nav link closes the drawer (event handler, so the
                navigation itself still proceeds normally). */}
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              <SidebarNav groups={groups} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
