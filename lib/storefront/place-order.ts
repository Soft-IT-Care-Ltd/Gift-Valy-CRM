import { randomBytes, randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { loadBomCatalog } from "@/lib/bom-db";
import {
  BomError,
  explodePackage,
  explodeProduct,
  packagePrice,
  selectionsFromJson,
  type BomCatalog,
  type StoredChoiceSelection,
} from "@/lib/bom";
import { isDraftNo, nextDraftNo } from "@/lib/draft-number";
import { withdrawInactiveOptions } from "./inactive-options";
import { dbDate, dhakaDateBound, type DeliveryZoneValue } from "@/lib/order-constants";
import { normalizePrintKit, printKitPhotoCount } from "@/lib/print-kit";
import { syncPrintKits } from "@/lib/print-kits";
import { trackingUrlFromCode } from "@/lib/steadfast-constants";
import { getWebsiteUserId } from "@/lib/system-user";
import { assignmentNotifications, chooseSalesExecutive, inTx, websiteOrderRules } from "@/lib/website-assignment";
import type { WebContact } from "@/lib/website-order-constants";
import type { WebOrderRules } from "./settings-shape";
import { checkOrderRequest, phoneSpellings, type CheckedOrderRequest, type FieldErrors } from "./checkout-shape";
import { copy } from "./copy";
import { PACKAGE_ON_WEBSITE, PRODUCT_ON_WEBSITE } from "./on-website";

// ROUND3 W-5 — the website's ONE write: a customer places an order.
//
// The request says who (the sender abroad, the recipient in Bangladesh), where
// (address, zone), when (date mode), which items, which choices and how many
// (lib/storefront/checkout-shape.ts). EVERYTHING with money in it — each
// line's price, the delivery charge, the total — is worked out here from the
// database at this moment, with the same packagePrice() the order form uses.
// The prices the page showed (seenPrice / seenTotal) are read in exactly one
// place, assertShownPrices(), which can only refuse (409).
//
// The order is a DRAFT: a DRAFT-XXXX number from nextDraftNo(tx) — never the
// order counter. It gets its GV number (and counts for the Funnel Liner bill)
// only when a Sales Executive confirms it through confirmDraftTx (CLAUDE.md
// rule 6). Nothing is reserved: Gift Valy reserves stock at CONFIRMED.
//
// Spam: a WhatsApp number and an IP may place only so many orders an hour
// (Settings → Website); the same number with the same items within 30
// minutes is flagged a likely duplicate; a honeypot field turns bots away.

type Tx = Prisma.TransactionClient;
type Db = Prisma.TransactionClient | PrismaClient;

export class WebsiteOrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field: string | null = null,
    readonly fields: FieldErrors | null = null
  ) {
    super(message);
  }
}

export type PlacedWebsiteOrder = { orderId: number; ref: string; token: string; flags: string[] };

export const DUPLICATE_WINDOW_MINUTES = 30;

/** Unambiguous letters and digits (no 0/O, 1/I/L) — read out on WhatsApp. */
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const WEB_REF = /^W-[2-9A-HJKMNP-Z]{6}$/;
const newRef = () => `W-${Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("")}`;
const newToken = () => randomBytes(18).toString("base64url");

const round2 = (n: number) => Math.round(n * 100) / 100;
const paisa = (n: number) => Math.round(n * 100);

export async function placeWebsiteOrder(
  raw: unknown,
  ctx: { ip: string | null; now?: Date },
  db: Db = prisma
): Promise<PlacedWebsiteOrder> {
  const now = ctx.now ?? new Date();
  const checked = checkOrderRequest(raw, now);
  if (!checked.ok) {
    const [field, message] = Object.entries(checked.errors)[0] ?? ["form", copy.api.checkDetails];
    throw new WebsiteOrderError(message, 400, field, checked.errors);
  }
  const input = checked.value;
  if (input.website) throw new WebsiteOrderError(copy.api.failed, 400);

  // Made before the transaction, so two first-ever orders can't race to create it.
  const [websiteUserId, rules] = await Promise.all([getWebsiteUserId(db), websiteOrderRules(db)]);
  const run = (tx: Tx) => placeInTx(tx, input, { ip: ctx.ip, now, websiteUserId, rules });
  if (!("$transaction" in db)) return run(db);
  // A DRAFT number (or reference) taken by a parallel save a moment ago: the
  // whole transaction runs again — nothing of the failed try was kept.
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTx(db, run);
    } catch (e) {
      const clash =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        ["order_no", "web_ref", "web_token"].some((f) => JSON.stringify(e.meta?.target ?? "").includes(f));
      if (!clash || attempt >= 2) throw e;
    }
  }
}

type Ctx = { ip: string | null; now: Date; websiteUserId: number; rules: WebOrderRules };

type PricedLine = {
  itemType: "PRODUCT" | "PACKAGE";
  productId: number | null;
  packageId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  choiceSelections: StoredChoiceSelection[] | null;
};

async function placeInTx(tx: Tx, input: CheckedOrderRequest, ctx: Ctx): Promise<PlacedWebsiteOrder> {
  const { now, websiteUserId } = ctx;

  // 1. One number, then one IP, at a time — so the hourly limits can't be raced.
  // Verify R3 — TRY the lock and answer 429 when it's held, never queue: a
  // request waiting on a lock holds one of the pool's few connections, so a
  // burst from one address could starve the staff's ERP.
  const lock = async (key: string) => {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS ok`;
    if (!row?.ok) throw new WebsiteOrderError(copy.api.busy, 429);
  };
  await lock(`website-order:phone:${input.whatsapp}`);
  if (ctx.ip) await lock(`website-order:ip:${ctx.ip}`);

  // 2. The limits. Trashed orders count too (mentioning deletedAt opts out of the trash filter).
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const spellings = phoneSpellings(input.whatsapp);
  const anyTrash = { OR: [{ deletedAt: null }, { deletedAt: { not: null } }] } satisfies Prisma.OrderWhereInput;
  const fromPhone = await tx.order.count({
    where: { source: "WEBSITE", createdAt: { gte: hourAgo }, customer: { phoneForeign: { in: spellings } }, ...anyTrash },
  });
  if (fromPhone >= ctx.rules.phonePerHour) throw new WebsiteOrderError(copy.api.tooManyPhone, 429, "sender.whatsapp");
  if (ctx.ip) {
    const fromIp = await tx.order.count({ where: { source: "WEBSITE", placedIp: ctx.ip, createdAt: { gte: hourAgo }, ...anyTrash } });
    if (fromIp >= ctx.rules.ipPerHour) throw new WebsiteOrderError(copy.api.tooManyIp, 429);
  }

  // 3–6. Items, prices, stock and delivery — from the database only.
  const { lines, deliveryCharge, catalog } = await priceFromDatabase(tx, input, input.recipient.zone);
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const total = round2(subtotal + deliveryCharge);

  // 7. The page showed other prices → say so before anything is written.
  assertShownPrices(input, lines, total);

  // 8. The customer, by the WhatsApp number in any spelling the ERP may hold.
  //    An existing customer's saved name and country are never changed from
  //    the website; what was typed stays on the order (web_contact).
  const existing = await tx.customer.findFirst({
    where: { phoneForeign: { in: spellings } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const customer =
    existing ??
    (await tx.customer.upsert({
      where: { phoneForeign: input.whatsapp },
      update: {},
      create: {
        name: input.sender.name,
        phoneForeign: input.whatsapp,
        country: input.sender.country,
        createdBy: websiteUserId,
        updatedBy: websiteUserId,
      },
      select: { id: true },
    }));

  // The same number ordered the same items a moment ago: flag it for the SE.
  const flags: string[] = [];
  const recent = await tx.order.findMany({
    where: {
      source: "WEBSITE",
      createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000) },
      customer: { phoneForeign: { in: spellings } },
      ...anyTrash,
    },
    select: { items: { select: { itemType: true, productId: true, packageId: true, qty: true, choiceSelections: true } } },
  });
  const key = linesKey(lines);
  if (recent.some((o) => linesKey(o.items) === key)) flags.push("LIKELY_DUPLICATE");

  // 9. The Sales Executive (lib/website-assignment.ts).
  const assignment = await chooseSalesExecutive(tx, { customerId: existing?.id ?? null }, now);
  const ownerId = assignment?.userId ?? websiteUserId;
  const teamId = assignment?.teamId ?? null;
  const ref = newRef();

  // 10. The lead (source Website), committed like a staff draft's lead —
  //     confirmDraftTx flips it to Converted, a cancel to Lost.
  const lead = await tx.lead.create({
    data: {
      leadDate: dhakaDateBound(now),
      source: "WEBSITE",
      customerName: input.sender.name,
      country: input.sender.country,
      whatsappNumber: input.whatsapp,
      interestedIn: lines.map((l) => ({ itemType: l.itemType, id: l.productId ?? l.packageId, name: l.name })),
      status: "COMMITTED",
      committedAt: now,
      notes: `Website order ${ref}`,
      assignedTo: ownerId,
      teamId,
      createdBy: websiteUserId,
      updatedBy: websiteUserId,
    },
    select: { id: true },
  });

  const webContact: WebContact = {
    sender: { name: input.sender.name, country: input.sender.country, whatsapp: input.whatsapp, whatsappTyped: input.sender.whatsapp },
    recipient: {
      name: input.recipient.name,
      phone: input.recipientPhone,
      phoneTyped: input.recipient.phone,
      relation: input.recipient.relation ?? null,
      address: input.recipient.address,
      zone: input.recipient.zone,
    },
    delivery: { mode: input.delivery.mode, date: input.delivery.date ?? null },
    occasion: input.occasion ?? null,
    note: input.note,
  };

  // 11. The order — a DRAFT, numbered DRAFT-XXXX. Never the order counter.
  const token = newToken();
  const orderNo = await nextDraftNo(tx);
  const order = await tx.order.create({
    data: {
      orderNo,
      source: "WEBSITE",
      webRef: ref,
      webToken: token,
      webContact: webContact as unknown as Prisma.InputJsonValue,
      placedIp: ctx.ip,
      webFlags: flags,
      webAssignedAt: assignment ? now : null,
      webAssignReason: assignment?.reason ?? null,
      leadId: lead.id,
      customerId: customer.id,
      recipientName: input.recipient.name,
      recipientPhoneBd: input.recipientPhone,
      recipientRelation: input.recipient.relation ?? null,
      deliveryAddress: input.recipient.address,
      deliveryZone: input.recipient.zone,
      occasion: input.occasion ?? null,
      deliveryDateMode: input.delivery.mode,
      requestedDeliveryDate: input.delivery.mode === "FIXED" && input.delivery.date ? dbDate(input.delivery.date) : null,
      subtotal,
      discount: 0,
      courierChargeCustomer: deliveryCharge,
      totalAmount: total,
      advanceAmount: 0,
      dueAmount: total, // nothing paid yet (CLAUDE.md rule 2)
      codAmount: total, // as a staff draft: follows the due when the advance lands (recomputeDue → nextCodAmount)
      status: "DRAFT",
      notes: input.note ? `Customer's note (website): ${input.note}` : null,
      salesExecutiveId: ownerId,
      teamId,
      createdBy: websiteUserId,
      updatedBy: websiteUserId,
      createdAt: now,
    },
    select: { id: true },
  });

  // 12. The lines, with each pick's extra price and pieces (R3-2 snapshot).
  await tx.orderItem.createMany({
    data: lines.map((l) => ({
      orderId: order.id,
      itemType: l.itemType,
      productId: l.productId,
      packageId: l.packageId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      choiceSelections: l.choiceSelections ? (l.choiceSelections as unknown as Prisma.InputJsonValue) : undefined,
    })),
  });

  // 13. Print kits (Customize Chocolate Box): the photos come later on WhatsApp.
  await syncPrintKits(tx, order.id, catalog);

  // 14. History, 15. the bell, 16. the audit row.
  await tx.orderStatusHistory.create({
    data: { orderId: order.id, fromStatus: null, toStatus: "DRAFT", byUser: websiteUserId, note: `Placed on the website (${ref})`, at: now },
  });
  if (assignment) await assignmentNotifications(tx, { id: order.id, ref, senderName: input.sender.name }, assignment, now);
  await logAuditTx(tx, {
    userId: websiteUserId,
    action: "order.create.website",
    entity: "orders",
    entityId: order.id,
    after: {
      actor: "website",
      ip: ctx.ip,
      ref,
      orderNo,
      lines: lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, choices: l.choiceSelections })),
      deliveryCharge,
      total,
      flags,
      assignedTo: assignment?.userId ?? null,
      assignReason: assignment?.reason ?? "UNASSIGNED",
    },
  });
  return { orderId: order.id, ref, token, flags };
}

/**
 * Every line re-found by the website's own rule and priced with
 * packagePrice() / the product's selling price; the whole bag exploded
 * together against stock net of what confirmed orders hold; the delivery
 * charge Σ qty × the item's charge for the zone. Nothing from the request
 * but which items, which picks and how many.
 */
async function priceFromDatabase(
  tx: Tx,
  input: CheckedOrderRequest,
  zone: DeliveryZoneValue
): Promise<{ lines: PricedLine[]; deliveryCharge: number; catalog: BomCatalog }> {
  const productSlugs = input.lines.filter((l) => l.kind === "product").map((l) => l.slug);
  const packageSlugs = input.lines.filter((l) => l.kind === "package").map((l) => l.slug);
  const delivery = { deliveryChargeInsideDhaka: true, deliveryChargeSubDhaka: true, deliveryChargeOutsideDhaka: true } as const;
  const [products, packages, catalog, reserved] = await Promise.all([
    productSlugs.length
      ? tx.product.findMany({
          where: { ...PRODUCT_ON_WEBSITE, slug: { in: productSlugs } },
          select: { id: true, slug: true, name: true, websiteName: true, sellingPrice: true, ...delivery },
        })
      : [],
    packageSlugs.length
      ? tx.package.findMany({
          where: { ...PACKAGE_ON_WEBSITE, slug: { in: packageSlugs } },
          select: { id: true, slug: true, name: true, websiteName: true, ...delivery },
        })
      : [],
    loadBomCatalog(tx).then(async (catalog) =>
      withdrawInactiveOptions(
        catalog,
        (await tx.product.findMany({ where: { isActive: false, choiceOptions: { some: {} } }, select: { id: true } })).map((p) => p.id)
      )
    ),
    tx.product.findMany({ where: { reservedQty: { gt: 0 } }, select: { id: true, reservedQty: true } }),
  ]);
  // What can still be sold: stock minus what confirmed orders hold (as the website shows it).
  const held = new Map(reserved.map((r) => [r.id, r.reservedQty]));
  const productBySlug = new Map(products.map((p) => [p.slug!, p]));
  const packageBySlug = new Map(packages.map((p) => [p.slug!, p]));
  const chargeKey =
    zone === "INSIDE_DHAKA" ? "deliveryChargeInsideDhaka" : zone === "SUB_DHAKA" ? "deliveryChargeSubDhaka" : "deliveryChargeOutsideDhaka";

  const lines: PricedLine[] = [];
  const explosions: Map<number, number>[] = [];
  let deliveryCharge = 0;
  for (const line of input.lines) {
    try {
      if (line.kind === "product") {
        const p = productBySlug.get(line.slug);
        if (!p) throw new WebsiteOrderError(copy.api.itemGone, 409, "lines");
        const unitPrice = round2(Number(p.sellingPrice));
        lines.push({
          itemType: "PRODUCT",
          productId: p.id,
          packageId: null,
          name: p.websiteName || p.name,
          qty: line.qty,
          unitPrice,
          lineTotal: round2(unitPrice * line.qty),
          choiceSelections: null,
        });
        const one = explodeProduct(catalog, p.id);
        explosions.push(new Map([...one].map(([id, n]) => [id, n * line.qty])));
        deliveryCharge += line.qty * Number(p[chargeKey]);
      } else {
        const p = packageBySlug.get(line.slug);
        if (!p) throw new WebsiteOrderError(copy.api.itemGone, 409, "lines");
        const picks = new Map(Object.entries(line.picks).map(([g, o]) => [Number(g), o]));
        let price;
        try {
          price = packagePrice(catalog, p.id, picks);
        } catch (e) {
          if (e instanceof BomError) throw new WebsiteOrderError(copy.api.choiceGone, 409, "lines");
          throw e;
        }
        lines.push({
          itemType: "PACKAGE",
          productId: null,
          packageId: p.id,
          name: p.websiteName || p.name,
          qty: line.qty,
          unitPrice: price.unitPrice,
          lineTotal: round2(price.unitPrice * line.qty),
          choiceSelections: price.picks.length > 0 ? price.picks : null,
        });
        explosions.push(explodePackage(catalog, p.id, line.qty, picks));
        deliveryCharge += line.qty * Number(p[chargeKey]);
      }
    } catch (e) {
      if (e instanceof BomError) throw new WebsiteOrderError(copy.api.itemGone, 409, "lines");
      throw e;
    }
  }

  // The whole bag at once: two lines sharing a part that is short both count.
  const need = new Map<number, number>();
  for (const ex of explosions) for (const [id, n] of ex) need.set(id, (need.get(id) ?? 0) + n);
  for (const [id, n] of need) {
    const p = catalog.products.get(id);
    if (!p?.isStockTracked) continue;
    if (n > p.stockQty - (held.get(id) ?? 0)) {
      const at = explosions.findIndex((ex) => ex.has(id));
      throw new WebsiteOrderError(copy.api.soldOut(lines[at]?.name ?? "an item"), 409, "lines");
    }
  }
  return { lines, deliveryCharge: round2(deliveryCharge), catalog };
}

/**
 * THE only place the request's prices are read. They never price anything:
 * if what the page showed differs from what the database says now, the order
 * is refused (409) and the checkout shows the new prices.
 */
function assertShownPrices(input: CheckedOrderRequest, lines: PricedLine[], total: number): void {
  const changed =
    input.lines.some((l, i) => paisa(l.seenPrice) !== paisa(lines[i].unitPrice)) || paisa(input.seenTotal) !== paisa(total);
  if (changed) throw new WebsiteOrderError(copy.api.pricesChanged, 409, "prices");
}

/** Same items, same picks, same quantities — in any order. */
function linesKey(
  items: { itemType: string; productId: number | null; packageId: number | null; qty: number; choiceSelections: unknown }[]
): string {
  return items
    .map((i) => {
      const picks = [...selectionsFromJson(i.choiceSelections)].map(([g, o]) => `${g}:${o}`).sort().join("+");
      return `${i.itemType}:${i.productId ?? i.packageId}:${i.qty}:${picks}`;
    })
    .sort()
    .join(",");
}

// ---------- the private confirmation page ----------

export type WebOrderReceipt = {
  ref: string;
  /** The GV number once an SE confirmed it; null while it waits (its DRAFT number is never shown — they're reused). */
  number: string | null;
  state: "WAITING" | "ACTIVE" | "CANCELLED" | "RETURNED";
  /** Steps done of Confirmed → Packed → Shipped → Delivered. */
  stepsDone: number;
  placedAt: string;
  zone: DeliveryZoneValue | null;
  items: { name: string; qty: number; unitPrice: number; lineTotal: number; choices: { label: string; name: string }[] }[];
  subtotal: number;
  discount: number;
  delivery: number;
  total: number;
  paid: number;
  due: number;
  trackingLink: string | null;
  /** Photos / card messages to send on WhatsApp (print kits not yet complete); 0 = none. */
  photos: number;
  cards: number;
};

const STEPS_DONE: Record<string, number> = {
  DRAFT: 0,
  CONFIRMED: 1,
  ON_HOLD: 1,
  PACKED: 2,
  HANDED_TO_COURIER: 3,
  IN_TRANSIT: 3,
  DELIVERED: 4,
  COMPLETED: 4,
};

/**
 * The customer's own page (/order/<token>): reference, what they ordered,
 * the money and where the order is now, with the courier's tracking link once
 * it is shipped. Nothing else — no names, phone numbers, address, staff,
 * notes or cost. A trashed order is not found.
 */
export async function websiteOrderByToken(token: string, db: Db = prisma): Promise<WebOrderReceipt | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const o = await db.order.findFirst({
    // deletedAt named on purpose: a trashed order's page is gone, whichever client asks.
    where: { webToken: token, source: "WEBSITE", deletedAt: null },
    select: {
      orderNo: true,
      webRef: true,
      status: true,
      createdAt: true,
      deliveryZone: true,
      subtotal: true,
      discount: true,
      courierChargeCustomer: true,
      totalAmount: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          qty: true,
          unitPrice: true,
          lineTotal: true,
          choiceSelections: true,
          customName: true,
          product: { select: { name: true, websiteName: true } },
          package: { select: { name: true, websiteName: true } },
        },
      },
      payments: { select: { type: true, amount: true, isRejected: true } },
      shipment: { select: { trackingUrl: true, trackingNo: true } },
      printKits: { where: { orphanedAt: null }, select: { spec: true, photoCount: true, cardCount: true } },
    },
  });
  if (!o) return null;
  // A pick is saved with the ERP name; the customer saw the website name.
  type SavedPick = { label?: unknown; name?: unknown; productId?: unknown };
  const picksOf = (json: unknown): SavedPick[] => (Array.isArray(json) ? (json as SavedPick[]) : []);
  const pickIds = [...new Set(o.items.flatMap((i) => picksOf(i.choiceSelections).map((c) => c.productId)).filter((id): id is number => typeof id === "number"))];
  const webNames = new Map(
    pickIds.length === 0
      ? []
      : (await db.product.findMany({ where: { id: { in: pickIds } }, select: { id: true, websiteName: true } }))
          .filter((p) => p.websiteName)
          .map((p) => [p.id, p.websiteName!] as const)
  );
  const paid = round2(
    o.payments.reduce((s, p) => (p.isRejected ? s : s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount))), 0)
  );
  const total = Number(o.totalAmount);
  const state =
    o.status === "CANCELLED" || o.status === "REFUNDED"
      ? "CANCELLED"
      : o.status === "RETURNED"
        ? "RETURNED"
        : o.status === "DRAFT"
          ? "WAITING"
          : "ACTIVE";
  const stepsDone = STEPS_DONE[o.status] ?? 0;
  // Photos / card messages still to send: what each kit asks for, less what the SE has uploaded.
  let photos = 0;
  let cards = 0;
  for (const k of o.printKits) {
    const spec = normalizePrintKit(k.spec);
    if (!spec) continue;
    photos += Math.max(0, printKitPhotoCount(spec) - k.photoCount);
    cards += Math.max(0, spec.cards.length - k.cardCount);
  }
  return {
    ref: o.webRef ?? "",
    // A DRAFT number is never shown — not even on a cancelled draft (those numbers are reused).
    number: isDraftNo(o.orderNo) ? null : o.orderNo,
    state,
    stepsDone,
    placedAt: o.createdAt.toISOString(),
    zone: o.deliveryZone,
    items: o.items.map((i) => ({
      name: i.product?.websiteName || i.product?.name || i.package?.websiteName || i.package?.name || i.customName || "Item",
      qty: i.qty,
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
      choices: picksOf(i.choiceSelections).map((c) => ({
        label: String(c.label ?? ""),
        name: (typeof c.productId === "number" && webNames.get(c.productId)) || String(c.name ?? ""),
      })),
    })),
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    delivery: Number(o.courierChargeCustomer),
    total,
    paid,
    due: round2(total - paid),
    trackingLink: stepsDone >= 3 && o.shipment ? (o.shipment.trackingUrl ?? trackingUrlFromCode(o.shipment.trackingNo)) : null,
    photos: state === "WAITING" || (state === "ACTIVE" && stepsDone < 2) ? photos : 0,
    cards: state === "WAITING" || (state === "ACTIVE" && stepsDone < 2) ? cards : 0,
  };
}
