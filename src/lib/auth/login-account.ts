import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authUser } from "@/db/schema";
import type { AccountType } from "@/db/schema";

export async function findUniqueLoginAccount(database: AppDatabase, type: AccountType, identifier: string) {
  const matches = await database
    .select({
      id: appAccounts.id,
      authUserId: authUser.id,
      email: authUser.email,
      status: appAccounts.status,
      householdId: appAccounts.householdId,
      rtUnitId: appAccounts.rtUnitId,
    })
    .from(appAccounts)
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .where(and(
      eq(appAccounts.accountType, type),
      sql`lower(${appAccounts.loginIdentifier}) = ${identifier.toLowerCase()}`,
    ))
    .limit(2);

  return matches.length === 1 ? matches[0] : null;
}
