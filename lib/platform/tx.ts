import type { Prisma, PrismaClient } from "@prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

/** Run `fn` in a transaction — or inside the one `db` already is. */
export function withTx<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db
    ? (db as PrismaClient).$transaction(fn)
    : fn(db as Prisma.TransactionClient);
}
