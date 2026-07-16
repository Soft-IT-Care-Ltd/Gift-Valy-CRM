import { PrismaClient } from "@prisma/client";

// ---- Trash auto-filter (CORRECTIONS Orders §6f) ----
//
// A trashed order (orders.deleted_at set) must vanish from every list, report,
// dashboard, target and stock computation without touching the ~30 query sites
// spread across the app. This query extension appends `deletedAt: null` to
// every set-returning Order query. A caller that mentions `deletedAt` anywhere
// in its own where clause (the Trash tab, restore/purge paths) opts out and
// sees exactly what it asked for.
//
// Not intercepted — by design:
//   • findUnique/update/delete — unique lookups can't carry non-unique filters;
//     the handful of routes that fetch by id check `deletedAt` explicitly.
//   • Nested relation filters (e.g. payment.findMany({ where: { order: … } })) —
//     those sites filter `order: { deletedAt: null }` explicitly.

const FILTERED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

function mentionsDeletedAt(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "deletedAt") return true;
    if (key === "AND" || key === "OR" || key === "NOT") {
      const branches = Array.isArray(value) ? value : [value];
      if (branches.some(mentionsDeletedAt)) return true;
    }
  }
  return false;
}

function buildClient(): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      order: {
        $allOperations({ operation, args, query }) {
          if (FILTERED_OPS.has(operation)) {
            const a = args as { where?: Record<string, unknown> };
            if (!mentionsDeletedAt(a.where)) {
              a.where = a.where
                ? { AND: [a.where, { deletedAt: null }] }
                : { deletedAt: null };
            }
          }
          return query(args);
        },
      },
    },
    // The extended client is structurally a PrismaClient (plus the silent
    // filter); typing it as one keeps every existing call site unchanged.
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
