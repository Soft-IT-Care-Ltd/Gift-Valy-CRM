import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { readBillingSnapshot } from "@/lib/platform/billing";
import { InvoiceBody, InvoiceStatusBadge } from "@/components/billing/billing-parts";
import { PrintButton } from "@/components/billing/print-button";

export const dynamic = "force-dynamic";

// FUNNEL_LINER.md GV-8 — one Funnel Liner invoice, print-ready (the
// dashboard's sidebar and header are print:hidden). billing.view only.
export default async function BillingInvoicePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requirePagePermission("billing.view");
  const { number } = await params;
  const snapshot = await readBillingSnapshot(prisma);
  const invoice = snapshot?.invoices.find((i) => i.number === decodeURIComponent(number));
  if (!invoice) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/billing" className="text-sm text-primary hover:underline">
          ← Billing
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border bg-background p-6 print:border-0 print:p-0">
        <div className="mb-4 flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-lg font-semibold">Funnel Liner invoice</div>
            <div className="text-sm text-muted-foreground">Billed to Gift Valy</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Image src="/gift-valy-logo.png" alt="Gift Valy" width={815} height={246} className="h-7 w-auto" />
            <InvoiceStatusBadge status={invoice.status} />
          </div>
        </div>
        <InvoiceBody invoice={invoice} />
        {snapshot?.payTo && (
          <div className="mt-4 space-y-1 border-t pt-3 text-sm">
            {snapshot.payTo.bkash && <div>bKash: {snapshot.payTo.bkash}</div>}
            {snapshot.payTo.bank && <div className="whitespace-pre-line">Bank: {snapshot.payTo.bank}</div>}
            <div className="font-medium">Use the invoice number ({invoice.number}) as the reference.</div>
          </div>
        )}
      </div>
    </div>
  );
}
