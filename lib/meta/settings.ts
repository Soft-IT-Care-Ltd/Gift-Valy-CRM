import type { MetaTracking, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { AuthzError } from "@/lib/authz";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { META_ROW_ID } from "./config";
import { privacyPolicyLive } from "@/lib/website-settings";

// ROUND3 W-8 — Settings → Website → Meta Pixel (Admin: settings.manage). The
// Conversions API token arrives here once, is encrypted like the Steadfast
// and WhatsApp keys (lib/crypto.ts, AES-256-GCM) and is never returned again —
// the screen shows ****…abc. Nothing about it is in .env or the code, and
// the audit row only says that it changed. Tracking can't be switched on
// without the Pixel ID, the token and a privacy policy on the website (the
// pixel sets a cookie).

export { META_ROW_ID };
type Db = Prisma.TransactionClient | typeof prisma;

export const metaSettingsSchema = z.object({
  pixelId: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^\d{5,20}$/.test(v),
      "A Pixel ID is the number Meta shows in Events Manager (digits only)",
    )
    .optional(),
  // Blank / left out keeps the stored token, so switching on/off never needs it re-typed.
  accessToken: z
    .string()
    .trim()
    .max(600)
    .refine(
      (v) => v === "" || /^[A-Za-z0-9_-]{20,600}$/.test(v),
      "That doesn't look like a Conversions API token",
    )
    .optional(),
  clearToken: z.boolean().optional(),
  testEventCode: z
    .string()
    .trim()
    .max(40)
    .refine(
      (v) => v === "" || /^[A-Za-z0-9]{3,40}$/.test(v),
      "Copy the test code exactly as Meta's Test Events tab shows it (e.g. TEST12345)",
    )
    .optional(),
  isEnabled: z.boolean().optional(),
});
export type MetaSettingsInput = z.infer<typeof metaSettingsSchema>;

/** "EAAG…xyz" → "****…xyz". */
function mask(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return `****…${decryptSecret(encrypted).slice(-3)}`;
  } catch {
    return "****";
  }
}

export function serializeMetaSettings(
  row: MetaTracking | null,
  privacyLive: boolean,
) {
  return {
    isEnabled: row?.isEnabled ?? false,
    pixelId: row?.pixelId ?? "",
    hasToken: Boolean(row?.accessTokenEncrypted),
    tokenMasked: mask(row?.accessTokenEncrypted ?? null),
    testEventCode: row?.testEventCode ?? "",
    updatedAt: row?.updatedAt.toISOString() ?? null,
    privacyLive,
  };
}
export type MetaSettingsView = ReturnType<typeof serializeMetaSettings>;

export async function loadMetaSettingsView(
  db: Db = prisma,
): Promise<MetaSettingsView> {
  const [row, live] = await Promise.all([
    db.metaTracking.findUnique({ where: { id: META_ROW_ID } }),
    privacyPolicyLive(db),
  ]);
  return serializeMetaSettings(row, live);
}

const auditView = (
  row: Pick<
    MetaTracking,
    "isEnabled" | "pixelId" | "accessTokenEncrypted" | "testEventCode"
  > | null,
) =>
  row
    ? {
        isEnabled: row.isEnabled,
        pixelId: row.pixelId,
        hasToken: Boolean(row.accessTokenEncrypted),
        testEventCode: row.testEventCode,
      }
    : null;

export async function updateMetaSettings(
  raw: unknown,
  userId: number,
  db: typeof prisma = prisma,
): Promise<MetaSettingsView> {
  return db.$transaction((tx) => updateMetaSettingsTx(tx, raw, userId));
}

/** The save inside the caller's transaction (the tests run it rolled back). */
export async function updateMetaSettingsTx(
  tx: Prisma.TransactionClient,
  raw: unknown,
  userId: number,
): Promise<MetaSettingsView> {
  const input = metaSettingsSchema.parse(raw);
  const existing = await tx.metaTracking.findUnique({
    where: { id: META_ROW_ID },
  });
  const next = {
    pixelId:
      input.pixelId === undefined
        ? (existing?.pixelId ?? null)
        : input.pixelId || null,
    accessTokenEncrypted: input.clearToken
      ? null
      : input.accessToken
        ? encryptSecret(input.accessToken)
        : (existing?.accessTokenEncrypted ?? null),
    testEventCode:
      input.testEventCode === undefined
        ? (existing?.testEventCode ?? null)
        : input.testEventCode || null,
    isEnabled: input.isEnabled ?? existing?.isEnabled ?? false,
  };
  const live = await privacyPolicyLive(tx);
  if (next.isEnabled) {
    if (!next.pixelId || !next.accessTokenEncrypted) {
      throw new AuthzError(
        400,
        "Enter the Pixel ID and the Conversions API token before switching tracking on",
      );
    }
    if (!live) {
      throw new AuthzError(
        400,
        "Put the privacy policy on the website first (Policies → Privacy policy) — it must be live before tracking is switched on",
      );
    }
  }
  const row = await tx.metaTracking.upsert({
    where: { id: META_ROW_ID },
    create: { id: META_ROW_ID, ...next, updatedBy: userId },
    update: { ...next, updatedBy: userId },
  });
  await logAuditTx(tx, {
    userId,
    action: "settings.website.meta",
    entity: "meta_tracking",
    entityId: META_ROW_ID,
    // Never the token — only whether one is stored, and whether it changed.
    before: auditView(existing),
    after: {
      ...auditView(row),
      tokenChanged: Boolean(input.accessToken) || Boolean(input.clearToken),
    },
  });
  return serializeMetaSettings(row, live);
}

/** The event log on the Settings screen: what was sent (already hashed) and what Meta answered. */
export async function recentMetaEvents(db: Db = prisma, take = 30) {
  const rows = await db.metaEvent.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      eventName: true,
      eventId: true,
      status: true,
      attempts: true,
      error: true,
      response: true,
      testEventCode: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    response: r.response as unknown,
  }));
}
export type MetaEventRow = Awaited<ReturnType<typeof recentMetaEvents>>[number];
