import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/sign-out-button";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";

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

  const navItems: NavItem[] = [{ href: "/", label: "Dashboard" }];
  // Leads (SPEC §3). Any lead-viewing role gets the Leads workspace.
  if (permissions.includes("leads.view_own")) {
    navItems.push({ href: "/leads", label: "Leads", section: "Leads" });
  }
  if (permissions.includes("orders.view_own")) {
    navItems.push({ href: "/orders", label: "Orders", section: "Sales" });
  }
  if (permissions.includes("orders.create")) {
    navItems.push({ href: "/orders/new", label: "New Order", section: "Sales" });
  }
  if (permissions.includes("orders.approve_edit")) {
    navItems.push({
      href: "/orders/edit-requests",
      label: "Edit Requests",
      section: "Sales",
    });
  }
  if (permissions.includes("catalog.view")) {
    navItems.push(
      { href: "/catalog/products", label: "Products", section: "Catalog" },
      { href: "/catalog/packages", label: "Packages", section: "Catalog" }
    );
  }
  if (permissions.includes("catalog.manage")) {
    navItems.push({
      href: "/catalog/categories",
      label: "Categories",
      section: "Catalog",
    });
  }
  // Inventory (SPEC §6.3). Packing sees only its queue; stock/purchases are
  // gated on their own permissions so each role gets exactly its tools.
  if (permissions.includes("orders.pack")) {
    navItems.push({ href: "/packing", label: "Packing Queue", section: "Inventory" });
  }
  if (permissions.includes("stock.view")) {
    navItems.push({ href: "/stock", label: "Stock", section: "Inventory" });
  }
  if (permissions.includes("purchases.create")) {
    navItems.push({ href: "/purchases", label: "Purchases", section: "Inventory" });
  }
  // Courier & delivery (SPEC §7). courier.manage covers companies, handover,
  // shipment status and COD reconciliation; return approval is a step above.
  if (permissions.includes("courier.manage")) {
    navItems.push(
      { href: "/courier/companies", label: "Courier Companies", section: "Courier" },
      { href: "/courier/shipments", label: "Shipments", section: "Courier" },
      { href: "/courier/cod", label: "COD Reconciliation", section: "Courier" }
    );
  }
  if (permissions.includes("courier.approve_return")) {
    navItems.push({ href: "/courier/returns", label: "Returns", section: "Courier" });
  }
  // Money (SPEC §8 / §9.3). Wallet accounts are maintained by Admin/Accounts;
  // the verification queue is where Accounts signs payments off.
  if (permissions.includes("wallets.manage")) {
    navItems.push({ href: "/money/wallets", label: "Wallets", section: "Money" });
  }
  if (permissions.includes("payments.verify")) {
    navItems.push({
      href: "/money/verification",
      label: "Payment Verification",
      section: "Money",
    });
  }
  // Expenses (SPEC §9.1). Daily entry + category management for Accounts/Admin/Manager.
  if (permissions.includes("expenses.create")) {
    navItems.push(
      { href: "/money/expenses", label: "Expenses", section: "Money" },
      {
        href: "/money/expense-categories",
        label: "Expense Categories",
        section: "Money",
      }
    );
  }
  // R2 — Lead report (SPEC §3.2 / §12), for any lead-viewing role.
  if (permissions.includes("leads.view_own")) {
    navItems.push({ href: "/leads/report", label: "Lead Report", section: "Reports" });
  }
  // Reports (SPEC §12). R4/R5 are inventory reports gated on stock.view — the
  // same read scope as the Stock screen (Admin, Manager, Accounts, Packing).
  if (permissions.includes("stock.view")) {
    navItems.push(
      { href: "/reports/stock", label: "Stock Report", section: "Reports" },
      {
        href: "/reports/packages",
        label: "Package Availability",
        section: "Reports",
      }
    );
  }
  // R6 — Courier report (SPEC §7 / §12), for courier.manage roles.
  if (permissions.includes("courier.manage")) {
    navItems.push({ href: "/reports/courier", label: "Courier Report", section: "Reports" });
  }
  // R7 — Collection report (SPEC §8 / §12), for payments.verify roles.
  if (permissions.includes("payments.verify")) {
    navItems.push({
      href: "/reports/collection",
      label: "Collection Report",
      section: "Reports",
    });
  }
  // R8 — Expense report (SPEC §9.1 / §12), for expenses.create roles.
  if (permissions.includes("expenses.create")) {
    navItems.push({
      href: "/reports/expenses",
      label: "Expense Report",
      section: "Reports",
    });
  }
  // R10 — Attendance report (SPEC §11 / §12), for attendance.view_all roles.
  if (permissions.includes("attendance.view_all")) {
    navItems.push({
      href: "/attendance/report",
      label: "Attendance Report",
      section: "Reports",
    });
  }
  // Targets & Rewards (SPEC §10). The leaderboard is for everyone (motivation);
  // gauges and management are scoped inside the page/API by permission.
  navItems.push({ href: "/targets", label: "Targets & Rewards", section: "Targets" });
  if (permissions.includes("targets.manage")) {
    navItems.push({ href: "/targets/manage", label: "Manage Targets", section: "Targets" });
  }
  // Attendance (SPEC §11). Everyone with attendance.own gets the self check-in
  // page; managers (attendance.view_all) also get the leave-approval view.
  if (permissions.includes("attendance.own")) {
    navItems.push({ href: "/attendance", label: "My Attendance", section: "Attendance" });
  }
  if (permissions.includes("attendance.view_all")) {
    navItems.push({
      href: "/attendance/manage",
      label: "Attendance & Leave",
      section: "Attendance",
    });
  }
  if (permissions.includes("users.manage")) {
    navItems.push(
      { href: "/admin/users", label: "Users", section: "Admin" },
      { href: "/admin/teams", label: "Teams", section: "Admin" },
      { href: "/admin/roles", label: "Roles & Permissions", section: "Admin" }
    );
  }
  if (permissions.includes("audit.view")) {
    navItems.push({ href: "/admin/audit", label: "Audit Log", section: "Admin" });
  }
  // Settings (SPEC §11 attendance office hours; STEADFAST_INTEGRATION.md §1) —
  // admin-only (settings.manage).
  if (permissions.includes("settings.manage")) {
    navItems.push(
      {
        href: "/settings/attendance",
        label: "Attendance Settings",
        section: "Admin",
      },
      {
        href: "/settings/steadfast",
        label: "Steadfast Integration",
        section: "Admin",
      }
    );
  }

  const roleLabel = ROLE_LABELS[user.role.name as RoleName] ?? user.role.name;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-lg font-bold">🎁 Gift Valy</span>
        </div>
        <SidebarNav items={navItems} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2 md:hidden">
            <span className="font-bold">🎁 Gift Valy</span>
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
