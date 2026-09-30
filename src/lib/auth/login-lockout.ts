import { and, eq, gt, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts } from "@/db/schema";

export const RESIDENT_LOGIN_MAX_FAILURES = 5;
export const RESIDENT_LOGIN_LOCKOUT_MILLISECONDS = 15 * 60 * 1000;

export async function isResidentLoginLocked(database: AppDatabase, accountId: string, now = new Date()) {
  const [account] = await database
    .select({ id: appAccounts.id })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, accountId),
      eq(appAccounts.accountType, "resident"),
      gt(appAccounts.lockedUntil, now),
    ))
    .limit(1);
  return Boolean(account);
}

export async function recordFailedResidentLogin(database: AppDatabase, accountId: string, now = new Date()) {
  const nextLockUntil = new Date(now.getTime() + RESIDENT_LOGIN_LOCKOUT_MILLISECONDS);
  const [account] = await database
    .update(appAccounts)
    .set({
      failedLoginAttempts: sql`least(${appAccounts.failedLoginAttempts} + 1, ${RESIDENT_LOGIN_MAX_FAILURES})`,
      lockedUntil: sql`case when ${appAccounts.failedLoginAttempts} + 1 >= ${RESIDENT_LOGIN_MAX_FAILURES} then ${nextLockUntil} else ${appAccounts.lockedUntil} end`,
    })
    .where(and(eq(appAccounts.id, accountId), eq(appAccounts.accountType, "resident")))
    .returning({ failedLoginAttempts: appAccounts.failedLoginAttempts, lockedUntil: appAccounts.lockedUntil });
  return account ?? null;
}

export async function clearResidentLoginFailures(database: AppDatabase, accountId: string) {
  await database
    .update(appAccounts)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(and(eq(appAccounts.id, accountId), eq(appAccounts.accountType, "resident")));
}
