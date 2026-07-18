"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money } from "@/lib/format";
import { MonthSwitcher } from "@/components/targets/month-switcher";
import {
  monthLabel,
  REWARD_RULE_TYPES,
  REWARD_RULE_TYPE_LABELS,
  REWARD_STATUS_LABELS,
  type RewardRuleTypeValue,
  type TargetRow,
  type RewardRuleRow,
  type RewardRow,
} from "@/lib/targets-constants";

interface UserPick {
  id: number;
  name: string;
  roleName: string;
  teamName: string | null;
  isOnboarding: boolean;
}
interface TeamPick {
  id: number;
  name: string;
}

export function TargetsManageClient({
  monthKey,
  users,
  teams,
  targets,
  rules,
  rewards,
  onboardingExcludeDays,
}: {
  monthKey: string;
  users: UserPick[];
  teams: TeamPick[];
  targets: TargetRow[];
  rules: RewardRuleRow[];
  rewards: RewardRow[];
  onboardingExcludeDays: number;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Manage targets &amp; rewards</h1>
          <p className="text-sm text-muted-foreground">
            Set {monthLabel(monthKey)} targets, maintain reward rules and run the
            month-close.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSwitcher monthKey={monthKey} />
          <Button variant="outline" asChild>
            <Link href="/targets">← Back</Link>
          </Button>
        </div>
      </div>

      <OnboardingSetting current={onboardingExcludeDays} />
      <TargetSetting
        monthKey={monthKey}
        users={users}
        teams={teams}
        targets={targets}
      />
      <RewardRules rules={rules} />
      <MonthClose monthKey={monthKey} rewards={rewards} />
    </div>
  );
}

// ---------- onboarding grace (SPEC §10) ----------

function OnboardingSetting({ current }: { current: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(current));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Enter a whole number of days");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/targets/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingExcludeDays: n }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to save");
      return;
    }
    toast.success("Onboarding grace updated");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Onboarding grace</CardTitle>
        <CardDescription>
          New joiners flagged “onboarding” are left out of team aggregate targets
          for this many days after joining.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">Days</Label>
          <Input
            type="number"
            min="0"
            className="w-28"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- target setting (SPEC §10) ----------

const USER_TARGETABLE_ROLES = ["SalesExecutive", "TeamLeader"];

function TargetSetting({
  monthKey,
  users,
  teams,
  targets,
}: {
  monthKey: string;
  users: UserPick[];
  teams: TeamPick[];
  targets: TargetRow[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"USER" | "TEAM">("USER");
  const [subjectId, setSubjectId] = useState("");
  const [orders, setOrders] = useState("");
  const [amount, setAmount] = useState("");
  const [confidential, setConfidential] = useState(false);
  const [saving, setSaving] = useState(false);

  const userOptions = users.filter((u) =>
    USER_TARGETABLE_ROLES.includes(u.roleName)
  );

  function reset() {
    setSubjectId("");
    setOrders("");
    setAmount("");
    setConfidential(false);
  }

  function loadForEdit(t: TargetRow) {
    setScope(t.scope);
    setSubjectId(String(t.subjectId));
    setOrders(t.targetOrders != null ? String(t.targetOrders) : "");
    setAmount(t.targetAmount != null ? String(t.targetAmount) : "");
    setConfidential(t.isConfidential);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!subjectId) {
      toast.error("Pick who the target is for");
      return;
    }
    const ordersNum = orders.trim() ? Number(orders) : null;
    const amountNum = amount.trim() ? Number(amount) : null;
    if ((ordersNum ?? 0) <= 0 && (amountNum ?? 0) <= 0) {
      toast.error("Set an order-count and/or a sales-value target");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthKey,
        scope,
        userId: scope === "USER" ? Number(subjectId) : null,
        teamId: scope === "TEAM" ? Number(subjectId) : null,
        targetOrders: ordersNum,
        targetAmount: amountNum,
        isConfidential: scope === "USER" ? confidential : false,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to save target");
      return;
    }
    toast.success("Target saved");
    reset();
    router.refresh();
  }

  async function remove(t: TargetRow) {
    if (!confirm(`Delete the ${monthLabel(monthKey)} target for ${t.subjectName}?`))
      return;
    const res = await fetch(`/api/targets/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to delete");
      return;
    }
    toast.success("Target deleted");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Set target · {monthLabel(monthKey)}</CardTitle>
        <CardDescription>
          Per SE/TL or per team: an order-count target and/or a sales-value
          target. Saving again for the same subject updates it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Scope</Label>
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v as "USER" | "TEAM");
                setSubjectId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">Individual (SE / TL)</SelectItem>
                <SelectItem value="TEAM">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">
              {scope === "USER" ? "Person" : "Team"}
            </Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {scope === "USER"
                  ? userOptions.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name} · {u.roleName === "TeamLeader" ? "TL" : "SE"}
                        {u.teamName ? ` · ${u.teamName}` : ""}
                      </SelectItem>
                    ))
                  : teams.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Target orders</Label>
            <Input
              type="number"
              min="0"
              placeholder="e.g. 50"
              value={orders}
              onChange={(e) => setOrders(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Target sales (৳)</Label>
            <Input
              type="number"
              min="0"
              placeholder="e.g. 500000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {scope === "USER" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={confidential}
                onCheckedChange={(v) => setConfidential(!!v)}
              />
              Confidential — visible only to Admin and this person (for TL targets)
            </label>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save target"}
          </Button>
        </div>

        {/* Current targets */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales value</TableHead>
                <TableHead>Confidential</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Badge variant="outline">
                      {t.scope === "TEAM" ? "Team" : "Individual"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{t.subjectName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.targetOrders ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.targetAmount != null ? money(t.targetAmount) : "—"}
                  </TableCell>
                  <TableCell>
                    {t.isConfidential ? (
                      <Badge variant="secondary">🔒 Yes</Badge>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadForEdit(t)}
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
              {targets.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No targets set for {monthLabel(monthKey)} yet.
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

// ---------- reward rules (SPEC §10) ----------

interface RuleForm {
  name: string;
  type: RewardRuleTypeValue;
  minAchievementPercent: string;
  rewardAmount: string;
  isActive: boolean;
}
const emptyRule: RuleForm = {
  name: "",
  type: "ACHIEVEMENT",
  minAchievementPercent: "",
  rewardAmount: "",
  isActive: true,
};

function RewardRules({ rules }: { rules: RewardRuleRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyRule);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditingId(null);
    setForm(emptyRule);
    setOpen(true);
  }
  function openEdit(r: RewardRuleRow) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      type: r.type,
      minAchievementPercent:
        r.minAchievementPercent != null ? String(r.minAchievementPercent) : "",
      rewardAmount: String(r.rewardAmount),
      isActive: r.isActive,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Name is required");
    const amount = Number(form.rewardAmount);
    if (!(amount > 0)) return toast.error("Reward amount must be greater than zero");
    if (form.type === "ACHIEVEMENT" && !(Number(form.minAchievementPercent) > 0)) {
      return toast.error("Achievement rules need a minimum % (e.g. 100)");
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      type: form.type,
      minAchievementPercent:
        form.type === "ACHIEVEMENT" ? Number(form.minAchievementPercent) : null,
      rewardAmount: amount,
      isActive: form.isActive,
    };
    const res = await fetch(
      editingId ? `/api/reward-rules/${editingId}` : "/api/reward-rules",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to save rule");
      return;
    }
    toast.success(editingId ? "Rule updated" : "Rule created");
    setOpen(false);
    router.refresh();
  }

  async function remove(r: RewardRuleRow) {
    if (!confirm(`Delete rule “${r.name}”?`)) return;
    const res = await fetch(`/api/reward-rules/${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to delete");
      return;
    }
    toast.success("Rule deleted");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Reward rules</CardTitle>
          <CardDescription>
            e.g. ≥100% of target → ৳3,000; ≥120% → ৳6,000; top seller → ৳X.
          </CardDescription>
        </div>
        <Button onClick={openNew}>+ Add rule</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead className="text-right">Reward</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {REWARD_RULE_TYPE_LABELS[r.type]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.type === "ACHIEVEMENT" && r.minAchievementPercent != null
                      ? `≥ ${r.minAchievementPercent}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(r.rewardAmount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "default" : "outline"}>
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(r)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rules.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No reward rules yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit rule" : "New reward rule"}</DialogTitle>
            <DialogDescription>
              Achievement rules pay when a person hits a % of their target;
              top-seller pays the month&apos;s #1 by sales value.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="e.g. Target hit (100%)"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => set("type", v as RewardRuleTypeValue)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REWARD_RULE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {REWARD_RULE_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.type === "ACHIEVEMENT" && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Min achievement %</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="100"
                    value={form.minAchievementPercent}
                    onChange={(e) => set("minAchievementPercent", e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Reward amount (৳)</Label>
              <Input
                type="number"
                min="0"
                placeholder="3000"
                value={form.rewardAmount}
                onChange={(e) => set("rewardAmount", e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", !!v)}
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- month-close rewards (SPEC §10) ----------

function MonthClose({
  monthKey,
  rewards,
}: {
  monthKey: string;
  rewards: RewardRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function compute() {
    setBusy(true);
    const res = await fetch("/api/rewards/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Failed to compute");
      return;
    }
    const r = await res.json();
    toast.success(
      `Computed: ${r.created} new, ${r.updated} updated, ${r.removed} removed · ${r.pending} pending`
    );
    router.refresh();
  }

  async function act(reward: RewardRow, action: "approve" | "paid" | "reject") {
    if (action === "approve" && !confirm(`Approve ${money(reward.amount)} for ${reward.userName}? This books an expense.`))
      return;
    const res = await fetch(`/api/rewards/${reward.id}`, {
      method: action === "reject" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: action === "reject" ? undefined : JSON.stringify({ action }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Action failed");
      return;
    }
    toast.success(
      action === "approve"
        ? "Approved — expense booked"
        : action === "paid"
          ? "Marked paid"
          : "Rejected"
    );
    router.refresh();
  }

  const pendingTotal = rewards
    .filter((r) => r.status === "PENDING")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">
            Month-close rewards · {monthLabel(monthKey)}
          </CardTitle>
          <CardDescription>
            Compute qualifiers against targets &amp; rules, then approve to book
            each as an expense and add it to the person&apos;s history.
          </CardDescription>
        </div>
        <Button onClick={compute} disabled={busy}>
          {busy ? "Computing…" : "Compute rewards"}
        </Button>
      </CardHeader>
      <CardContent>
        {pendingTotal > 0 && (
          <p className="mb-3 text-sm text-muted-foreground">
            Pending approval total:{" "}
            <span className="font-medium text-foreground">{money(pendingTotal)}</span>
          </p>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rewards.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.userName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.ruleName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.achievementPercent != null ? `${r.achievementPercent}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(r.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "PAID"
                          ? "default"
                          : r.status === "APPROVED"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {REWARD_STATUS_LABELS[r.status]}
                    </Badge>
                    {r.expenseId && (
                      <Link
                        href="/money/expenses"
                        className="ml-2 text-xs underline"
                      >
                        expense
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === "PENDING" && (
                        <>
                          <Button size="sm" onClick={() => act(r, "approve")}>
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => act(r, "reject")}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {r.status === "APPROVED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => act(r, "paid")}
                        >
                          Mark paid
                        </Button>
                      )}
                      {r.status === "PAID" && (
                        <span className="text-xs text-muted-foreground">Done</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rewards.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No rewards computed for {monthLabel(monthKey)} yet.
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
