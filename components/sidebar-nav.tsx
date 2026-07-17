"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarCheck,
  ChartColumn,
  ChevronDown,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Target,
  TrendingUp,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon is passed by name (not component) so the server layout can build the
// nav tree without shipping component references across the RSC boundary.
export type NavIconName =
  | "dashboard"
  | "leads"
  | "sales"
  | "catalog"
  | "inventory"
  | "courier"
  | "money"
  | "reports"
  | "pnl"
  | "targets"
  | "attendance"
  | "admin"
  | "settings";

const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: Megaphone,
  sales: ShoppingCart,
  catalog: Package,
  inventory: Boxes,
  courier: Truck,
  money: Wallet,
  reports: ChartColumn,
  pnl: TrendingUp,
  targets: Target,
  attendance: CalendarCheck,
  admin: ShieldCheck,
  settings: Settings,
};

export interface NavLeaf {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  icon: NavIconName;
  items: NavLeaf[];
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  // Longest-prefix match so only the most specific link highlights
  // (e.g. /orders/new lights "New Order", not "Orders").
  const activeHref = useMemo(() => {
    let best = "";
    for (const group of groups) {
      for (const item of group.items) {
        const matches =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        if (matches && item.href.length > best.length) best = item.href;
      }
    }
    return best;
  }, [groups, pathname]);

  const activeGroup = useMemo(
    () =>
      groups.find((g) => g.items.some((i) => i.href === activeHref))?.label,
    [groups, activeHref]
  );

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeGroup ? { [activeGroup]: true } : {}
  );

  // Navigating into a collapsed group's page should reveal where you are.
  useEffect(() => {
    if (!activeGroup) return;
    setOpen((prev) => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {groups.map((group) => {
        const Icon = NAV_ICONS[group.icon];

        // Single-page groups collapse to a plain top-level link.
        if (group.items.length === 1) {
          const item = group.items[0];
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        }

        const isOpen = !!open[group.label];
        const containsActive = group.label === activeGroup;
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() =>
                setOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))
              }
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                containsActive && !isOpen
                  ? "text-foreground"
                  : "text-muted-foreground",
                "hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </button>
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-200",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}
            >
              <div className="overflow-hidden">
                <div className="ml-[1.15rem] flex flex-col gap-0.5 border-l pl-2.5 py-0.5">
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-primary font-medium text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
