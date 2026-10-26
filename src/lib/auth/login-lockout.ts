import { and, eq, gt, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, type AccountType } from "@/db/schema";

export const ACCOUNT_LOGIN_MAX_FAILURES = 5;
export const ACCOUNT_LOGIN_LOCKOUT_MILLISECONDS = 15 * 60 * 1000;
export const RESIDENT_LOGIN_MAX_FAILURES = ACCOUNT_LOGIN_MAX_FAILURES;
export const RESIDENT_LOGIN_LOCKOUT_MILLISECONDS = ACCOUNT_LOGIN_LOCKOUT_MILLISECONDS;

export async function isAccountLoginLocked(
  database: AppDatabase,
  accountId: string,
  accountType: AccountType,
  now = new Date(),
) {
  const [account] = await database
    .select({ id: appAccounts.id })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, accountId),
      eq(appAccounts.accountType, accountType),
      gt(appAccounts.lockedUntil, now),
    ))
    .limit(1);
  return Boolean(account);
}

export async function recordFailedAccountLogin(
  database: AppDatabase,
  accountId: string,
  accountType: AccountType,
  now = new Date(),
) {
  const nextLockUntil = new Date(now.getTime() + RESIDENT_LOGIN_LOCKOUT_MILLISECONDS);
  const [account] = await database
    .update(appAccounts)
    .set({
      failedLoginAttempts: sql`case when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then 1 else least(${appAccounts.failedLoginAttempts} + 1, ${ACCOUNT_LOGIN_MAX_FAILURES}) end`,
      lockedUntil: sql`case when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then null when ${appAccounts.failedLoginAttempts} + 1 >= ${ACCOUNT_LOGIN_MAX_FAILURES} then ${nextLockUntil} else ${appAccounts.lockedUntil} end`,
    })
    .where(and(eq(appAccounts.id, accountId), eq(appAccounts.accountType, accountType)))
    .returning({ failedLoginAttempts: appAccounts.failedLoginAttempts, lockedUntil: appAccounts.lockedUntil });
  return account ?? null;
}

export async function clearAccountLoginFailures(database: AppDatabase, accountId: string, accountType: AccountType) {
  await database
    .update(appAccounts)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(and(eq(appAccounts.id, accountId), eq(appAccounts.accountType, accountType)));
}

export async function isResidentLoginLocked(database: AppDatabase, accountId: string, now = new Date()) {
  return isAccountLoginLocked(database, accountId, "resident", now);
}

export async function recordFailedResidentLogin(database: AppDatabase, accountId: string, now = new Date()) {
  return recordFailedAccountLogin(database, accountId, "resident", now);
}

export async function clearResidentLoginFailures(database: AppDatabase, accountId: string) {
  return clearAccountLoginFailures(database, accountId, "resident");
}
