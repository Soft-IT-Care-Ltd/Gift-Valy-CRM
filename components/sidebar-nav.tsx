"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  section?: string;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-2">
      {items.map((item, i) => {
        // Items arrive grouped by section, so a header renders whenever the
        // section differs from the previous item's.
        const sectionHeader =
          item.section && item.section !== items[i - 1]?.section ? (
            <div
              key={`section-${item.section}`}
              className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {item.section}
            </div>
          ) : null;
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <div key={item.href} className="contents">
            {sectionHeader}
            <Link
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
