import Link from "next/link";
import { buildPurchaseDues } from "@/lib/purchases";
import { money, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Owner-dashboard alert for outstanding supplier bills (SPEC §6.3). Renders
// nothing when there are no dues, so a clean books produces no noise. Gated by
// purchases.create in the caller (app/(dashboard)/page.tsx).
export async function SupplierDuesAlert() {
  const dues = await buildPurchaseDues();
  if (dues.rows.length === 0) return null;

  const soonest = dues.rows.slice(0, 3);
  const hasOverdue = dues.overdueCount > 0;

  return (
    <Card className={hasOverdue ? "border-destructive/50" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Supplier dues</CardTitle>
            <CardDescription>
              {hasOverdue
                ? `${dues.overdueCount} overdue bill${dues.overdueCount > 1 ? "s" : ""} — pay to keep suppliers current.`
                : "Upcoming purchase bills to pay."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {hasOverdue && (
              <Badge variant="destructive">
                Overdue {money(dues.overdueTotal)}
              </Badge>
            )}
            <Badge variant="outline">
              Outstanding {money(dues.totalOutstanding)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ul className="divide-y">
          {soonest.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-1.5">
              <span className="font-medium">{r.supplierName}</span>
              <span className="flex items-center gap-3">
                {r.dueDate && (
                  <span
                    className={
                      r.overdue ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {r.overdue ? `${r.ageDays}d overdue` : `due ${formatDate(r.dueDate)}`}
                  </span>
                )}
                <span className="font-medium">{money(r.due)}</span>
              </span>
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" size="sm">
          <Link href="/purchases">Manage supplier dues</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
