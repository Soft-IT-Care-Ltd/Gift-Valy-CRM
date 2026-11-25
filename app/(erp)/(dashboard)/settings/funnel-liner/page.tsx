import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { dhakaYearMonth } from "@/lib/order-number";
import { monthlyUsage, previousYearMonth } from "@/lib/platform/usage";
import { readPlatformState } from "@/lib/platform/state";
import { periodLabel } from "@/lib/platform/billing-display";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const STATE_LABEL = { active: "Active", past_due: "Bill due", suspended: "Suspended" } as const;

// FUNNEL_LINER.md GV-10 — the Funnel Liner card: read-only, Admin only. The
// counts are the billed numbers (order_sequences, CLAUDE.md rule 6), the same
// ones GET /api/platform/usage reports to Funnel Liner.
export default async function FunnelLinerSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: { select: { name: true } } },
  });
  if (me?.role.name !== "Admin") redirect("/");

  const thisMonth = dhakaYearMonth();
  const [state, months] = await Promise.all([
    readPlatformState(prisma),
    monthlyUsage(prisma, [thisMonth, previousYearMonth(thisMonth)]),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Funnel Liner</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status
            <Badge variant={state.state === "active" ? "secondary" : "destructive"}>
              {STATE_LABEL[state.state]}
            </Badge>
          </CardTitle>
          <CardDescription>
            {state.changedAt ? `Last changed ${formatDateTime(state.changedAt)}` : "Never changed"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <table className="w-full">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 text-right font-medium">Orders created</th>
                <th className="py-2 text-right font-medium">Last order number</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m.yearMonth} className="border-b last:border-0">
                  <td className="py-2">
                    {periodLabel(m.yearMonth)}
                    <span className="text-muted-foreground"> · {i === 0 ? "this month" : "last month"}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{m.ordersCreated.toLocaleString("en-IN")}</td>
                  <td className="py-2 text-right font-mono text-xs">{m.lastOrderNo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground">
            Your Funnel Liner bill is based on these numbers. Every order created counts, including
            cancelled orders.
          </p>
          <Link href="/billing" className="inline-block font-medium text-primary hover:underline">
            Open Billing →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
