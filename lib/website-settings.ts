import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { AuthzError } from "@/lib/authz";
import {
  WEBSITE_SETTINGS_KEY,
  normalizeWebSettings,
} from "@/lib/storefront/settings-shape";
import {
  websiteSettingsForm,
  websiteSettingsSchema,
  type WebsiteSettingsForm,
} from "@/lib/storefront/settings-form";

// ROUND3 W-7 — Settings → Website, the server side (Admin: settings.manage).
// The form's value is checked with the same schema the browser uses
// (lib/storefront/settings-form.ts), stored whole in the `website_settings`
// row and audited before/after. The route then clears the website's cache
// (revalidateStorefrontSettings) and the proxy's Website on/off flag
// (forgetWebsiteStatus), so the very next page load shows the change.

type Db = Prisma.TransactionClient | typeof prisma;

export async function readWebsiteSettingsForm(
  db: Db = prisma,
): Promise<WebsiteSettingsForm> {
  const row = await db.setting.findUnique({
    where: { key: WEBSITE_SETTINGS_KEY },
    select: { value: true },
  });
  return websiteSettingsForm(row?.value ?? null);
}

/** The privacy policy is on the website (Meta tracking needs it first, W-8). */
export async function privacyPolicyLive(db: Db = prisma): Promise<boolean> {
  const row = await db.setting.findUnique({
    where: { key: WEBSITE_SETTINGS_KEY },
    select: { value: true },
  });
  return normalizeWebSettings(row?.value ?? null).policies.privacy !== "";
}

export async function saveWebsiteSettings(
  raw: unknown,
  userId: number,
  db: typeof prisma = prisma,
): Promise<WebsiteSettingsForm> {
  return db.$transaction((tx) => saveWebsiteSettingsTx(tx, raw, userId));
}

/** The save inside the caller's transaction (the tests run it rolled back). */
export async function saveWebsiteSettingsTx(
  tx: Prisma.TransactionClient,
  raw: unknown,
  userId: number,
): Promise<WebsiteSettingsForm> {
  const input = websiteSettingsSchema.parse(raw);
  const before = await readWebsiteSettingsForm(tx);
  if (input.policies.privacy === "") {
    const meta = await tx.metaTracking.findUnique({
      where: { id: "meta" },
      select: { isEnabled: true },
    });
    if (meta?.isEnabled) {
      throw new AuthzError(
        400,
        "Meta tracking is on, and it needs the privacy policy on the website — switch tracking off first",
      );
    }
  }
  const value = input as unknown as Prisma.InputJsonValue;
  await tx.setting.upsert({
    where: { key: WEBSITE_SETTINGS_KEY },
    update: { value },
    create: { key: WEBSITE_SETTINGS_KEY, value },
  });
  const after = websiteSettingsForm(input);
  await logAuditTx(tx, {
    userId,
    action: "settings.website",
    entity: "settings",
    entityId: WEBSITE_SETTINGS_KEY,
    before,
    after,
  });
  return after;
}
