"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "@/lib/format";

export interface EditRequestRow {
  id: number;
  orderId: number;
  orderNo: string;
  requestedBy: string;
  reason: string | null;
  createdAt: string;
}

export function EditRequestsClient({ requests }: { requests: EditRequestRow[] }) {
  const router = useRouter();

  async function review(id: number, action: "APPROVE" | "REJECT") {
    const note =
      action === "REJECT"
        ? prompt("Rejection note (optional)") ?? undefined
        : undefined;
    const res = await fetch(`/api/edit-requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to review request");
      return;
    }
    toast.success(action === "APPROVE" ? "Edit applied" : "Request rejected");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order edit requests</CardTitle>
        <CardDescription>
          Changes submitted by Sales Executives after their edit window —
          approving applies the changes and recomputes totals & due.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="hover:underline"
                  >
                    {r.orderNo}
                  </Link>
                </TableCell>
                <TableCell>{r.requestedBy}</TableCell>
                <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                <TableCell className="max-w-md text-muted-foreground">
                  {r.reason}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => review(r.id, "APPROVE")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => review(r.id, "REJECT")}
                    >
                      Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {requests.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No pending edit requests.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
