"use client";

// CORRECTIONS §R9 — the Business / Invoice settings form: logo upload (PNG/
// JPEG, embedded by pdfkit), business name/tagline, address, phone(s),
// optional email + social handle, and the two footer lines. Saved values reach
// the very next generated invoice; blanking an optional field simply drops
// that line from the print.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_INVOICE_BRANDING,
  brandingContactLine,
  type InvoiceBranding,
} from "@/lib/invoice-branding-constants";

export function InvoiceBrandingClient({ initial }: { initial: InvoiceBranding }) {
  const router = useRouter();
  const [b, setB] = useState<InvoiceBranding>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof InvoiceBranding>(key: K, value: InvoiceBranding[K]) =>
    setB((prev) => ({ ...prev, [key]: value }));

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/settings/invoice-branding/logo", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      set("logoUrl", body.url);
      toast.success("Logo uploaded — remember to Save");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/invoice-branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setB(body);
      toast.success("Invoice settings saved — applies to new invoices");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Business / Invoice settings</h1>
        <p className="text-sm text-muted-foreground">
          The letterhead and footer printed on every invoice (single and bulk
          print). Changes apply to newly generated invoices immediately; already
          generated PDF versions keep their original look.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
          <CardDescription>
            PNG or JPEG, up to 2MB — a wide wordmark works best (it prints about
            22×10&nbsp;mm on the invoice). Without one, a &ldquo;GV&rdquo;
            placeholder box prints instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          {b.logoUrl ? (
            /* uploaded file with unknown dimensions — plain img is right here */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={b.logoUrl}
              alt="Invoice logo"
              className="h-12 w-auto max-w-48 rounded border bg-white object-contain p-1"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded border-2 border-primary text-sm font-bold text-primary">
              GV
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              className="w-64"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
                e.target.value = "";
              }}
            />
            {b.logoUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("logoUrl", null)}
              >
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Letterhead</CardTitle>
          <CardDescription>
            Printed at the top of the invoice, next to the logo. On paper the
            contact details condense to one line:{" "}
            <span className="text-foreground">
              {brandingContactLine(b) || "—"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="biz-name">Business name</Label>
            <Input
              id="biz-name"
              value={b.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.businessName}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-tagline">Tagline</Label>
            <Input
              id="biz-tagline"
              value={b.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.tagline}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-phones">Phone number(s)</Label>
            <Input
              id="biz-phones"
              value={b.phones}
              onChange={(e) => set("phones", e.target.value)}
              placeholder="WhatsApp: +880 17XX-XXXXXX, Hotline: 096XX-XXXXXX"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-address">Business address</Label>
            <Input
              id="biz-address"
              value={b.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.address}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-email">Email (optional)</Label>
            <Input
              id="biz-email"
              value={b.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="hello@giftvaly.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-social">Social handle (optional)</Label>
            <Input
              id="biz-social"
              value={b.social}
              onChange={(e) => set("social", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.social}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Footer</CardTitle>
          <CardDescription>
            Two lines at the bottom of the invoice: the terms strip (kept to one
            printed line) and the closing brand line after the business name.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="biz-footer">Invoice footer text (terms)</Label>
            <Textarea
              id="biz-footer"
              rows={3}
              value={b.footerText}
              onChange={(e) => set("footerText", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.footerText}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-thanks">Closing line</Label>
            <Input
              id="biz-thanks"
              value={b.thankYouLine}
              onChange={(e) => set("thankYouLine", e.target.value)}
              placeholder={DEFAULT_INVOICE_BRANDING.thankYouLine}
            />
            <p className="text-xs text-muted-foreground">
              Prints as &ldquo;{b.businessName || "Business"} —{" "}
              {b.thankYouLine || "…"}&rdquo;
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || uploading}>
          {saving ? "Saving…" : "Save invoice settings"}
        </Button>
      </div>
    </div>
  );
}
