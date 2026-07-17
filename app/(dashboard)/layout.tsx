import Image from "next/image";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/sign-out-button";
import {
  SidebarNav,
  type NavGroup,
  type NavIconName,
  type NavLeaf,
} from "@/components/sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  // Fresh DB read: deactivation and password-change flags apply immediately,
  // not on next JWT refresh.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, team: true },
  });
  if (!user || !user.isActive) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  const permissions = await getEffectivePermissions(user.id);

  // Sidebar is built as main menus with submenus; a group is only shown when
  // the role has at least one item in it, and single-item groups render as a
  // plain top-level link inside SidebarNav.
  const navGroups: NavGroup[] = [];
  const addGroup = (label: string, icon: NavIconName, items: NavLeaf[]) => {
    if (items.length) navGroups.push({ label, icon, items });
  };

  addGroup("Dashboard", "dashboard", [{ href: "/", label: "Dashboard" }]);

  // Leads (SPEC §3). Any lead-viewing role gets the Leads workspace.
  const leadItems: NavLeaf[] = [];
  if (permissions.includes("leads.view_own")) {
    leadItems.push({ href: "/leads", label: "Leads" });
  }
  addGroup("Leads", "leads", leadItems);

  const salesItems: NavLeaf[] = [];
  if (permissions.includes("orders.view_own")) {
    salesItems.push({ href: "/orders", label: "Orders" });
  }
  if (permissions.includes("orders.create")) {
    salesItems.push({ href: "/orders/new", label: "New Order" });
  }
  if (permissions.includes("orders.approve_edit")) {
    salesItems.push({ href: "/orders/edit-requests", label: "Edit Requests" });
  }
  addGroup("Sales", "sales", salesItems);

  const catalogItems: NavLeaf[] = [];
  if (permissions.includes("catalog.view")) {
    catalogItems.push(
      { href: "/catalog/products", label: "Products" },
      { href: "/catalog/packages", label: "Packages" }
    );
  }
  if (permissions.includes("catalog.manage")) {
    catalogItems.push({ href: "/catalog/categories", label: "Categories" });
  }
  addGroup("Catalog", "catalog", catalogItems);

  // Inventory (SPEC §6.3). Packing sees only its queue; stock/purchases are
  // gated on their own permissions so each role gets exactly its tools.
  const inventoryItems: NavLeaf[] = [];
  if (permissions.includes("orders.pack")) {
    inventoryItems.push({ href: "/packing", label: "Packing Queue" });
  }
  if (permissions.includes("stock.view")) {
    inventoryItems.push({ href: "/stock", label: "Stock" });
  }
  if (permissions.includes("purchases.create")) {
    inventoryItems.push({ href: "/purchases", label: "Purchases" });
  }
  addGroup("Inventory", "inventory", inventoryItems);

  // Courier (SPEC §7, simplified per CORRECTIONS Courier §2): Steadfast only.
  // The Courier page IS the Steadfast integration + zone rate config; COD
  // reconciliation keeps its own screen. The old Courier Companies / Shipments /
  // Returns submenus are gone — shipment info lives in the order tabs' columns,
  // returns move to the Orders → Returned tab (C6).
  const courierItems: NavLeaf[] = [];
  if (permissions.includes("courier.manage")) {
    courierItems.push(
      { href: "/courier", label: "Steadfast" },
      { href: "/courier/cod", label: "COD Reconciliation" }
    );
  }
  addGroup("Courier", "courier", courierItems);

  // Money (SPEC §8 / §9.3). Wallet accounts are maintained by Admin/Accounts;
  // the verification queue is where Accounts signs payments off. Expenses
  // (SPEC §9.1): daily entry + category management for Accounts/Admin/Manager.
  const moneyItems: NavLeaf[] = [];
  if (permissions.includes("wallets.manage")) {
    moneyItems.push({ href: "/money/wallets", label: "Wallets" });
  }
  if (permissions.includes("payments.verify")) {
    moneyItems.push({ href: "/money/verification", label: "Payment Verification" });
  }
  if (permissions.includes("expenses.create")) {
    moneyItems.push(
      { href: "/money/expenses", label: "Expenses" },
      { href: "/money/expense-categories", label: "Expense Categories" }
    );
  }
  addGroup("Money", "money", moneyItems);

  const reportItems: NavLeaf[] = [];
  // R1/R11/R12 — order-based reports (SPEC §12), for any order-viewing role;
  // each page scopes rows via orderScopeWhere (SE own / TL team / all).
  if (permissions.includes("orders.view_own")) {
    reportItems.push(
      { href: "/reports/sales", label: "Sales Report" },
      { href: "/reports/cancelled", label: "Cancelled / Returned" },
      { href: "/reports/customers", label: "Customer Report" }
    );
  }
  // R3 — Team performance (SPEC §12), scope via reports.own/team/all.
  if (permissions.includes("reports.own")) {
    reportItems.push({ href: "/reports/team", label: "Team Performance" });
  }
  // R2 — Lead report (SPEC §3.2 / §12), for any lead-viewing role.
  if (permissions.includes("leads.view_own")) {
    reportItems.push({ href: "/leads/report", label: "Lead Report" });
  }
  // R4/R5 are inventory reports gated on stock.view — the same read scope as
  // the Stock screen (Admin, Manager, Accounts, Packing).
  if (permissions.includes("stock.view")) {
    reportItems.push(
      { href: "/reports/stock", label: "Stock Report" },
      { href: "/reports/packages", label: "Package Availability" }
    );
  }
  // R6 — Courier report (SPEC §7 / §12), for courier.manage roles.
  if (permissions.includes("courier.manage")) {
    reportItems.push({ href: "/reports/courier", label: "Courier Report" });
  }
  // R7 — Collection report (SPEC §8 / §12), for payments.verify roles.
  if (permissions.includes("payments.verify")) {
    reportItems.push({ href: "/reports/collection", label: "Collection Report" });
  }
  // R8 — Expense report (SPEC §9.1 / §12), for expenses.create roles.
  if (permissions.includes("expenses.create")) {
    reportItems.push({ href: "/reports/expenses", label: "Expense Report" });
  }
  // R10 — Attendance report (SPEC §11 / §12), for attendance.view_all roles.
  if (permissions.includes("attendance.view_all")) {
    reportItems.push({ href: "/attendance/report", label: "Attendance Report" });
  }
  addGroup("Reports", "reports", reportItems);

  // R9 — P&L / costing (SPEC §9.2 / §9.3). Cost-visible roles only (reports.pnl:
  // Admin + Accounts by seed, Manager if granted) — never Sales/TL/Packing.
  const pnlItems: NavLeaf[] = [];
  if (permissions.includes("reports.pnl")) {
    pnlItems.push(
      { href: "/reports/pnl/daily", label: "Daily Summary" },
      { href: "/reports/pnl/monthly", label: "Monthly P&L" },
      { href: "/reports/pnl/orders", label: "Per-order Profit" }
    );
  }
  addGroup("P&L", "pnl", pnlItems);

  // Targets & Rewards (SPEC §10). The leaderboard is for everyone (motivation);
  // gauges and management are scoped inside the page/API by permission.
  const targetItems: NavLeaf[] = [{ href: "/targets", label: "Targets & Rewards" }];
  if (permissions.includes("targets.manage")) {
    targetItems.push({ href: "/targets/manage", label: "Manage Targets" });
  }
  addGroup("Targets", "targets", targetItems);

  // Attendance (SPEC §11). Everyone with attendance.own gets the self check-in
  // page; managers (attendance.view_all) also get the leave-approval view.
  const attendanceItems: NavLeaf[] = [];
  if (permissions.includes("attendance.own")) {
    attendanceItems.push({ href: "/attendance", label: "My Attendance" });
  }
  if (permissions.includes("attendance.view_all")) {
    attendanceItems.push({ href: "/attendance/manage", label: "Attendance & Leave" });
  }
  addGroup("Attendance", "attendance", attendanceItems);

  const adminItems: NavLeaf[] = [];
  if (permissions.includes("users.manage")) {
    adminItems.push(
      { href: "/admin/users", label: "Users" },
      { href: "/admin/teams", label: "Teams" },
      { href: "/admin/roles", label: "Roles & Permissions" }
    );
  }
  if (permissions.includes("audit.view")) {
    adminItems.push({ href: "/admin/audit", label: "Audit Log" });
  }
  addGroup("Admin", "admin", adminItems);

  // Settings (SPEC §11 attendance office hours) — admin-only (settings.manage).
  // The Steadfast integration moved to the Courier page (CORRECTIONS Courier §2).
  const settingsItems: NavLeaf[] = [];
  if (permissions.includes("settings.manage")) {
    settingsItems.push(
      { href: "/settings/pnl", label: "P&L Settings" },
      { href: "/settings/attendance", label: "Attendance Settings" },
      { href: "/settings/whatsapp", label: "WhatsApp Invoice" },
      { href: "/settings/currencies", label: "Currency Rates" }
    );
  }
  addGroup("Settings", "settings", settingsItems);

  const roleLabel = ROLE_LABELS[user.role.name as RoleName] ?? user.role.name;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Image
            src="/gift-valy-logo.png"
            alt="Gift Valy"
            width={815}
            height={246}
            priority
            className="h-8 w-auto"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav groups={navGroups} />
        </div>
        <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
          Developed by{" "}
          <a
            href="https://softitcare.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            Soft IT Care
          </a>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2 md:hidden">
            <Image
              src="/gift-valy-logo.png"
              alt="Gift Valy"
              width={815}
              height={246}
              className="h-7 w-auto"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-xs text-muted-foreground leading-tight">
                {user.email}
              </div>
            </div>
            <Badge variant="secondary">{roleLabel}</Badge>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 bg-muted/30 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
