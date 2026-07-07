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
