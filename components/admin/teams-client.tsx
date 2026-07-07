"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface TeamRow {
  id: number;
  name: string;
  leaderUserId: number | null;
  leaderName: string | null;
  memberNames: string[];
}

interface UserOption {
  id: number;
  name: string;
}

const NONE = "__none__";

export function TeamsClient({
  teams,
  users,
}: {
  teams: TeamRow[];
  users: UserOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState(NONE);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setLeaderId(NONE);
    setDialogOpen(true);
  }

  function openEdit(t: TeamRow) {
    setEditing(t);
    setName(t.name);
    setLeaderId(t.leaderUserId != null ? String(t.leaderUserId) : NONE);
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const payload = {
      name,
      leaderUserId: leaderId === NONE ? null : Number(leaderId),
    };
    const res = await fetch(
      editing ? `/api/teams/${editing.id}` : "/api/teams",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save team");
      return;
    }
    toast.success(editing ? "Team updated" : "Team created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(t: TeamRow) {
    if (!confirm(`Delete team "${t.name}"?`)) return;
    const res = await fetch(`/api/teams/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete team");
      return;
    }
    toast.success("Team deleted");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Teams</CardTitle>
          <CardDescription>
            Sales teams with a leader; users are assigned from the Users page.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>New team</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Leader</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.leaderName ?? "—"}</TableCell>
                <TableCell className="max-w-md">
                  {t.memberNames.length > 0 ? t.memberNames.join(", ") : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(t)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => remove(t)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {teams.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No teams yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New team"}</DialogTitle>
            <DialogDescription>
              The leader sees the whole team’s leads, orders and targets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Team name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Leader</Label>
              <Select value={leaderId} onValueChange={setLeaderId}>
                <SelectTrigger>
                  <SelectValue placeholder="No leader" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No leader</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
