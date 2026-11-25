import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { dhakaYearMonth } from "@/lib/order-number";
import { monthlyUsage } from "@/lib/platform/usage";
import { readPlatformState } from "@/lib/platform/state";
import { readBillingSnapshot } from "@/lib/platform/billing";
import {
  billingStatus,
  currentInvoice,
  dayLabelEn,
  estimateBill,
  periodLabel,
  taka,
} from "@/lib/platform/billing-display";
import {
  BillingLockedNotice,
  BillingStatusBox,
  InvoiceBody,
  InvoiceStatusBadge,
} from "@/components/billing/billing-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const REFERENCE_LINE = "Use the invoice number as the reference.";

// FUNNEL_LINER.md GV-8 — the Funnel Liner bill. Rendered on the server from
// the stored snapshot (GV-4, settings "platform_billing") and the order
// counter (CLAUDE.md rule 6), so no API ever carries an amount. Admin and
// Accounts (billing.view) see the bill; while suspended everyone else sees
// the short "dashboard closed" message, and otherwise is sent home.
export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const [permissions, state] = await Promise.all([
    getEffectivePermissions(session.user.id),
    readPlatformState(prisma),
  ]);

  if (!permissions.includes("billing.view")) {
    if (state.state === "suspended") return <BillingLockedNotice />;
    redirect("/");
  }

  const thisMonth = dhakaYearMonth();
  const [snapshot, [usage]] = await Promise.all([
    readBillingSnapshot(prisma),
    monthlyUsage(prisma, [thisMonth]),
  ]);
  const invoice = currentInvoice(snapshot);
  const status = billingStatus(state, invoice);
  const estimate = snapshot ? estimateBill(snapshot.plan, usage.ordersCreated) : null;
  const helpPhone = process.env.FUNNEL_LINER_HELP_PHONE?.trim();
  const history = snapshot
    ? [...snapshot.invoices].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">Your Funnel Liner bill · Funnel Liner বিল</p>
      </div>

      <BillingStatusBox status={status} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>This month so far · {periodLabel(thisMonth)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span>Orders created</span>
              <span className="text-2xl font-semibold tabular-nums">
                {usage.ordersCreated.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Last order number: {usage.lastOrderNo ?? "none yet"}. Every order created counts,
              including cancelled orders.
            </div>
            {estimate ? (
              <>
                <div className="flex justify-between border-t pt-2">
                  <span>Band</span>
                  <span>{estimate.bandLabel}</span>
                </div>
                {estimate.lines.map((l) => (
                  <div key={l.label} className="flex justify-between text-muted-foreground">
                    <span>{l.label}</span>
                    <span className="tabular-nums">{taka(l.amountPaisa)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold">
                  <span>Estimated bill</span>
                  <span className="tabular-nums">{taka(estimate.totalPaisa)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Estimate; the bill is raised on the 1st.
                </div>
              </>
            ) : (
              <div className="border-t pt-2">
                <div>Your first bill will appear here on the 1st.</div>
                <div className="font-bangla text-muted-foreground">
                  আপনার প্রথম বিল মাসের ১ তারিখে এখানে দেখা যাবে।
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to pay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {snapshot?.payTo?.bkash && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">bKash</span>
                <span className="font-medium tabular-nums">{snapshot.payTo.bkash}</span>
              </div>
            )}
            {snapshot?.payTo?.bank && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Bank</span>
                <span className="whitespace-pre-line text-right font-medium">{snapshot.payTo.bank}</span>
              </div>
            )}
            {snapshot?.payTo?.note && snapshot.payTo.note !== REFERENCE_LINE && (
              <div className="text-muted-foreground">{snapshot.payTo.note}</div>
            )}
            <div className="font-medium">{REFERENCE_LINE}</div>
            <div className="font-bangla text-muted-foreground">রেফারেন্স হিসেবে ইনভয়েস নম্বর ব্যবহার করুন।</div>
            {helpPhone && (
              <div className="border-t pt-2">
                Funnel Liner help: <a className="font-medium underline" href={`tel:${helpPhone}`}>{helpPhone}</a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {invoice && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Current invoice</CardTitle>
            <InvoiceStatusBadge status={invoice.status} />
          </CardHeader>
          <CardContent>
            <InvoiceBody invoice={invoice} />
            <Link
              href={`/billing/invoices/${encodeURIComponent(invoice.number)}`}
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Print invoice →
            </Link>
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Orders</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Due</th>
                  <th className="py-2 font-medium">Due by</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((inv) => (
                  <tr key={inv.number} className="border-b last:border-0">
                    <td className="py-2">
                      <Link
                        href={`/billing/invoices/${encodeURIComponent(inv.number)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="py-2">{periodLabel(inv.period)}</td>
                    <td className="py-2 tabular-nums">{inv.ordersCreated.toLocaleString("en-IN")}</td>
                    <td className="py-2 text-right tabular-nums">{taka(inv.totalPaisa)}</td>
                    <td className="py-2 text-right tabular-nums">{taka(inv.duePaisa)}</td>
                    <td className="py-2">{dayLabelEn(inv.dueOn)}</td>
                    <td className="py-2"><InvoiceStatusBadge status={inv.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
