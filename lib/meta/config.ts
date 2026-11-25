import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

// ROUND3 W-8 — the Meta settings as the senders need them (the website's
// order endpoint, the beacon, the confirmation, the job). No staff-session
// code here: the website's routes import this. The Admin screen's side is
// ./settings.ts.

export const META_ROW_ID = "meta";
type Db = Prisma.TransactionClient | typeof prisma;

/** What the sender needs: null while tracking is off or incomplete — then nothing is queued or sent. */
export type MetaConfig = { pixelId: string; token: string; testEventCode: string | null };

export async function getMetaConfig(db: Db = prisma, opts: { evenWhenOff?: boolean } = {}): Promise<MetaConfig | null> {
  const row = await db.metaTracking.findUnique({ where: { id: META_ROW_ID } });
  if (!row || (!row.isEnabled && !opts.evenWhenOff) || !row.pixelId || !row.accessTokenEncrypted) return null;
  try {
    return { pixelId: row.pixelId, token: decryptSecret(row.accessTokenEncrypted), testEventCode: row.testEventCode };
  } catch (e) {
    console.error("Meta tracking: the saved token can't be decrypted (COURIER_ENCRYPTION_KEY changed?) —", e);
    return null;
  }
}

