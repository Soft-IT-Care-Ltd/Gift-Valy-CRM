import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
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

export const dynamic = "force-dynamic";

const dhakaTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function AuditPage() {
  await requirePagePermission("audit.view");

  const logs = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>
          Last 100 sensitive actions — who, when, before/after. Times in
          Asia/Dhaka.
        </CardDescription>
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
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">
                    {dhakaTime.format(l.at)}
                  </TableCell>
                  <TableCell>{l.user.name}</TableCell>
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
              {logs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No audit entries yet.
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
