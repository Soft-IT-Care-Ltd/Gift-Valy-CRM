// CORRECTIONS Orders §7 (C8) — occasion reminders in the SE follow-up area:
// upcoming recipient birthdays/anniversaries within the configurable lead time,
// each with a one-tap WhatsApp pitch. Server component shared by the SE and TL
// homes; scoped to the customers the viewer's orders reach.
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import type { Session } from "next-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orderScopeWhere } from "@/lib/orders";
import { buildOccasionReminders } from "@/lib/occasions";
import { getOccasionReminderLeadDays } from "@/lib/settings";
import {
  daysRemainingLabel,
  fmtDayMonth,
  occasionFollowUpText,
} from "@/lib/occasion-constants";

function waHref(phoneForeign: string, text: string): string {
  return `https://wa.me/${phoneForeign.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export async function OccasionRemindersWidget({
  session,
  permissions,
}: {
  session: Session;
  permissions: string[];
}) {
  const [orderWhere, leadDays] = await Promise.all([
    orderScopeWhere(session, permissions),
    getOccasionReminderLeadDays(),
  ]);
  const scope: Prisma.CustomerWhereInput | undefined = permissions.includes(
    "orders.view_all"
  )
    ? undefined
    : { orders: { some: orderWhere } };

  const rows = await buildOccasionReminders({ leadDays, scope });
  if (rows.length === 0) return null;

  return (
    <Card className="border-violet-400/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            🎁 Occasion reminders ({rows.length})
          </CardTitle>
          <CardDescription>
            Birthdays &amp; anniversaries within {leadDays} day
            {leadDays === 1 ? "" : "s"} — pitch the repeat gift now.
          </CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link href="/occasions">Open occasions</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.slice(0, 8).map((r) => (
          <div
            key={`${r.occasionId}-${r.type}`}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span className="font-medium">{r.customerName}</span>
            <span className="text-xs text-muted-foreground">
              → {r.recipientName}
              {r.relation ? ` (${r.relation})` : ""}
            </span>
            <Badge
              variant="outline"
              className={
                r.type === "Birthday"
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                  : "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300"
              }
            >
              {r.type === "Birthday" ? "🎂" : "💍"} {fmtDayMonth(r.nextOccurrence)}
            </Badge>
            <Badge
              variant={r.daysRemaining <= 1 ? "destructive" : "secondary"}
              className="whitespace-nowrap"
            >
              {daysRemainingLabel(r.daysRemaining)}
            </Badge>
            <Button size="sm" variant="outline" className="ml-auto" asChild>
              <a
                href={waHref(
                  r.customerPhone,
                  occasionFollowUpText({
                    customerName: r.customerName,
                    recipientName: r.recipientName,
                    type: r.type,
                    nextOccurrence: r.nextOccurrence,
                  })
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                Follow up
              </a>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
