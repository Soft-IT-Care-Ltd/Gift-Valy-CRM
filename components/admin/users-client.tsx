"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PERMISSION_DEFS, ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface UserRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  roleId: number;
  roleName: string;
  teamId: number | null;
  teamName: string | null;
  isActive: boolean;
  isOnboarding: boolean;
  mustChangePassword: boolean;
  joinedAt: string | null;
  overridesCount: number;
}

interface Option {
  id: number;
  name: string;
}

const NONE = "__none__";

function roleLabel(name: string) {
  return ROLE_LABELS[name as RoleName] ?? name;
}

async function apiCall(
  url: string,
  method: string,
  body?: unknown
): Promise<boolean> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    toast.error(data?.error ?? `Request failed (${res.status})`);
    return false;
  }
  return true;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  password: string;
  roleId: string;
  teamId: string;
  joinedAt: string;
  isOnboarding: boolean;
  mustChangePassword: boolean;
}

const emptyForm: FormState = {
  name: "",
  email: "",
  phone: "",
  password: "",
  roleId: "",
  teamId: NONE,
  joinedAt: "",
  isOnboarding: false,
  mustChangePassword: true,
};

export function UsersClient({
  users,
  roles,
  teams,
}: {
  users: UserRow[];
  roles: Option[];
  teams: Option[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [overridesUser, setOverridesUser] = useState<UserRow | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(u: UserRow) {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      phone: u.phone ?? "",
      password: "",
      roleId: String(u.roleId),
      teamId: u.teamId != null ? String(u.teamId) : NONE,
      joinedAt: u.joinedAt ?? "",
      isOnboarding: u.isOnboarding,
      mustChangePassword: u.mustChangePassword,
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.roleId) {
      toast.error("Select a role");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      email: form.email,
      phone: form.phone || null,
      roleId: Number(form.roleId),
      teamId: form.teamId === NONE ? null : Number(form.teamId),
      joinedAt: form.joinedAt || null,
      isOnboarding: form.isOnboarding,
      ...(form.password ? { password: form.password } : {}),
      ...(editing ? {} : { mustChangePassword: form.mustChangePassword }),
    };
    const ok = editing
      ? await apiCall(`/api/users/${editing.id}`, "PATCH", payload)
      : await apiCall("/api/users", "POST", payload);
    setSaving(false);
    if (ok) {
      toast.success(editing ? "User updated" : "User created");
      setDialogOpen(false);
      router.refresh();
    }
  }

  async function toggleActive(u: UserRow) {
    const ok = u.isActive
      ? await apiCall(`/api/users/${u.id}`, "DELETE")
      : await apiCall(`/api/users/${u.id}`, "PATCH", { isActive: true });
    if (ok) {
      toast.success(u.isActive ? "User deactivated" : "User reactivated");
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Create, edit, deactivate users; assign roles, teams and per-user
            permission overrides.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>New user</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.isActive ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{roleLabel(u.roleName)}</Badge>
                  </TableCell>
                  <TableCell>{u.teamName ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={u.isActive ? "default" : "destructive"}>
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {u.isOnboarding && (
                        <Badge variant="outline">Onboarding</Badge>
                      )}
                      {u.mustChangePassword && (
                        <Badge variant="outline">Must change pw</Badge>
                      )}
                      {u.overridesCount > 0 && (
                        <Badge variant="outline">
                          {u.overridesCount} override
                          {u.overridesCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{u.joinedAt ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(u)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOverridesUser(u)}
                      >
                        Permissions
                      </Button>
                      <Button
                        variant={u.isActive ? "destructive" : "default"}
                        size="sm"
                        onClick={() => toggleActive(u)}
                      >
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Leave the password blank to keep it unchanged. Setting one forces the user to change it on next login."
                : "New users are asked to change their password on first login."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select
                  value={form.roleId}
                  onValueChange={(v) => setForm({ ...form, roleId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {roleLabel(r.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Team</Label>
                <Select
                  value={form.teamId}
                  onValueChange={(v) => setForm({ ...form, teamId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No team</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>{editing ? "Reset password (optional)" : "Password"}</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="min 8 characters"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Joined date</Label>
                <Input
                  type="date"
                  value={form.joinedAt}
                  onChange={(e) =>
                    setForm({ ...form, joinedAt: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="onboarding"
                checked={form.isOnboarding}
                onCheckedChange={(v) =>
                  setForm({ ...form, isOnboarding: v === true })
                }
              />
              <Label htmlFor="onboarding" className="font-normal">
                Onboarding (excluded from team targets initially)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {overridesUser && (
        <OverridesDialog
          user={overridesUser}
          onClose={(changed) => {
            setOverridesUser(null);
            if (changed) router.refresh();
          }}
        />
      )}
    </Card>
  );
}

// ---- Per-user permission overrides (Inherit / Allow / Deny) ----

type OverrideValue = "inherit" | "allow" | "deny";

function OverridesDialog({
  user,
  onClose,
}: {
  user: UserRow;
  onClose: (changed: boolean) => void;
}) {
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, OverrideValue>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${user.id}/overrides`)
      .then((r) => r.json())
      .then(
        (data: {
          rolePermissions: string[];
          overrides: { key: string; allow: boolean }[];
        }) => {
          setRolePerms(new Set(data.rolePermissions));
          const v: Record<string, OverrideValue> = {};
          for (const o of data.overrides) v[o.key] = o.allow ? "allow" : "deny";
          setValues(v);
        }
      )
      .catch(() => toast.error("Failed to load overrides"));
  }, [user.id]);

  async function save() {
    setSaving(true);
    const overrides = Object.entries(values)
      .filter(([, v]) => v !== "inherit")
      .map(([key, v]) => ({ key, allow: v === "allow" }));
    const ok = await apiCall(
      `/api/users/${user.id}/overrides`,
      "PUT",
      { overrides }
    );
    setSaving(false);
    if (ok) {
      toast.success("Overrides saved");
      onClose(true);
    }
  }

  const groups = [...new Set(PERMISSION_DEFS.map((d) => d.group))];
  const isAdmin = user.roleName === "Admin";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permission overrides — {user.name}</DialogTitle>
          <DialogDescription>
            Role: {roleLabel(user.roleName)}. “Inherit” follows the role matrix;
            Allow/Deny wins over the role.
            {isAdmin && " Admin always has every permission — overrides have no effect."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group}>
              <div className="mb-1 text-sm font-semibold">{group}</div>
              <div className="grid gap-1">
                {PERMISSION_DEFS.filter((d) => d.group === group).map((d) => {
                  const inherited = rolePerms.has(d.key);
                  const value = values[d.key] ?? "inherit";
                  return (
                    <div
                      key={d.key}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{d.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.key} · role: {inherited ? "allowed" : "not allowed"}
                        </div>
                      </div>
                      <Select
                        value={value}
                        onValueChange={(v) =>
                          setValues({ ...values, [d.key]: v as OverrideValue })
                        }
                        disabled={isAdmin}
                      >
                        <SelectTrigger className="w-28 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Inherit</SelectItem>
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || isAdmin}>
            {saving ? "Saving…" : "Save overrides"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
