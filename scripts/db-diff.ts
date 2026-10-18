// npm run db:diff — the SQL a new migration needs: prisma/migrations replayed
// into the shadow database, diffed against prisma/schema.prisma. Prisma wipes
// the shadow database to do it, so this refuses to run unless
// SHADOW_DATABASE_URL is a *_shadow database distinct from the real ones
// (CLAUDE.md rule 8). It never touches DATABASE_URL or DIRECT_URL.
// Write the output into prisma/migrations/<stamp>_<name>/migration.sql.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertShadowDatabaseUrl } from "../lib/shadow-db";

if (existsSync(".env")) process.loadEnvFile(".env");

const shadow = process.env.SHADOW_DATABASE_URL;
try {
  assertShadowDatabaseUrl(shadow, [process.env.DATABASE_URL, process.env.DIRECT_URL]);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const res = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadow!,
    "--script",
  ],
  { stdio: "inherit" },
);
process.exit(res.status ?? 1);
