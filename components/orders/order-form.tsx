"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoField } from "@/components/catalog/photo-field";
import { money } from "@/lib/format";
import {
  CUSTOMER_COUNTRIES,
  DELIVERY_DATE_MODES,
  DELIVERY_DATE_MODE_LABELS,
  DELIVERY_ZONES,
  DELIVERY_ZONE_LABELS,
  MFS_METHODS,
  OCCASIONS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  RECIPIENT_RELATIONS,
  type DeliveryDateModeValue,
  type DeliveryZoneValue,
  type OrderStatusValue,
  type PaymentMethodValue,
} from "@/lib/order-constants";
import { WALLET_TYPE_LABELS, type WalletOption } from "@/lib/wallet";

// ---- option shapes (page passes catalog without any cost fields) ----

export interface ZoneCharges {
  INSIDE_DHAKA: number;
  SUB_DHAKA: number;
  OUTSIDE_DHAKA: number;
}

export interface ProductOption {
  id: number;
  sku: string;
  name: string;
  sellingPrice: number;
  priceFloor: number;
  unit: string;
  zoneCharges: ZoneCharges;
}

// CORRECTIONS Products §5 — the choice groups of a package's whole nested
// tree; the SE picks one option per group when the package is added.
export interface ChoiceGroupOption {
  groupId: number;
  label: string;
  path: string[];
  options: {
    productId: number;
    name: string;
    isDefault: boolean;
    stockQty: number;
  }[];
}

export interface PackageOption {
  id: number;
  code: string;
  name: string;
  sellingPrice: number;
  priceFloor: number;
  availableToSell: number | null;
  zoneCharges: ZoneCharges;
  choiceGroups: ChoiceGroupOption[];
}

interface LineState {
  key: number;
  itemType: "PRODUCT" | "PACKAGE";
  itemId: string; // product or package id as string for Select
  qty: string;
  unitPrice: string;
  // groupId → productId (as strings for Select) — package lines only.
  selections: Record<string, string>;
}

export interface OrderFormInitial {
  recipientName: string;
  recipientPhoneBd: string;
  recipientRelation: string | null;
  deliveryAddress: string;
  deliveryZone: string | null;
  occasion: string | null;
  // CORRECTIONS Orders §7 (form part) — from the customer↔recipient profile.
  recipientBirthday: string | null;
  recipientAnniversary: string | null;
  // CORRECTIONS Orders §1 — ASAP / Any day / Fixed date.
  deliveryDateMode: DeliveryDateModeValue;
  requestedDeliveryDate: string | null;
  items: {
    itemType: "PRODUCT" | "PACKAGE";
    productId: number | null;
    packageId: number | null;
    qty: number;
    unitPrice: number;
    choiceSelections?: { groupId: number; productId: number }[] | null;
  }[];
  discount: number;
  courierCharge: number;
  codAmount: number;
  // 3-note system (CORRECTIONS Orders §6d).
  notes: string | null;
  invoiceNote: string | null;
  courierNote: string | null;
  customer: { name: string; phoneForeign: string; country: string };
  orderNo?: string;
  status?: OrderStatusValue;
}

interface FoundCustomer {
  id: number;
  name: string;
  phoneForeign: string;
  country: string;
  fbLink: string | null;
  orderCount: number;
  recentOrders: {
    id: number;
    orderNo: string;
    date: string;
    totalAmount: number;
    status: OrderStatusValue;
    recipientName: string;
  }[];
}

// ADVANCE methods offered on the entry form (§4.1 D) — courier COD is a
// post-delivery collection type, not an advance method.
const ADVANCE_METHODS: PaymentMethodValue[] = [
  "BKASH",
  "NAGAD",
  "ROCKET",
  "BANK",
  "CASH",
  "OTHER",
];

let lineKey = 1;

export function OrderForm({
  mode,
  orderId,
  products,
  packages,
  canOverrideFloor,
  seName,
  teamName,
  initial,
  wallets = [],
  leadId,
  leadLabel,
}: {
  mode: "create" | "edit" | "edit-request";
  orderId?: number;
  products: ProductOption[];
  packages: PackageOption[];
  canOverrideFloor: boolean;
  seName: string;
  teamName: string | null;
  initial?: OrderFormInitial;
  wallets?: WalletOption[]; // active receiving wallets (create mode, §8)
  leadId?: number; // set when converting a lead → order (§3.2)
  leadLabel?: string; // human label for the banner (e.g. "Rahim · WhatsApp")
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Section A — customer
  const [customerPhone, setCustomerPhone] = useState(
    initial?.customer.phoneForeign ?? ""
  );
  const [customerName, setCustomerName] = useState(initial?.customer.name ?? "");
  const [country, setCountry] = useState(initial?.customer.country ?? "");
  const [fbLink, setFbLink] = useState("");
  const [foundCustomer, setFoundCustomer] = useState<FoundCustomer | null>(null);
  const lookupSeq = useRef(0);

  // Section B — recipient. District/Thana removed (CORRECTIONS Orders §5) —
  // the full address is all Steadfast needs.
  const [recipientName, setRecipientName] = useState(initial?.recipientName ?? "");
  const [recipientPhoneBd, setRecipientPhoneBd] = useState(
    initial?.recipientPhoneBd ?? ""
  );
  const [relation, setRelation] = useState(initial?.recipientRelation ?? "");
  const [address, setAddress] = useState(initial?.deliveryAddress ?? "");
  const [occasion, setOccasion] = useState(initial?.occasion ?? "");
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZoneValue | "">(
    (initial?.deliveryZone as DeliveryZoneValue | null) ?? ""
  );
  // CORRECTIONS Orders §1 — ASAP / Any day / Fixed date selector.
  const [deliveryDateMode, setDeliveryDateMode] = useState<DeliveryDateModeValue>(
    initial?.deliveryDateMode ?? "ANY_DAY"
  );
  const [deliveryDate, setDeliveryDate] = useState(
    initial?.requestedDeliveryDate ?? ""
  );
  // CORRECTIONS Orders §7 — optional recipient occasion dates → customer profile.
  const [recipientBirthday, setRecipientBirthday] = useState(
    initial?.recipientBirthday ?? ""
  );
  const [recipientAnniversary, setRecipientAnniversary] = useState(
    initial?.recipientAnniversary ?? ""
  );

  // Section C — items. Choice picks (§5) prefill from the saved order (edit)
  // or the group defaults.
  const defaultSelections = useCallback(
    (packageId: number | null): Record<string, string> => {
      const pkg = packages.find((p) => p.id === packageId);
      if (!pkg) return {};
      return Object.fromEntries(
        pkg.choiceGroups.map((g) => [
          String(g.groupId),
          String(
            (g.options.find((o) => o.isDefault) ?? g.options[0])?.productId ?? ""
          ),
        ])
      );
    },
    [packages]
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    initial
      ? initial.items.map((it) => ({
          key: lineKey++,
          itemType: it.itemType,
          itemId: String(it.itemType === "PRODUCT" ? it.productId : it.packageId),
          qty: String(it.qty),
          unitPrice: String(it.unitPrice),
          selections: {
            ...defaultSelections(it.packageId),
            ...Object.fromEntries(
              (it.choiceSelections ?? []).map((s) => [
                String(s.groupId),
                String(s.productId),
              ])
            ),
          },
        }))
      : [
          {
            key: lineKey++,
            itemType: "PACKAGE",
            itemId: "",
            qty: "1",
            unitPrice: "",
            selections: {},
          },
        ]
  );
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountValue, setDiscountValue] = useState(
    initial ? String(initial.discount) : "0"
  );
  const [courierCharge, setCourierCharge] = useState(
    initial ? String(initial.courierCharge) : "0"
  );

  // Section D — advance (create only)
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const [method, setMethod] = useState<PaymentMethodValue | "">("");
  const [advanceWalletId, setAdvanceWalletId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [codAmount, setCodAmount] = useState(
    initial ? String(initial.codAmount) : ""
  );
  const [zeroAdvanceReason, setZeroAdvanceReason] = useState("");

  // Section E — meta. 3-note system (CORRECTIONS Orders §6d): Order Note
  // (internal) / Invoice Note (printed) / Courier Note (sent to Steadfast).
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [invoiceNote, setInvoiceNote] = useState(initial?.invoiceNote ?? "");
  const [courierNote, setCourierNote] = useState(initial?.courierNote ?? "");
  const [noteTab, setNoteTab] = useState<"order" | "invoice" | "courier">("order");
  const [editReason, setEditReason] = useState("");

  const productById = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  );
  const packageById = useMemo(
    () => new Map(packages.map((p) => [String(p.id), p])),
    [packages]
  );

  // ---- repeat-customer lookup (§4.1 A) ----
  const lookupCustomer = useCallback(async (phone: string) => {
    const seq = ++lookupSeq.current;
    if (phone.replace(/\D/g, "").length < 6) {
      setFoundCustomer(null);
      return;
    }
    const res = await fetch(
      `/api/customers/search?phone=${encodeURIComponent(phone)}`
    );
    if (!res.ok || seq !== lookupSeq.current) return;
    const data = await res.json();
    if (data.customer) {
      setFoundCustomer(data.customer);
      setCustomerName(data.customer.name);
      setCountry(data.customer.country);
      setFbLink(data.customer.fbLink ?? "");
      toast.info(
        `Repeat customer — ${data.customer.orderCount} previous order${data.customer.orderCount === 1 ? "" : "s"}`
      );
    } else {
      setFoundCustomer(null);
    }
  }, []);

  // ---- line helpers ----
  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // CORRECTIONS Products §3 — Σ(qty × item's charge for the zone). 0 when no
  // zone picked or nothing carries a zone charge (free delivery default).
  const zoneChargeFor = useCallback(
    (zone: DeliveryZoneValue | "", ls: LineState[]): number => {
      if (!zone) return 0;
      return ls.reduce((sum, l) => {
        const opt =
          l.itemType === "PRODUCT"
            ? productById.get(l.itemId)
            : packageById.get(l.itemId);
        if (!opt) return sum;
        return sum + (Number(l.qty) || 0) * opt.zoneCharges[zone];
      }, 0);
    },
    [productById, packageById]
  );

  // Auto-fill the delivery charge on zone/item events (stays editable).
  function autofillCharge(zone: DeliveryZoneValue | "", ls: LineState[]) {
    if (!zone) return;
    const sum = zoneChargeFor(zone, ls);
    if (sum > 0) setCourierCharge(String(sum));
  }

  function selectItem(line: LineState, itemId: string) {
    const opt =
      line.itemType === "PRODUCT"
        ? productById.get(itemId)
        : packageById.get(itemId);
    const nextLines = lines.map((l) =>
      l.key === line.key
        ? {
            ...l,
            itemId,
            unitPrice: opt ? String(opt.sellingPrice) : l.unitPrice,
            selections:
              line.itemType === "PACKAGE"
                ? defaultSelections(Number(itemId))
                : {},
          }
        : l
    );
    setLines(nextLines);
    autofillCharge(deliveryZone, nextLines);
  }
  function lineFloor(line: LineState): number | null {
    const opt =
      line.itemType === "PRODUCT"
        ? productById.get(line.itemId)
        : packageById.get(line.itemId);
    return opt ? opt.priceFloor : null;
  }

  // ---- totals (mirror of server math; server recomputes authoritatively) ----
  const subtotal = lines.reduce((s, l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    return s + qty * price;
  }, 0);
  const discountAmount =
    discountType === "PERCENT"
      ? Math.round(((subtotal * (Number(discountValue) || 0)) / 100) * 100) / 100
      : Number(discountValue) || 0;
  const total = subtotal - discountAmount + (Number(courierCharge) || 0);
  const advance = Number(advanceAmount) || 0;
  const due = mode === "create" ? total - advance : total;
  const floorBreaches = lines.filter((l) => {
    const floor = lineFloor(l);
    return floor != null && l.itemId && Number(l.unitPrice) < floor;
  });
  const mfsNeedsTxn =
    mode === "create" &&
    advance > 0 &&
    !!method &&
    MFS_METHODS.includes(method) &&
    !transactionId.trim();

  const disableSubmit =
    saving ||
    !recipientName.trim() ||
    !recipientPhoneBd.trim() ||
    !address.trim() ||
    (deliveryDateMode === "FIXED" && !deliveryDate) ||
    lines.some((l) => !l.itemId || !(Number(l.qty) > 0)) ||
    lines.length === 0 ||
    (floorBreaches.length > 0 && !canOverrideFloor) ||
    (mode === "create" &&
      (!customerName.trim() || !customerPhone.trim() || !country)) ||
    (mode === "create" && advance > 0 && !method) ||
    (mode === "create" && advance > 0 && !advanceWalletId) ||
    mfsNeedsTxn ||
    (mode === "edit-request" && editReason.trim().length < 3);

  async function submit(saveAsDraft = false) {
    setSaving(true);
    const orderPayload = {
      recipientName,
      recipientPhoneBd,
      recipientRelation: relation || null,
      deliveryAddress: address,
      deliveryZone: deliveryZone || null,
      occasion: occasion || null,
      recipientBirthday: recipientBirthday || null,
      recipientAnniversary: recipientAnniversary || null,
      deliveryDateMode,
      requestedDeliveryDate:
        deliveryDateMode === "FIXED" ? deliveryDate || null : null,
      items: lines.map((l) => ({
        itemType: l.itemType,
        productId: l.itemType === "PRODUCT" ? Number(l.itemId) : null,
        packageId: l.itemType === "PACKAGE" ? Number(l.itemId) : null,
        qty: Number(l.qty),
        unitPrice: Number(l.unitPrice) || 0,
        choiceSelections:
          l.itemType === "PACKAGE" && Object.keys(l.selections).length > 0
            ? Object.fromEntries(
                Object.entries(l.selections)
                  .filter(([, v]) => v !== "")
                  .map(([k, v]) => [k, Number(v)])
              )
            : null,
      })),
      discountType,
      discountValue: Number(discountValue) || 0,
      courierCharge: Number(courierCharge) || 0,
      codAmount: codAmount === "" ? null : Number(codAmount),
      notes: notes || null,
      invoiceNote: invoiceNote || null,
      courierNote: courierNote || null,
    };

    let res: Response;
    if (mode === "create") {
      res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: customerName,
            phoneForeign: customerPhone,
            country,
            fbLink: fbLink || null,
          },
          order: orderPayload,
          advance: saveAsDraft
            ? { amount: 0 }
            : {
                amount: advance,
                method: method || undefined,
                walletId: advanceWalletId ? Number(advanceWalletId) : null,
                transactionId: transactionId || null,
                senderNumber: senderNumber || null,
                screenshotUrl: screenshotUrl || null,
              },
          zeroAdvanceReason: zeroAdvanceReason || undefined,
          leadId: leadId ?? undefined,
          saveAsDraft,
        }),
      });
    } else if (mode === "edit") {
      res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
    } else {
      res = await fetch(`/api/orders/${orderId}/edit-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: orderPayload, reason: editReason }),
      });
    }
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save order");
      return;
    }
    if (mode === "create") {
      const data = await res.json();
      toast.success(
        saveAsDraft
          ? `Draft ${data.orderNo} saved — confirm it by recording the advance`
          : `Order ${data.orderNo} created`
      );
      router.push(`/orders/${data.id}`);
    } else if (mode === "edit") {
      toast.success("Order updated");
      router.push(`/orders/${orderId}`);
      router.refresh();
    } else {
      toast.success("Edit request submitted for TL/Manager approval");
      router.push(`/orders/${orderId}`);
      router.refresh();
    }
  }

  const heading =
    mode === "create"
      ? "New order"
      : mode === "edit"
        ? `Edit order ${initial?.orderNo ?? ""}`
        : `Request changes to ${initial?.orderNo ?? ""}`;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{heading}</h1>
        {mode !== "create" && initial?.status && (
          <Badge variant="secondary">{ORDER_STATUS_LABELS[initial.status]}</Badge>
        )}
      </div>

      {mode === "create" && leadId && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
          Converting lead{leadLabel ? ` — ${leadLabel}` : ""}. Creating this order
          will mark the lead <span className="font-medium">Converted</span> and
          link it here.
        </div>
      )}

      {/* Section A — Customer (the probashi payer) */}
      <Card>
        <CardHeader>
          <CardTitle>A · Customer</CardTitle>
          <CardDescription>
            The payer abroad — phone number 1 of 2. Repeat customers auto-fill
            by phone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {mode === "create" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Customer phone (foreign/WhatsApp)</Label>
                  <Input
                    placeholder="+966 5X XXX XXXX"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    onBlur={() => lookupCustomer(customerPhone)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Customer name</Label>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Country</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger>
                      <SelectValue placeholder="Where does the customer live?" />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Facebook / profile link (optional)</Label>
                  <Input
                    value={fbLink}
                    onChange={(e) => setFbLink(e.target.value)}
                  />
                </div>
              </div>
              {foundCustomer && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="mb-2 font-medium">
                    Repeat customer — {foundCustomer.orderCount} previous order
                    {foundCustomer.orderCount === 1 ? "" : "s"}
                  </div>
                  <div className="grid gap-1">
                    {foundCustomer.recentOrders.map((o) => (
                      <div
                        key={o.id}
                        className="flex flex-wrap items-center gap-2 text-muted-foreground"
                      >
                        <span className="font-mono text-xs">{o.orderNo}</span>
                        <span>{o.date}</span>
                        <span>→ {o.recipientName}</span>
                        <span className="ml-auto">{money(o.totalAmount)}</span>
                        <Badge variant="outline">
                          {ORDER_STATUS_LABELS[o.status]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {initial?.customer.name} · {initial?.customer.phoneForeign} ·{" "}
              {initial?.customer.country}
              <span className="ml-2 text-xs">
                (customer details are fixed after creation)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B — Recipient (in Bangladesh) */}
      <Card>
        <CardHeader>
          <CardTitle>B · Recipient</CardTitle>
          <CardDescription>
            Who receives the gift in Bangladesh — phone number 2 of 2.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Recipient name</Label>
              <Input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Recipient phone (BD)</Label>
              <Input
                placeholder="01XXXXXXXXX"
                value={recipientPhoneBd}
                onChange={(e) => setRecipientPhoneBd(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Relation (optional)</Label>
              <Select value={relation} onValueChange={setRelation}>
                <SelectTrigger>
                  <SelectValue placeholder="Wife, Mother…" />
                </SelectTrigger>
                <SelectContent>
                  {RECIPIENT_RELATIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Recipient birthday (optional)</Label>
              <Input
                type="date"
                value={recipientBirthday}
                onChange={(e) => setRecipientBirthday(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Recipient anniversary (optional)</Label>
              <Input
                type="date"
                value={recipientAnniversary}
                onChange={(e) => setRecipientAnniversary(e.target.value)}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Birthday/anniversary save to the customer&apos;s recipient profile —
            the team gets reminded before the date every year.
          </p>
          <div className="grid gap-2">
            <Label>Full delivery address</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House, road, area, landmarks — the courier gets exactly this"
            />
          </div>
          <div className="grid gap-2">
            <Label>Delivery zone (optional)</Label>
            <Select
              value={deliveryZone}
              onValueChange={(v) => {
                const zone = v as DeliveryZoneValue;
                setDeliveryZone(zone);
                autofillCharge(zone, lines);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Inside Dhaka / Sub Dhaka / Outside Dhaka" />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_ZONES.map((z) => (
                  <SelectItem key={z} value={z}>
                    {DELIVERY_ZONE_LABELS[z]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              If any ordered item has a zone delivery charge, the order’s
              delivery charge auto-fills from the matching zone (editable
              below). Default is free delivery.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Occasion (optional)</Label>
              <Select value={occasion} onValueChange={setOccasion}>
                <SelectTrigger>
                  <SelectValue placeholder="Birthday, Anniversary…" />
                </SelectTrigger>
                <SelectContent>
                  {OCCASIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Requested delivery</Label>
              <Select
                value={deliveryDateMode}
                onValueChange={(v) => {
                  const m = v as DeliveryDateModeValue;
                  setDeliveryDateMode(m);
                  if (m !== "FIXED") setDeliveryDate("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_DATE_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "FIXED" ? "🎯 " : ""}
                      {DELIVERY_DATE_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {deliveryDateMode === "FIXED" && (
              <div className="grid gap-2">
                <Label>Deliver ON this date</Label>
                <Input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Birthdays/anniversaries — must arrive on the day.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section C — Items */}
      <Card>
        <CardHeader>
          <CardTitle>C · Items</CardTitle>
          <CardDescription>
            Packages or standalone products. Prices auto-fill from the catalog
            and are editable down to the price floor.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {lines.map((line) => {
            const floor = lineFloor(line);
            const below =
              floor != null && line.itemId && Number(line.unitPrice) < floor;
            const options =
              line.itemType === "PRODUCT" ? products : packages;
            return (
              <div key={line.key} className="grid gap-1">
                <div className="grid grid-cols-[110px_1fr_70px_110px_36px] items-end gap-2">
                  <div className="grid gap-1">
                    {line.key === lines[0].key && (
                      <Label className="text-xs">Type</Label>
                    )}
                    <Select
                      value={line.itemType}
                      onValueChange={(v) =>
                        updateLine(line.key, {
                          itemType: v as "PRODUCT" | "PACKAGE",
                          itemId: "",
                          unitPrice: "",
                          selections: {},
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PACKAGE">Package</SelectItem>
                        <SelectItem value="PRODUCT">Product</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    {line.key === lines[0].key && (
                      <Label className="text-xs">Item</Label>
                    )}
                    <Select
                      value={line.itemId}
                      onValueChange={(v) => selectItem(line, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick an item" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {options.map((o) => (
                          <SelectItem key={o.id} value={String(o.id)}>
                            {o.name} — {money(o.sellingPrice)}
                            {"availableToSell" in o &&
                            o.availableToSell != null
                              ? ` (can build ${o.availableToSell})`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    {line.key === lines[0].key && (
                      <Label className="text-xs">Qty</Label>
                    )}
                    <Input
                      type="number"
                      min="1"
                      value={line.qty}
                      onChange={(e) =>
                        updateLine(line.key, { qty: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    {line.key === lines[0].key && (
                      <Label className="text-xs">Unit price (৳)</Label>
                    )}
                    <Input
                      type="number"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(line.key, { unitPrice: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setLines((ls) =>
                        ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls
                      )
                    }
                    disabled={lines.length === 1}
                    title="Remove line"
                  >
                    ×
                  </Button>
                </div>
                {below && (
                  <p className="text-xs text-destructive">
                    Below price floor ({money(floor!)}) —{" "}
                    {canOverrideFloor
                      ? "you can override as TL/Admin"
                      : "needs TL/Admin approval"}
                  </p>
                )}
                {/* CORRECTIONS Products §5 — variant picks for this package */}
                {line.itemType === "PACKAGE" &&
                  (packageById.get(line.itemId)?.choiceGroups.length ?? 0) >
                    0 && (
                    <div className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-2">
                      {packageById
                        .get(line.itemId)!
                        .choiceGroups.map((g) => (
                          <div key={g.groupId} className="grid gap-1">
                            <Label className="text-xs">
                              {g.path.length > 0
                                ? `${g.path.join(" → ")} · `
                                : ""}
                              {g.label}
                            </Label>
                            <Select
                              value={line.selections[String(g.groupId)] ?? ""}
                              onValueChange={(v) =>
                                updateLine(line.key, {
                                  selections: {
                                    ...line.selections,
                                    [String(g.groupId)]: v,
                                  },
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choose…" />
                              </SelectTrigger>
                              <SelectContent>
                                {g.options.map((o) => (
                                  <SelectItem
                                    key={o.productId}
                                    value={String(o.productId)}
                                  >
                                    {o.name}
                                    {o.isDefault ? " (default)" : ""} — stock{" "}
                                    {o.stockQty}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  {
                    key: lineKey++,
                    itemType: "PRODUCT",
                    itemId: "",
                    qty: "1",
                    unitPrice: "",
                    selections: {},
                  },
                ])
              }
            >
              + Add line
            </Button>
          </div>

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Discount</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
                <Select
                  value={discountType}
                  onValueChange={(v) =>
                    setDiscountType(v as "AMOUNT" | "PERCENT")
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AMOUNT">৳</SelectItem>
                    <SelectItem value="PERCENT">%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Courier charge (৳)</Label>
              <Input
                type="number"
                min="0"
                value={courierCharge}
                onChange={(e) => setCourierCharge(e.target.value)}
              />
            </div>
            <div className="grid content-end gap-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span>−{money(discountAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section D — Payment at confirmation (create only) */}
      {mode === "create" ? (
        <Card>
          <CardHeader>
            <CardTitle>D · Advance payment</CardTitle>
            <CardDescription>
              Advance received at confirmation. Transaction ID is mandatory for
              bKash/Nagad/Rocket and checked against all past payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Advance amount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PaymentMethodValue)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="bKash, Nagad…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADVANCE_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>
                  Transaction ID
                  {method && MFS_METHODS.includes(method) ? "" : " (optional)"}
                </Label>
                <Input
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                />
                {mfsNeedsTxn && (
                  <p className="text-xs text-destructive">
                    Required for {method && PAYMENT_METHOD_LABELS[method]}
                  </p>
                )}
              </div>
            </div>
            {advance > 0 && (
              <div className="grid gap-2">
                <Label>Received in wallet</Label>
                {wallets.length === 0 ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                    No active wallets — ask an admin to add a company account
                    under Money → Wallets before taking an advance.
                  </p>
                ) : (
                  <Select
                    value={advanceWalletId}
                    onValueChange={setAdvanceWalletId}
                  >
                    <SelectTrigger className="sm:max-w-sm">
                      <SelectValue placeholder="Which account received the advance?" />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.name} · {WALLET_TYPE_LABELS[w.type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Sender wallet number (optional)</Label>
                <Input
                  value={senderNumber}
                  onChange={(e) => setSenderNumber(e.target.value)}
                />
              </div>
              <PhotoField value={screenshotUrl} onChange={setScreenshotUrl} />
            </div>
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
              <div className="grid content-end gap-1 text-sm">
                <div className="flex justify-between font-medium">
                  <span>Due amount</span>
                  <span>{money(Math.max(due, 0))}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  = total − advance, recalculated on every payment
                </p>
              </div>
              <div className="grid gap-2">
                <Label>COD amount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder={String(Math.max(due, 0))}
                  value={codAmount}
                  onChange={(e) => setCodAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Collected on delivery — defaults to the due amount
                </p>
              </div>
              {advance === 0 && (
                <div className="grid gap-2">
                  <Label>No advance?</Label>
                  {canOverrideFloor ? (
                    <>
                      <Input
                        placeholder="Override reason (required to confirm)"
                        value={zeroAdvanceReason}
                        onChange={(e) => setZeroAdvanceReason(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        With a reason the order confirms; otherwise it starts ON
                        HOLD.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-600">
                      No advance → the order starts ON HOLD, or use{" "}
                      <span className="font-medium">Save as draft</span> for a
                      committed-but-unpaid order (confirms when the advance is
                      recorded).
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>D · COD amount</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:max-w-xs">
            <Label>COD amount (৳)</Label>
            <Input
              type="number"
              min="0"
              value={codAmount}
              onChange={(e) => setCodAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Payments are managed from the order page; totals and due recompute
              on save.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Section E — Meta */}
      <Card>
        <CardHeader>
          <CardTitle>E · Meta</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="text-sm">
              <div className="text-muted-foreground">Sales Executive</div>
              <div className="font-medium">{seName}</div>
            </div>
            <div className="text-sm">
              <div className="text-muted-foreground">Team</div>
              <div className="font-medium">{teamName ?? "—"}</div>
            </div>
          </div>
          {/* 3-note system (CORRECTIONS Orders §6d) */}
          <div className="grid gap-2">
            <Label>Notes</Label>
            <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
              {(
                [
                  ["order", "Order Note", notes],
                  ["invoice", "Invoice Note", invoiceNote],
                  ["courier", "Courier Note", courierNote],
                ] as const
              ).map(([key, label, value]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNoteTab(key)}
                  className={`flex-1 rounded-sm px-2 py-1.5 font-medium transition-colors ${
                    noteTab === key
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  {value.trim() ? " •" : ""}
                </button>
              ))}
            </div>
            {noteTab === "order" && (
              <>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal — visible to the team only"
                />
                <p className="text-xs text-muted-foreground">
                  Internal note — never leaves the team.
                </p>
              </>
            )}
            {noteTab === "invoice" && (
              <>
                <Textarea
                  value={invoiceNote}
                  onChange={(e) => setInvoiceNote(e.target.value)}
                  placeholder="Printed on the invoice — the customer sees this"
                />
                <p className="text-xs text-muted-foreground">
                  Printed on the invoice PDF — customer-visible.
                </p>
              </>
            )}
            {noteTab === "courier" && (
              <>
                <Textarea
                  value={courierNote}
                  onChange={(e) => setCourierNote(e.target.value)}
                  placeholder="Delivery instructions — sent to Steadfast with the parcel"
                />
                <p className="text-xs text-muted-foreground">
                  Sent to Steadfast as the consignment note (delivery
                  instructions).
                </p>
              </>
            )}
          </div>
          {mode === "edit-request" && (
            <div className="grid gap-2">
              <Label>Why is this edit needed?</Label>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Shown to the approving TL/Manager"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 pb-8">
        {floorBreaches.length > 0 && !canOverrideFloor && (
          <p className="mr-auto text-sm text-destructive">
            {floorBreaches.length} item(s) below price floor — raise the price
            or ask a TL/Admin.
          </p>
        )}
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {/* CORRECTIONS Leads §10 — committed-but-unpaid: save everything as a
            DRAFT (no reserve/invoice); recording the advance later confirms it. */}
        {mode === "create" && advance === 0 && (
          <Button
            variant="secondary"
            onClick={() => submit(true)}
            disabled={disableSubmit}
            title="No advance yet — save the full order as a draft and confirm when the payment lands"
          >
            {saving ? "Saving…" : "Save as draft"}
          </Button>
        )}
        <Button onClick={() => submit(false)} disabled={disableSubmit}>
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create order"
              : mode === "edit"
                ? "Save changes"
                : "Submit for approval"}
        </Button>
      </div>
    </div>
  );
}
