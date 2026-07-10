"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/lib/format";
import {
  LEAVE_STATUS_LABELS,
  type LeaveRequestRow,
} from "@/lib/attendance-constants";

// SPEC §11 — an employee's own leave requests: submit a new one and withdraw a
// still-pending one.
export function LeavePanel({ requests }: { requests: LeaveRequestRow[] }) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fromDate || !toDate || reason.trim().length < 3) {
      toast.error("Pick dates and give a short reason");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate, toDate, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit");
      toast.success("Leave request submitted");
      setFromDate("");
      setToDate("");
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leave-requests/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not withdraw");
      toast.success("Request withdrawn");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not withdraw");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave requests</CardTitle>
        <CardDescription>
          Request time off — a manager approves or rejects it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Family event"
              rows={1}
              className="min-h-9"
            />
          </div>
          <Button onClick={submit} disabled={busy}>
            Request
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDate(`${r.fromDate}T00:00:00+06:00`)}</TableCell>
                  <TableCell>{formatDate(`${r.toDate}T00:00:00+06:00`)}</TableCell>
                  <TableCell className="text-right">{r.days}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={r.reason}>
                    {r.reason}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "APPROVED"
                          ? "secondary"
                          : r.status === "REJECTED"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {LEAVE_STATUS_LABELS[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "PENDING" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => withdraw(r.id)}
                      >
                        Withdraw
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No leave requests yet.
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
