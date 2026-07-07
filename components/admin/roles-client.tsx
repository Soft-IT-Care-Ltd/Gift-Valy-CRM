"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PERMISSION_DEFS, ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface RoleData {
  id: number;
  name: string;
  permissionKeys: string[];
}

export function RolesClient({ roles }: { roles: RoleData[] }) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      Object.fromEntries(
        roles.map((r) => [r.id, new Set(r.permissionKeys)])
      ) as Record<number, Set<string>>,
    [roles]
  );
  const [matrix, setMatrix] = useState<Record<number, Set<string>>>(initial);
  const [saving, setSaving] = useState(false);

  function toggle(roleId: number, key: string) {
    setMatrix((m) => {
      const next = { ...m, [roleId]: new Set(m[roleId]) };
      if (next[roleId].has(key)) next[roleId].delete(key);
      else next[roleId].add(key);
      return next;
    });
  }

  const changedRoles = roles.filter((r) => {
    if (r.name === "Admin") return false;
    const a = new Set(r.permissionKeys);
    const b = matrix[r.id];
    return a.size !== b.size || [...a].some((k) => !b.has(k));
  });

  async function saveAll() {
    setSaving(true);
    let failed = false;
    for (const r of changedRoles) {
      const res = await fetch(`/api/roles/${r.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [...matrix[r.id]] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(
          `${r.name}: ${data?.error ?? "failed to save permissions"}`
        );
        failed = true;
      }
    }
    setSaving(false);
    if (!failed) {
      toast.success("Permission matrix saved");
      router.refresh();
    }
  }

  const groups = [...new Set(PERMISSION_DEFS.map((d) => d.group))];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Roles &amp; Permissions</CardTitle>
          <CardDescription>
            Seeded from the SPEC §2 matrix — editable per role. Admin always
            has every permission. Changes apply to API access immediately.
          </CardDescription>
        </div>
        <Button
          onClick={saveAll}
          disabled={saving || changedRoles.length === 0}
        >
          {saving
            ? "Saving…"
            : changedRoles.length > 0
              ? `Save changes (${changedRoles.length})`
              : "No changes"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Permission</TableHead>
                {roles.map((r) => (
                  <TableHead key={r.id} className="text-center">
                    {ROLE_LABELS[r.name as RoleName] ?? r.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <TableRow className="bg-muted/50">
                    <TableCell
                      colSpan={roles.length + 1}
                      className="py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {group}
                    </TableCell>
                  </TableRow>
                  {PERMISSION_DEFS.filter((d) => d.group === group).map(
                    (d) => (
                      <TableRow key={d.key}>
                        <TableCell>
                          <div className="text-sm">{d.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {d.key}
                          </div>
                        </TableCell>
                        {roles.map((r) => (
                          <TableCell key={r.id} className="text-center">
                            <Checkbox
                              checked={
                                r.name === "Admin" ||
                                matrix[r.id]?.has(d.key) ||
                                false
                              }
                              disabled={r.name === "Admin"}
                              onCheckedChange={() => toggle(r.id, d.key)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
