// CLAUDE.md rule 8 — the shadow database is the only database Prisma may wipe
// (it empties it on every `migrate diff --shadow-database-url`), so it must be
// unmistakably a throwaway one: its name ends in "_shadow" and it is not the
// database DATABASE_URL or DIRECT_URL point at. Pure, so it is unit-tested
// (tests/shadow-db.test.ts); scripts/db-diff.ts refuses to run without it.

/** host + database name, the identity of a Postgres URL (user/password/params ignored). */
function dbIdentity(url: string): { host: string; name: string } {
  const u = new URL(url);
  return { host: u.hostname.toLowerCase(), name: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

/** Throws unless `shadowUrl` is a database named *_shadow that no real URL points at. */
export function assertShadowDatabaseUrl(
  shadowUrl: string | undefined,
  realUrls: (string | undefined)[],
): void {
  if (!shadowUrl?.trim()) throw new Error("SHADOW_DATABASE_URL is not set — refusing to run.");
  let shadow: { host: string; name: string };
  try {
    shadow = dbIdentity(shadowUrl.trim());
  } catch {
    throw new Error("SHADOW_DATABASE_URL is not a valid URL — refusing to run.");
  }
  if (!shadow.name.endsWith("_shadow")) {
    throw new Error(
      `SHADOW_DATABASE_URL points at database "${shadow.name}", whose name does not end in "_shadow" — refusing to run (CLAUDE.md rule 8).`,
    );
  }
  for (const real of realUrls) {
    if (!real?.trim()) continue;
    let r: { host: string; name: string };
    try {
      r = dbIdentity(real.trim());
    } catch {
      continue;
    }
    // Neon's pooled host is "<ep>-pooler.<region>…"; the direct one drops "-pooler".
    const sameHost = r.host.replace("-pooler.", ".") === shadow.host.replace("-pooler.", ".");
    if (sameHost && r.name === shadow.name) {
      throw new Error("SHADOW_DATABASE_URL is the same database as DATABASE_URL/DIRECT_URL — refusing to run.");
    }
  }
}
