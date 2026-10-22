// FUNNEL_LINER.md GV-12 / CLAUDE.md rule 6 — the demo seed creates orders and
// moves the billing counter (order_sequences), so it never runs on production.
// Production is bootstrapped with `npm run db:bootstrap` (prisma/bootstrap.ts).
// Pure, so tests/deploy-config.test.ts can pin it.

/** The production database's name on the server (DEPLOYMENT.md). Staging is giftvaly_staging. */
export const PRODUCTION_DB_NAME = "giftvaly";

/** The database name in a postgres URL ("postgresql://u:p@host/giftvaly?…" → "giftvaly"). */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

/** Why the demo seed must not run against this environment, or null when it may. */
export function demoSeedRefusal(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") {
    return "NODE_ENV=production";
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (databaseName(env[key]) === PRODUCTION_DB_NAME) {
      return `${key} points at the production database "${PRODUCTION_DB_NAME}"`;
    }
  }
  return null;
}
