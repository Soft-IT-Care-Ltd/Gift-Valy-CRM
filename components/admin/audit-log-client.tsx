"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";

interface AuditRow {
  id: number;
  at: string;
  userName: string;
  userEmail: string;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
}

interface Filters {
  entity: string;
  action: string;
  user: string;
  from: string;
  to: string;
}

export function AuditLogClient({
  rows,
  total,
  page,
  pageSize,
  entities,
  actions,
  users,
  filters,
}: {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  entities: string[];
  actions: string[];
  users: { id: number; name: string }[];
  filters: Filters;
}) {
  const router = useRouter();

  // Build a URL from the current filters, resetting to page 1 unless a page is
  // explicitly carried over.
  function navigate(next: Partial<Filters & { page: number }>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.entity) params.set("entity", merged.entity);
    if (merged.action) params.set("action", merged.action);
    if (merged.user) params.set("user", merged.user);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    router.push(`/admin/audit${params.toString() ? `?${params}` : ""}`);
  }

  function reset() {
    router.push("/admin/audit");
  }

  function exportCsv() {
    const headers = ["When", "User", "Action", "Entity", "Entity ID", "Before", "After"];
    const body = rows.map((r) => [
      formatDateTime(r.at),
      r.userName,
      r.action,
      r.entity,
      r.entityId ?? "",
      r.beforeJson != null ? JSON.stringify(r.beforeJson) : "",
      r.afterJson != null ? JSON.stringify(r.afterJson) : "",
    ]);
    downloadCsv(`audit-log-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every sensitive mutation — who, when, and the before/after values. Times
          in Asia/Dhaka.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">Entity</Label>
            <Select
              value={filters.entity || "ALL"}
              onValueChange={(v) => navigate({ entity: v === "ALL" ? "" : v })}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All entities</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Action</Label>
            <Select
              value={filters.action || "ALL"}
              onValueChange={(v) => navigate({ action: v === "ALL" ? "" : v })}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">User</Label>
            <Select
              value={filters.user || "ALL"}
              onValueChange={(v) => navigate({ user: v === "ALL" ? "" : v })}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DateFilter
            showAllTime
            value={detectPreset(filters.from, filters.to, "all")}
            from={filters.from}
            to={filters.to}
            onApply={(preset, from, to) =>
              navigate(preset === "all" ? { from: "", to: "" } : { from, to })
            }
          />
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
          <Button
            variant="outline"
            className="ml-auto"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Entries</CardTitle>
            <CardDescription>
              {total === 0
                ? "No entries match these filters."
                : `Showing ${firstRow}–${lastRow} of ${total}.`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => navigate({ page: page - 1 })}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => navigate({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(l.at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{l.userName}</TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.entity}
                      {l.entityId ? `#${l.entityId}` : ""}
                    </TableCell>
                    <TableCell className="max-w-md">
                      {(l.beforeJson != null || l.afterJson != null) && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            before / after
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(
                              { before: l.beforeJson, after: l.afterJson },
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No audit entries.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
