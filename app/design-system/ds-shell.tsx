"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Icon } from "./lib/icons";

type NavItem = { id: string; label: string; icon: string; href: string; badge?: string };
type NavGroup = { group: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: "Design System",
    items: [
      { id: "overview", label: "Overview", icon: "home", href: "/design-system" },
      { id: "foundations", label: "Foundations", icon: "palette", href: "/design-system/foundations" },
      { id: "components", label: "Components", icon: "grid", href: "/design-system/components" },
      { id: "patterns", label: "Patterns", icon: "layers", href: "/design-system/patterns" },
    ],
  },
  {
    group: "In Context",
    items: [
      { id: "bangla", label: "Bangla Type", icon: "bangla", href: "/design-system/bangla-type" },
      { id: "dashboard", label: "Merchant Dashboard", icon: "chart", href: "/design-system/merchant-dashboard", badge: "Live" },
    ],
  },
];

export function DsShell({
  page,
  crumbs,
  children,
}: {
  page: string;
  crumbs: string[];
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? theme : undefined;

  return (
    <div className="ds">
      <div className="app">
        <aside className="sidebar">
          <div className="sb-brand">
            <div className="sb-logo">SC</div>
            <div className="sb-wordmark">
              Soft IT Care
              <small>Design System · v1.0</small>
            </div>
          </div>
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((it) => (
                <Link
                  key={it.id}
                  href={it.href}
                  className={`nav-item ${page === it.id ? "active" : ""}`}
                >
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                  {it.badge && <span className="nav-badge">{it.badge}</span>}
                </Link>
              ))}
            </div>
          ))}
          <div className="sb-foot">
            <div className="sb-user">
              <div className="sb-avatar">SC</div>
              <div style={{ minWidth: 0 }}>
                <div className="sb-name">Soft IT Care</div>
                <div className="sb-role">Design Team</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <Icon name="chevronRight" size={12} />}
                  <span
                    style={{
                      color: i === crumbs.length - 1 ? "var(--ink)" : undefined,
                      fontWeight: i === crumbs.length - 1 ? 600 : 400,
                    }}
                  >
                    {c}
                  </span>
                </Fragment>
              ))}
            </div>
            <div className="topbar-actions">
              <div className="theme-toggle">
                <button
                  className={active === "light" ? "active" : ""}
                  onClick={() => setTheme("light")}
                  title="Light"
                  aria-label="Light theme"
                >
                  <Icon name="sun" />
                </button>
                <button
                  className={active === "system" ? "active" : ""}
                  onClick={() => setTheme("system")}
                  title="Auto"
                  aria-label="Auto theme"
                >
                  <Icon name="monitor" />
                </button>
                <button
                  className={active === "dark" ? "active" : ""}
                  onClick={() => setTheme("dark")}
                  title="Dark"
                  aria-label="Dark theme"
                >
                  <Icon name="moon" />
                </button>
              </div>
              <button className="icon-btn" title="Notifications" aria-label="Notifications">
                <Icon name="bell" />
                <span className="dot" />
              </button>
            </div>
          </div>
          <div className="content">{children}</div>
        </main>
      </div>
    </div>
  );
}
