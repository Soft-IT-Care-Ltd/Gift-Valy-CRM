"use client";

import { useState } from "react";
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
import { money } from "@/lib/format";
import { toCsv, downloadCsv } from "@/lib/csv";
import { monthLabel, type LeaderboardRow } from "@/lib/targets-constants";

type SortKey = "amount" | "orders";

// SPEC §10 — monthly leaderboard, visible to all. Order count + sales value
// only; no reward amounts, no costs.
export function LeaderboardTable({
  rows,
  monthKey,
  highlightUserId,
}: {
  rows: LeaderboardRow[];
  monthKey: string;
  highlightUserId: number;
}) {
  const [sort, setSort] = useState<SortKey>("amount");

  const sorted = [...rows].sort((a, b) =>
    sort === "amount"
      ? a.amountRank - b.amountRank || b.orders - a.orders
      : a.ordersRank - b.ordersRank || b.amount - a.amount
  );

  function exportCsv() {
    const csv = toCsv(
      ["Rank (value)", "Rank (orders)", "Name", "Team", "Orders", "Sales value"],
      sorted.map((r) => [
        r.amountRank,
        r.ordersRank,
        r.name,
        r.teamName ?? "",
        r.orders,
        r.amount,
      ])
    );
    downloadCsv(`leaderboard-${monthKey}.csv`, csv);
  }

  const medal = (rank: number) =>
    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">
            Leaderboard · {monthLabel(monthKey)}
          </CardTitle>
          <CardDescription>
            Everyone sees this. Sorted by{" "}
            {sort === "amount" ? "sales value" : "order count"}.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant={sort === "amount" ? "default" : "outline"}
            size="sm"
            onClick={() => setSort("amount")}
          >
            By value
          </Button>
          <Button
            variant={sort === "orders" ? "default" : "outline"}
            size="sm"
            onClick={() => setSort("orders")}
          >
            By orders
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => {
                const rank = sort === "amount" ? r.amountRank : r.ordersRank;
                const isMe = r.userId === highlightUserId;
                return (
                  <TableRow
                    key={r.userId}
                    className={isMe ? "bg-primary/5 font-medium" : ""}
                  >
                    <TableCell className="tabular-nums">
                      {medal(rank) ?? rank}
                    </TableCell>
                    <TableCell>
                      {r.name}
                      {isMe && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          You
                        </Badge>
                      )}
                      {r.isOnboarding && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Onboarding
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.teamName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.orders}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No sellers yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
