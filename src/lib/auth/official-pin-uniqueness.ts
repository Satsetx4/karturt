import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import type { AppDatabase } from "@/db/client";
import { appAccounts } from "@/db/schema";

export type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

const MAX_HASHES_TO_COMPARE = 500;

export async function shareOfficialPinUniquenessLock(transaction: AppTransaction) {
  await transaction.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended('karturt:official-pin-uniqueness', 0))`);
}

export async function lockOfficialPinAccounts(transaction: AppTransaction) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('karturt:official-pin-uniqueness', 0))`);
  await transaction.select({ id: appAccounts.id })
    .from(appAccounts)
    .where(eq(appAccounts.accountType, "official"))
    .orderBy(appAccounts.id)
    .for("update");
}

export async function officialPinIsUsedByAnotherAccount(
  transaction: AppTransaction,
  accountId: string | null,
  pin: string,
) {
  const accounts = await transaction.select({ id: appAccounts.id, pinHash: appAccounts.pinHash })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.accountType, "official"),
      isNotNull(appAccounts.pinHash),
      ...(accountId ? [ne(appAccounts.id, accountId)] : []),
    ))
    .orderBy(appAccounts.id);

  if (accounts.length > MAX_HASHES_TO_COMPARE) return true;
  for (const account of accounts) {
    if (!account.pinHash) continue;
    try {
      if (await verifyPassword({ hash: account.pinHash, password: pin })) return true;
    } catch {
      // An unreadable existing credential is treated as a conflict.
      return true;
    }
  }
  return false;
}
