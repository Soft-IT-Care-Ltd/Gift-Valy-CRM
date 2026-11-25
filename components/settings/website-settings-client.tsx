"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import type { MetaEventRow, MetaSettingsView } from "@/lib/meta/settings";
import { settingsErrors, websiteSettingsSchema, type WebsiteSettingsForm } from "@/lib/storefront/settings-form";
import { ORDER_MESSAGE_PLACEHOLDERS, POLICY_KINDS, POLICY_TITLES, PRODUCT_MESSAGE_PLACEHOLDERS } from "@/lib/storefront/settings-shape";

// ROUND3 W-7 / W-8 — Settings → Website (Admin). One Save for the website's
// settings (checked here and again on the server with the same schema,
// lib/storefront/settings-form.ts; the website shows the change on the very
// next page load), and the Meta Pixel card with its own Save — the token is
// typed once and never shown again.

type Errors = Record<string, string>;

const ZONES = [
  { key: "insideDhaka", label: "Inside Dhaka" },
  { key: "subDhaka", label: "Dhaka sub-area" },
  { key: "outsideDhaka", label: "Outside Dhaka" },
] as const;

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1" data-invalid={error ? "true" : undefined}>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SwitchRow({ title, hint, checked, onChange, disabled }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function WebsiteSettingsClient({
  initial,
  meta,
  events,
  websiteUrl,
}: {
  initial: WebsiteSettingsForm;
  meta: MetaSettingsView;
  events: MetaEventRow[];
  websiteUrl: string | null;
}) {
  const router = useRouter();
  const [f, setF] = useState<WebsiteSettingsForm>(initial);
  const [saved, setSaved] = useState<WebsiteSettingsForm>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);

  const set = <K extends keyof WebsiteSettingsForm>(key: K, value: WebsiteSettingsForm[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const err = (key: string) => errors[key];

  async function save() {
    const checked = websiteSettingsSchema.safeParse(f);
    if (!checked.success) {
      setErrors(settingsErrors(checked.error));
      toast.error("Please fix the marked fields");
      requestAnimationFrame(() => document.querySelector("[data-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/website", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.fields) setErrors(body.fields as Errors);
        throw new Error(body.error ?? "Could not save");
      }
      setErrors({});
      setF(body as WebsiteSettingsForm);
      setSaved(body as WebsiteSettingsForm);
      toast.success("Saved — the website shows it on the next page load");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website</h1>
          <p className="text-sm text-muted-foreground">
            What the Gift Valy website shows and how it takes orders. Every save shows on the website on the very next page load. Products,
            packages and categories are put on the website from their own Website panel in the Catalog; the home page from Catalog → Website Home
            Page.
          </p>
        </div>
        {websiteUrl ? (
          <Button variant="outline" asChild>
            <a href={websiteUrl} target="_blank" rel="noopener">
              Open the website <ExternalLink className="ml-1 size-4" />
            </a>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Website {f.websiteOn ? <Badge variant="secondary">On</Badge> : <Badge variant="destructive">Off — Coming soon page</Badge>}
          </CardTitle>
          <CardDescription>
            Off: every page of the website shows one &ldquo;Coming soon&rdquo; page with your WhatsApp, Messenger, Facebook and phone — no
            catalogue, no checkout, nothing for Google. Customers who already ordered can still open their order link. The ERP is never affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchRow title="Website on" hint="Switch off to close the website for a while." checked={f.websiteOn} onChange={(v) => set("websiteOn", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
          <CardDescription>Shown in the website&apos;s footer and on the buttons. Leave WhatsApp or Messenger empty and its button disappears.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="ws-whatsapp" label="WhatsApp number" hint="Any way you like — saved as 8801XXXXXXXXX" error={err("whatsapp")}>
            <Input id="ws-whatsapp" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="01711-223344" inputMode="tel" />
          </Field>
          <Field id="ws-messenger" label="Messenger (Facebook Page)" hint="The Page's username or its m.me link" error={err("messengerPage")}>
            <Input id="ws-messenger" value={f.messengerPage} onChange={(e) => set("messengerPage", e.target.value)} placeholder="giftvaly" />
          </Field>
          <Field id="ws-hotline" label="Contact phone" hint="Shown as typed, e.g. +880 1711-223344" error={err("hotline")}>
            <Input id="ws-hotline" value={f.hotline} onChange={(e) => set("hotline", e.target.value)} />
          </Field>
          <Field id="ws-facebook" label="Facebook page link" error={err("facebookUrl")}>
            <Input id="ws-facebook" value={f.facebookUrl} onChange={(e) => set("facebookUrl", e.target.value)} placeholder="https://facebook.com/giftvaly" />
          </Field>
          <div className="sm:col-span-2">
            <Field id="ws-address" label="Office address" error={err("officeAddress")}>
              <Textarea id="ws-address" rows={2} value={f.officeAddress} onChange={(e) => set("officeAddress", e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery times</CardTitle>
          <CardDescription>Shown next to each zone&apos;s charge on every product page. The charges themselves stay on each product and package.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {ZONES.map((z) => (
            <Field key={z.key} id={`ws-time-${z.key}`} label={z.label} error={err(`deliveryTimes.${z.key}`)}>
              <Input
                id={`ws-time-${z.key}`}
                value={f.deliveryTimes[z.key]}
                onChange={(e) => set("deliveryTimes", { ...f.deliveryTimes, [z.key]: e.target.value })}
                placeholder="e.g. 1–2 days"
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">WhatsApp / Messenger messages</CardTitle>
          <CardDescription>The message the customer&apos;s phone fills in when they tap Order on WhatsApp / Messenger. A line whose placeholder is empty is left out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="ws-product-message"
            label="On a product or package page"
            hint={`Placeholders: ${PRODUCT_MESSAGE_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}`}
            error={err("productMessage")}
          >
            <Textarea id="ws-product-message" rows={5} value={f.productMessage} onChange={(e) => set("productMessage", e.target.value)} />
          </Field>
          <Field
            id="ws-order-message"
            label="On the order confirmation page"
            hint={`Placeholders: ${ORDER_MESSAGE_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}`}
            error={err("orderMessage")}
          >
            <Textarea id="ws-order-message" rows={3} value={f.orderMessage} onChange={(e) => set("orderMessage", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policies</CardTitle>
          <CardDescription>
            Each policy gets its own page and a footer link once its text is filled in. Plain text; empty lines separate paragraphs. A text still
            holding [[…]] can&apos;t be saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {POLICY_KINDS.map((k) => (
            <Field key={k} id={`ws-policy-${k}`} label={POLICY_TITLES[k]} error={err(`policies.${k}`)} hint={f.policies[k] ? `Live at /policy/${k}` : "Empty — no page"}>
              <Textarea id={`ws-policy-${k}`} rows={6} value={f.policies[k]} onChange={(e) => set("policies", { ...f.policies, [k]: e.target.value })} />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Website orders</CardTitle>
          <CardDescription>
            Limits stop one person or one network from flooding the shop with orders (the next one is refused for an hour). Customers abroad often
            share Wi-Fi, so the network limit is higher.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ws-limit-phone" label="Orders per WhatsApp number, per hour" error={err("orderLimits.phonePerHour")}>
              <Input
                id="ws-limit-phone"
                type="number"
                min={1}
                max={50}
                value={f.orderLimits.phonePerHour}
                onChange={(e) => set("orderLimits", { ...f.orderLimits, phonePerHour: e.target.value as unknown as number })}
              />
            </Field>
            <Field id="ws-limit-ip" label="Orders per network (IP), per hour" error={err("orderLimits.ipPerHour")}>
              <Input
                id="ws-limit-ip"
                type="number"
                min={1}
                max={1000}
                value={f.orderLimits.ipPerHour}
                onChange={(e) => set("orderLimits", { ...f.orderLimits, ipPerHour: e.target.value as unknown as number })}
              />
            </Field>
          </div>
          <SwitchRow
            title="Count website orders for targets"
            hint="On: a confirmed website order counts for its Sales Executive's target, the leaderboard and rewards. Off by default."
            checked={f.countForTargets}
            onChange={(v) => set("countForTargets", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Display &amp; search engines</CardTitle>
          <CardDescription>The home page&apos;s title and description for Google and for link previews on Facebook and WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow
            title="Approx. price in the visitor's currency"
            hint="Shows “≈ SAR 120 (approx.)” under the taka price, from Settings → Currency Rates."
            checked={f.approxCurrency}
            onChange={(v) => set("approxCurrency", v)}
          />
          <Field id="ws-seo-title" label="Home page title" hint="Empty = “Gift Valy — gifts delivered anywhere in Bangladesh”" error={err("homeSeo.title")}>
            <Input id="ws-seo-title" value={f.homeSeo.title} maxLength={70} onChange={(e) => set("homeSeo", { ...f.homeSeo, title: e.target.value })} />
          </Field>
          <Field id="ws-seo-desc" label="Home page description" hint="Empty = the shop's tagline. About 155 characters show in Google." error={err("homeSeo.description")}>
            <Textarea id="ws-seo-desc" rows={2} maxLength={200} value={f.homeSeo.description} onChange={(e) => set("homeSeo", { ...f.homeSeo, description: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-2 flex items-center justify-end gap-3 border-t bg-background/95 px-2 py-3 backdrop-blur">
        {dirty ? <span className="text-sm text-muted-foreground">Unsaved changes</span> : null}
        <Button
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => {
            setF(saved);
            setErrors({});
          }}
        >
          Undo
        </Button>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save website settings"}
        </Button>
      </div>

      <MetaCard initial={meta} events={events} />
    </div>
  );
}

// ---------- W-8 — Meta Pixel + Conversions API ----------

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = { SENT: "secondary", PENDING: "outline", SKIPPED: "outline", FAILED: "destructive" };

function MetaCard({ initial, events }: { initial: MetaSettingsView; events: MetaEventRow[] }) {
  const router = useRouter();
  const [m, setM] = useState(initial);
  const [pixelId, setPixelId] = useState(initial.pixelId);
  const [token, setToken] = useState("");
  const [testCode, setTestCode] = useState(initial.testEventCode);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save(patch: { isEnabled?: boolean; clearToken?: boolean } = {}) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/website/meta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId, testEventCode: testCode, accessToken: token || undefined, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setM(body as MetaSettingsView);
      setToken("");
      toast.success("Meta settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/website/meta/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Meta refused the test event");
      toast.success("Test event received by Meta — check the Test Events tab");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Meta refused the test event");
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  const ready = !!m.pixelId && m.hasToken;
  return (
    <>
      <Card id="meta">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Meta Pixel &amp; Conversions API
            {m.isEnabled ? <Badge variant="secondary">Tracking on</Badge> : <Badge variant="outline">Off</Badge>}
          </CardTitle>
          <CardDescription>
            Sends PageView, ViewContent, AddToCart, InitiateCheckout, Lead (an order placed on the website) and Purchase (when the Sales Executive
            confirms it) to Meta, from the browser and from the server with one event id. Values come from the database; the customer&apos;s phone and
            name go only as SHA-256 hashes, and never the recipient or the address. Nothing loads or is sent while this is off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="meta-pixel" label="Pixel ID" hint="Events Manager → Data sources → your pixel (digits only)">
              <Input id="meta-pixel" value={pixelId} onChange={(e) => setPixelId(e.target.value)} inputMode="numeric" placeholder="123456789012345" />
            </Field>
            <Field
              id="meta-token"
              label="Conversions API token"
              hint={m.hasToken ? `Saved (${m.tokenMasked}) — type a new one to replace it` : "Events Manager → Settings → Generate access token. Stored encrypted, never shown again."}
            >
              <Input id="meta-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={m.hasToken ? (m.tokenMasked ?? "") : "EAAG…"} />
            </Field>
            <Field id="meta-test" label="Test event code (optional)" hint="From Events Manager → Test events. While set, events show there instead of in real reporting.">
              <Input id="meta-test" value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="TEST12345" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()} disabled={busy}>
              Save Meta settings
            </Button>
            <Button variant="outline" onClick={sendTest} disabled={testing || !ready || !m.testEventCode}>
              {testing ? "Sending…" : "Send test event"}
            </Button>
            {m.hasToken ? (
              <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => save({ clearToken: true, isEnabled: false })}>
                Remove token
              </Button>
            ) : null}
          </div>
          <SwitchRow
            title="Tracking on"
            hint={
              !ready
                ? "Save the Pixel ID and the token first."
                : !m.privacyLive
                  ? "Put the privacy policy on the website first (Policies above) — the pixel sets a cookie."
                  : "The website loads the pixel and sends events."
            }
            checked={m.isEnabled}
            onChange={(v) => save({ isEnabled: v })}
            disabled={busy || (!m.isEnabled && (!ready || !m.privacyLive))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meta event log</CardTitle>
          <CardDescription>The latest 30 events sent through the Conversions API (already hashed) and Meta&apos;s answer. Failed sends are retried for about 4 hours.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Meta&apos;s answer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.eventName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{e.eventId}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{e.status.toLowerCase()}</Badge>
                      {e.testEventCode ? <div className="text-xs text-muted-foreground">test</div> : null}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(e.sentAt ?? e.createdAt)}</TableCell>
                    <TableCell className="max-w-xs text-xs break-words text-muted-foreground">
                      {e.error ?? (e.response && typeof e.response === "object" && "events_received" in e.response ? `Received (${String((e.response as { events_received: unknown }).events_received)})` : "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
