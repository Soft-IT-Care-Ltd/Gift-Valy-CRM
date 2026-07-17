// SPEC §3.2 — follow-up reminders (today + overdue) at the viewer's lead scope.
// Server component shared by the SE and TL home dashboards.
import Link from "next/link";
import type { Session } from "next-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildFollowUps, leadScopeWhere } from "@/lib/leads";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-constants";
import { formatDateTime } from "@/lib/format";

export async function FollowUpsWidget({
  session,
  permissions,
}: {
  session: Session;
  permissions: string[];
}) {
  const scope = await leadScopeWhere(session, permissions);
  const fu = await buildFollowUps(scope);
  if (fu.todayCount === 0 && fu.overdueCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-ups</CardTitle>
          <CardDescription>
            No leads due for a follow-up today. Nicely on top of it. 👍
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = [
    ...fu.overdue.map((l) => ({ l, overdue: true })),
    ...fu.today.map((l) => ({ l, overdue: false })),
  ].slice(0, 8);

  return (
    <Card className={fu.overdueCount > 0 ? "border-destructive/40" : ""}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            Today&apos;s follow-ups: {fu.todayCount}
          </CardTitle>
          <CardDescription>
            {fu.overdueCount > 0 ? (
              <span className="font-medium text-destructive">
                {fu.overdueCount} overdue — act now
              </span>
            ) : (
              "Leads due for a follow-up today."
            )}
          </CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads">Open leads</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Follow-up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ l, overdue }) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">
                    {l.customerName ?? l.whatsappNumber}
                  </div>
                  {l.customerName && (
                    <div className="text-xs text-muted-foreground">
                      {l.whatsappNumber}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {LEAD_SOURCE_LABELS[l.source]}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{LEAD_STATUS_LABELS[l.status]}</Badge>
                </TableCell>
                <TableCell
                  className={
                    overdue
                      ? "font-medium text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {l.followUpAt ? formatDateTime(l.followUpAt) : "—"}
                  {overdue ? " · overdue" : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
