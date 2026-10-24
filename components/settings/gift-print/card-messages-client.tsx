"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
import type { CardMessageRow } from "@/lib/card-library";
import {
  CARD_LANGUAGES,
  CARD_LANGUAGE_LABELS,
  hasNameSlots,
  type CardLanguageValue,
} from "@/lib/print-constants";
import { CARD_TEXT_MAX, cardLines } from "@/lib/print-card-text";

// PHOTO_PRINT.md PP-3 — the message library: occasion, language, text with
// optional {to} / {from} name slots, active/inactive. Messages are never
// deleted — deactivate one to hide it from the order form.

const ALL = "__all";

export function CardMessagesClient({ messages }: { messages: CardMessageRow[] }) {
  const router = useRouter();
  const [occasion, setOccasion] = useState(ALL);
  const [language, setLanguage] = useState(ALL);
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<CardMessageRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    occasion: "",
    language: "BN" as CardLanguageValue,
    text: "",
    isActive: true,
  });

  const occasions = useMemo(
    () => [...new Set(messages.map((m) => m.occasion))],
    [messages]
  );
  const shown = messages.filter(
    (m) =>
      (occasion === ALL || m.occasion === occasion) &&
      (language === ALL || m.language === language) &&
      (showInactive || m.isActive)
  );

  function openNew() {
    setEditing(null);
    setForm({
      occasion: occasion === ALL ? "" : occasion,
      language: "BN",
      text: "",
      isActive: true,
    });
    setOpen(true);
  }

  function openEdit(m: CardMessageRow) {
    setEditing(m);
    setForm({ occasion: m.occasion, language: m.language, text: m.text, isActive: m.isActive });
    setOpen(true);
  }

  async function submit(body: typeof form, target: CardMessageRow | null) {
    const res = await fetch(
      target ? `/api/print/card-messages/${target.id}` : "/api/print/card-messages",
      {
        method: target ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
  }

  async function save() {
    setBusy(true);
    try {
      await submit(form, editing);
      toast.success(editing ? "Message updated" : "Message added");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(m: CardMessageRow, isActive: boolean) {
    try {
      await submit(
        { occasion: m.occasion, language: m.language, text: m.text, isActive },
        m
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  const slots = hasNameSlots(form.text);
  const withNames = cardLines(form.text, { to: "নুসরাত", from: "Rifat" });
  const withoutNames = cardLines(form.text);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label className="text-xs">Occasion</Label>
          <Select value={occasion} onValueChange={setOccasion}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All occasions</SelectItem>
              {occasions.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Language</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All languages</SelectItem>
              {CARD_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {CARD_LANGUAGE_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
        <Button className="ml-auto" onClick={openNew}>
          Add message
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {shown.length} of {messages.length} messages. Use <code>{"{to}"}</code> and{" "}
        <code>{"{from}"}</code> for the names; when the SE leaves a name empty, its greeting or
        signature line is left out.
      </p>

      <div className="space-y-2">
        {shown.map((m) => (
          <Card key={m.id} className={m.isActive ? "" : "opacity-60"}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{m.occasion}</Badge>
                  <Badge variant="outline">{CARD_LANGUAGE_LABELS[m.language]}</Badge>
                  {m.hasNameSlots ? (
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      Names
                    </Badge>
                  ) : (
                    <Badge variant="outline">Common</Badge>
                  )}
                  {!m.isActive && <Badge variant="outline">Inactive</Badge>}
                </div>
                <p className="whitespace-pre-line break-words text-sm leading-relaxed">{m.text}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={m.isActive}
                    onCheckedChange={(v) => toggleActive(m, v)}
                    aria-label="Active"
                  />
                  Active
                </label>
                <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages match.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit message" : "Add message"}</DialogTitle>
            <DialogDescription>
              Bangla, English or mixed. <code>{"{to}"}</code> = যাকে দেবেন,{" "}
              <code>{"{from}"}</code> = যে দিচ্ছেন — both optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="occasion">Occasion</Label>
                <Input
                  id="occasion"
                  list="card-occasions"
                  placeholder="জন্মদিন / Birthday"
                  value={form.occasion}
                  onChange={(e) => setForm({ ...form, occasion: e.target.value })}
                />
                <datalist id="card-occasions">
                  {occasions.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1">
                <Label>Language</Label>
                <Select
                  value={form.language}
                  onValueChange={(v) => setForm({ ...form, language: v as CardLanguageValue })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARD_LANGUAGES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {CARD_LANGUAGE_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="text">Message</Label>
                <span className="text-xs text-muted-foreground">
                  {form.text.length}/{CARD_TEXT_MAX}
                </span>
              </div>
              <Textarea
                id="text"
                rows={5}
                maxLength={CARD_TEXT_MAX}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                placeholder="প্রিয় {to}, শুভ জন্মদিন! … — {from}"
              />
            </div>
            {form.text.trim() && (
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {slots ? "With names (sample)" : "On the card"}
                  </p>
                  <div className="space-y-0.5 text-center">
                    {withNames.map((l, i) => (
                      <p key={i}>{l}</p>
                    ))}
                  </div>
                </div>
                {slots && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Names left empty
                    </p>
                    <div className="space-y-0.5 text-center">
                      {withoutNames.map((l, i) => (
                        <p key={i}>{l}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
              Active (shown on the order form)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !form.occasion.trim() || !form.text.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
