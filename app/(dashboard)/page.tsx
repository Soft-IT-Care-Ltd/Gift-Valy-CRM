import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { PERMISSION_DEFS, ROLE_LABELS, type RoleName } from "@/lib/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function HomePage() {
  // Pages render in parallel with the layout, so guard here too.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, team: true },
  });
  if (!user) return null;

  const permissions = await getEffectivePermissions(user.id);
  const groups = new Map<string, string[]>();
  for (const def of PERMISSION_DEFS) {
    if (!permissions.includes(def.key)) continue;
    const list = groups.get(def.group) ?? [];
    list.push(def.label);
    groups.set(def.group, list);
  }

  const roleLabel = ROLE_LABELS[user.role.name as RoleName] ?? user.role.name;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user.name} 👋</CardTitle>
          <CardDescription>
            Signed in as <Badge variant="secondary">{roleLabel}</Badge>
            {user.team && <> · Team: {user.team.name}</>}
          </CardDescription>
        </CardHeader>
        {permissions.includes("users.manage") && (
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Link className="underline" href="/admin/users">
              Manage users
            </Link>
            <span>·</span>
            <Link className="underline" href="/admin/teams">
              Manage teams
            </Link>
            <span>·</span>
            <Link className="underline" href="/admin/roles">
              Permission matrix
            </Link>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your access</CardTitle>
          <CardDescription>
            What your role ({roleLabel}) can do. Modules ship phase by phase —
            Leads, Orders, Stock and the rest arrive in the next build steps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {[...groups.entries()].map(([group, labels]) => (
            <div key={group}>
              <div className="mb-1 text-sm font-semibold">{group}</div>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {labels.map((l) => (
                  <li key={l}>• {l}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
