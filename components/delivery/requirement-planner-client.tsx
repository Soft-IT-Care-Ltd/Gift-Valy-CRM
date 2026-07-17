"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtDayMonth, type DeliveryPeriod } from "@/lib/delivery-schedule";
import type { RequirementPlan } from "@/lib/requirement-planner";
import { DeliveryPeriodFilter } from "@/components/delivery/delivery-period-filter";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function RequirementPlannerClient({
  plan,
  period,
  from,
  to,
  showCosts,
}: {
  plan: RequirementPlan;
  period: DeliveryPeriod;
  from: string;
  to: string;
  showCosts: boolean;
}) {
  const router = useRouter();

  // Editable per-product unit cost (the "current avg cost, editable estimate").
  // Keyed by productId; seeded from the plan, recomputes purchase amounts live.
  const [costs, setCosts] = useState<Record<number, string>>(() =>
    Object.fromEntries(plan.rows.map((r) => [r.productId, String(r.unitCost)]))
  );

  const extraParams = plan.includeDrafts ? { drafts: "1" } : undefined;

  function toggleDrafts() {
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    if (!plan.includeDrafts) params.set("drafts", "1");
    router.push(`/stock/requirement-planner?${params.toString()}`);
  }

  // Live purchase amount per row from the edited cost × shortage.
  const rowsWithAmount = useMemo(
    () =>
      plan.rows.map((r) => {
        const unitCost = Math.max(Number(costs[r.productId]) || 0, 0);
        return { ...r, unitCost, purchaseAmount: round2(r.shortage * unitCost) };
      }),
    [plan.rows, costs]
  );

  const shortRows = rowsWithAmount.filter((r) => r.shortage > 0);
  const grandTotal = round2(
    shortRows.reduce((s, r) => s + r.purchaseAmount, 0)
  );

  // ---- one-click requisition (short products only) ----
  function downloadCsv() {
    if (shortRows.length === 0) return;
    const header = ["SKU", "Product", "Shortage", "Unit", "Unit cost", "Amount"];
    const lines = shortRows.map((r) =>
      [
        r.sku,
        `"${r.name.replace(/"/g, '""')}"`,
        r.shortage,
        r.unit,
        r.unitCost,
        r.purchaseAmount,
      ].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `requisition-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function prefillPurchase() {
    if (shortRows.length === 0) return;
    const payload = {
      lines: shortRows.map((r) => ({
        productId: r.productId,
        qty: r.shortage,
        unitCost: r.unitCost,
      })),
      notes: `Requisition for deliveries ${from} → ${to}`,
    };
    try {
      sessionStorage.setItem("gv_purchase_prefill", JSON.stringify(payload));
      router.push("/purchases");
    } catch {
      toast.error("Couldn't hand the requisition to the purchase form");
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Delivery Requirement Planner</CardTitle>
            <CardDescription>
              What stock the deliveries due {fmtDayMonth(from)} – {fmtDayMonth(to)}{" "}
              need, vs what&apos;s on hand — and how much to buy to cover the gap.
              Fixed-date orders in the window + all ASAP orders (Confirmed &amp;
              Packed{plan.includeDrafts ? ", incl. Drafts" : ""}).
            </CardDescription>
          </div>
          <DeliveryPeriodFilter
            basePath="/stock/requirement-planner"
            period={period}
            from={from}
            to={to}
            extraParams={extraParams}
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={plan.includeDrafts}
                onChange={toggleDrafts}
              />
              Include DRAFT orders (committed but unpaid)
            </label>
            <span className="text-sm text-muted-foreground">
              {plan.orderCount} order{plan.orderCount === 1 ? "" : "s"} in scope
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {plan.rows.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No stock-tracked demand for deliveries in this period.
            </p>
          ) : (
            <>
              {/* Grand total + requisition actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-sm">
                  {shortRows.length === 0 ? (
                    <span className="font-medium text-green-700 dark:text-green-400">
                      ✅ Enough stock for every delivery in this period.
                    </span>
                  ) : (
                    <>
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {shortRows.length} product
                        {shortRows.length === 1 ? "" : "s"} short
                      </span>
                      {showCosts && (
                        <span className="ml-2 text-muted-foreground">
                          — এই period-এর delivery দিতে হলে purchase-এ লাগবে{" "}
                          <span className="font-semibold text-foreground">
                            {money(grandTotal)}
                          </span>
                        </span>
                      )}
                    </>
                  )}
                </div>
                {shortRows.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={downloadCsv}>
                      Download CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.print()}
                    >
                      Print
                    </Button>
                    <Button size="sm" onClick={prefillPurchase}>
                      Pre-fill purchase entry
                    </Button>
                  </div>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                    <TableHead className="text-right">Shortage</TableHead>
                    {showCosts && (
                      <TableHead className="text-right">Unit cost</TableHead>
                    )}
                    {showCosts && (
                      <TableHead className="text-right">Purchase amount</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowsWithAmount.map((r) => (
                    <TableRow
                      key={r.productId}
                      className={cn(r.shortage > 0 && "bg-red-50/50 dark:bg-red-950/20")}
                    >
                      <TableCell>
                        <div className="font-medium">
                          {r.name}
                          {r.isComponent && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 text-[10px] text-muted-foreground"
                            >
                              Component
                            </Badge>
                          )}
                        </div>
                        {r.sku && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {r.sku}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.required} {r.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.inStock}
                        {r.packed > 0 && (
                          <div className="text-xs text-muted-foreground">
                            +{r.packed} packed
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.shortage > 0 ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            ⚠ short by {r.shortage}
                          </span>
                        ) : (
                          <span className="text-green-700 dark:text-green-400">
                            ✅ enough
                          </span>
                        )}
                      </TableCell>
                      {showCosts && (
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="ml-auto h-8 w-24 text-right"
                            value={costs[r.productId] ?? ""}
                            onChange={(e) =>
                              setCosts((prev) => ({
                                ...prev,
                                [r.productId]: e.target.value,
                              }))
                            }
                            disabled={r.shortage === 0}
                          />
                        </TableCell>
                      )}
                      {showCosts && (
                        <TableCell className="text-right tabular-nums">
                          {r.shortage > 0 ? money(r.purchaseAmount) : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {showCosts && shortRows.length > 0 && (
                <div className="flex justify-end border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Grand total to purchase:</span>
                  <span className="ml-3 text-base font-semibold">
                    {money(grandTotal)}
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
