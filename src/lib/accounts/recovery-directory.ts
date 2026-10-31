import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authUser, households, people, rtUnits } from "@/db/schema";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";

export const recoverySearchSchema = z.object({ query: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/) }).strict();
export class RecoveryDirectoryForbiddenError extends Error {}

export async function searchRecoveryAccounts(database: AppDatabase, principal: Principal, input: { query: string }) {
  if (principal.role !== "system_admin" || principal.rtUnitId !== null || !canPerform(principal, "system:recover")) throw new RecoveryDirectoryForbiddenError();
  const active = await resolvePrincipalForUser(database, principal.authUserId);
  if (active.role !== "system_admin" || active.appAccountId !== principal.appAccountId || active.rtUnitId !== null) throw new RecoveryDirectoryForbiddenError();
  const { query } = recoverySearchSchema.parse(input);
  const matchId = z.uuid().safeParse(query);
  const rows = await database.select({ id: appAccounts.id, name: authUser.name, loginIdentifier: appAccounts.loginIdentifier,
    type: appAccounts.accountType, status: appAccounts.status, rtName: rtUnits.name, rtCode: rtUnits.code, rwCode: rtUnits.rwCode, village: rtUnits.village,
    householdActive: households.status, householdEndsOn: households.endsOn, personActive: people.isActive })
    .from(appAccounts).innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .leftJoin(rtUnits, eq(rtUnits.id, appAccounts.rtUnitId))
    .leftJoin(households, and(eq(households.id, appAccounts.householdId), eq(households.rtUnitId, appAccounts.rtUnitId)))
    .leftJoin(people, and(eq(people.id, appAccounts.personId), eq(people.rtUnitId, appAccounts.rtUnitId), eq(people.householdId, appAccounts.householdId)))
    .where(or(eq(sql`lower(${appAccounts.loginIdentifier})`, query.toLowerCase()), matchId.success ? eq(appAccounts.id, matchId.data) : undefined))
    .orderBy(asc(appAccounts.id)).limit(11);
  return { hasMore: rows.length > 10, accounts: rows.slice(0, 10).map((row) => ({
    id: row.id, name: row.name, loginIdentifier: row.loginIdentifier, type: row.type, status: row.status,
    rtLabel: row.rtName ? `${row.rtName} · ${row.rtCode}/${row.rwCode} · ${row.village}` : null,
    recovery: row.status !== "active" ? null : row.type === "resident" && row.householdActive === "active" && row.householdEndsOn === null && row.personActive
      ? "resident_pin" as const : row.type === "system_admin" && row.id !== active.appAccountId ? "admin_two_factor" as const : null,
  })) };
}
export type RecoverySearchResult = Awaited<ReturnType<typeof searchRecoveryAccounts>>;
export type RecoveryAccount = RecoverySearchResult["accounts"][number];
