import { LOCK_MESSAGE_BN, LOCK_MESSAGE_EN } from "@/lib/platform/lock";
import {
  dayLabelEn,
  periodLabel,
  taka,
  type BillingInvoice,
  type BillingStatus,
} from "@/lib/platform/billing-display";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// FUNNEL_LINER.md GV-8 — pieces shared by the Billing page and the
// print-ready invoice page. Server-safe (no hooks).

/** What everyone without billing.view sees while suspended: no amounts. */
export function BillingLockedNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-background p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold">Dashboard closed</h1>
      <p className="font-bangla text-base font-semibold">ড্যাশবোর্ড বন্ধ</p>
      <p className="mt-4 text-sm">{LOCK_MESSAGE_EN}</p>
      <p className="font-bangla mt-2 text-sm">{LOCK_MESSAGE_BN}</p>
    </div>
  );
}

const TONE_CLASS: Record<BillingStatus["tone"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  due: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  "last-day": "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
  suspended: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
};

export function BillingStatusBox({ status }: { status: BillingStatus }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3", TONE_CLASS[status.tone])}>
      <div className="text-base font-semibold">{status.en}</div>
      <div className="font-bangla text-sm">{status.bn}</div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Issued",
  paid: "Paid",
  partially_paid: "Partly paid",
  overdue: "Overdue",
  void: "Void",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status.replace(/_/g, " ");
  return (
    <Badge variant={status === "paid" ? "secondary" : status === "void" ? "outline" : "destructive"}>
      {label}
    </Badge>
  );
}

/** Lines, total, paid, due, due date — the body of an invoice. */
export function InvoiceBody({ invoice }: { invoice: BillingInvoice }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <Fact label="Invoice" value={invoice.number} />
        <Fact label="Period" value={periodLabel(invoice.period)} />
        <Fact label="Issued" value={dayLabelEn(invoice.issuedOn)} />
        <Fact label="Due by" value={dayLabelEn(invoice.dueOn)} />
        <Fact label="Orders created" value={invoice.ordersCreated.toLocaleString("en-IN")} />
        <Fact label="Last order no." value={invoice.lastOrderNo ?? "—"} />
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={i} className="border-b">
              <td className="py-1.5">{line.label}</td>
              <td className="py-1.5 text-right tabular-nums">{taka(line.amountPaisa)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">{taka(invoice.totalPaisa)}</td>
          </tr>
          <tr>
            <td className="py-1 text-muted-foreground">Paid</td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">{taka(invoice.paidPaisa)}</td>
          </tr>
          <tr className="font-semibold">
            <td className="py-1">Due</td>
            <td className="py-1 text-right tabular-nums">{taka(invoice.duePaisa)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
