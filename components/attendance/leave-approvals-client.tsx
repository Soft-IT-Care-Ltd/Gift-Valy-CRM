"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function LeaveApprovalsClient({
  requests,
}: {
  requests: LeaveRequestRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  async function decide(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leave-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update");
      toast.success(action === "approve" ? "Leave approved" : "Leave rejected");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusyId(null);
    }
  }

  const date = (ymd: string) => formatDate(`${ymd}T00:00:00+06:00`);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending leave requests ({pending.length})
          </CardTitle>
          <CardDescription>
            Approve or reject. Approved leave shows as “On leave” in the report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.userName}</TableCell>
                    <TableCell>{date(r.fromDate)}</TableCell>
                    <TableCell>{date(r.toDate)}</TableCell>
                    <TableCell className="text-right">{r.days}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={r.reason}>
                      {r.reason}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, "approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {pending.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No pending requests. 🎉
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decided this month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decided.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.userName}</TableCell>
                      <TableCell>{date(r.fromDate)}</TableCell>
                      <TableCell>{date(r.toDate)}</TableCell>
                      <TableCell className="text-right">{r.days}</TableCell>
                      <TableCell
                        className="max-w-[18rem] truncate"
                        title={r.reason}
                      >
                        {r.reason}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "APPROVED" ? "secondary" : "destructive"
                          }
                        >
                          {LEAVE_STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
