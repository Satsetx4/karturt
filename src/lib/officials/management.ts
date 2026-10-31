import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authSession, authUser, officialAssignments, rtUnits } from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { jakartaBusinessDate } from "./lifecycle";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const reason = z.string().trim().min(1).max(500).refine((value) => {
  try { return Boolean(normalizeAuditReason(value)); } catch { return false; }
});
export const officialMutationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("schedule"), accountId: z.uuid(), role: z.enum(["rt_chairman", "treasurer"]), startsOn: date, endsOn: date.nullable(), reason }).strict(),
  z.object({ operation: z.literal("end"), assignmentId: z.uuid(), endsOn: date, reason }).strict(),
  z.object({ operation: z.literal("handover"), assignmentId: z.uuid(), accountId: z.uuid(), startsOn: date, reason }).strict(),
]);
export type OfficialMutation = z.infer<typeof officialMutationSchema>;
export class OfficialForbiddenError extends Error {}
export class OfficialConflictError extends Error {}
export class OfficialNotFoundError extends Error {}

async function chairman(database: AppDatabase, principal: Principal, today: string) {
  if (!principal.rtUnitId || !canPerform(principal, "official:manage", { rtUnitId: principal.rtUnitId })) throw new OfficialForbiddenError();
  const active = await resolvePrincipalForUser(database, principal.authUserId, today);
  if (active.appAccountId !== principal.appAccountId || active.role !== "rt_chairman" || active.rtUnitId !== principal.rtUnitId) throw new OfficialForbiddenError();
  return principal.rtUnitId;
}

export async function listOfficials(database: AppDatabase, principal: Principal) {
  const today = jakartaBusinessDate();
  const rtUnitId = await chairman(database, principal, today);
  const accounts = await database.select({ id: appAccounts.id, name: authUser.name })
    .from(appAccounts).innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.accountType, "official"), eq(appAccounts.status, "active")))
    .orderBy(asc(authUser.name), asc(appAccounts.id)).limit(101);
  // A bounded list must not silently hide a target account from the operator.
  if (accounts.length > 100) throw new OfficialConflictError("Daftar akun melebihi batas. Hubungi pengelola sistem.");
  const rows = await database.select({ id: officialAssignments.id, accountId: officialAssignments.appAccountId,
    name: authUser.name, role: officialAssignments.role, startsOn: officialAssignments.startsOn, endsOn: officialAssignments.endsOn })
    .from(officialAssignments).innerJoin(appAccounts, eq(appAccounts.id, officialAssignments.appAccountId))
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .where(eq(officialAssignments.rtUnitId, rtUnitId))
    .orderBy(sql`case when ${officialAssignments.endsOn} is null or ${officialAssignments.endsOn} >= ${today}::date then 0 else 1 end`, desc(officialAssignments.startsOn), desc(officialAssignments.id)).limit(101);
  return { today, accounts, assignments: rows.slice(0, 100), hasMoreHistory: rows.length > 100 };
}
export type OfficialList = Awaited<ReturnType<typeof listOfficials>>;

export async function changeOfficial(database: AppDatabase, principal: Principal, input: OfficialMutation) {
  const value = officialMutationSchema.parse(input);
  const today = jakartaBusinessDate();
  const rtUnitId = await chairman(database, principal, today);
  return database.transaction(async (transaction) => {
    // Match the existing temporal trigger: serialize assignment changes per RT first.
    await transaction.select({ id: rtUnits.id }).from(rtUnits).where(eq(rtUnits.id, rtUnitId)).for("update");
    const accountIds = [principal.appAccountId, ...("accountId" in value ? [value.accountId] : [])].sort();
    await transaction.select({ id: appAccounts.id }).from(appAccounts)
      .where(and(eq(appAccounts.rtUnitId, rtUnitId), inArray(appAccounts.id, accountIds))).orderBy(asc(appAccounts.id)).for("update");
    await chairman(transaction as unknown as AppDatabase, principal, today);
    const assignments = await transaction.select().from(officialAssignments)
      .where(eq(officialAssignments.rtUnitId, rtUnitId)).orderBy(asc(officialAssignments.id)).for("update");
    let targetAccountId: string;
    let action: "official.assignment_created" | "official.assignment_ended" | "official.assignment_handover";
    let startsOn: string;
    let endsOn: string | null;
    let assignmentId: string;
    let role: "treasurer" | "rt_chairman";
    let previousAccountId: string | null = null;
    if (value.operation === "schedule") {
      targetAccountId = value.accountId; role = value.role; startsOn = value.startsOn; endsOn = value.endsOn;
      if (startsOn < today || (endsOn !== null && endsOn < startsOn)) throw new OfficialConflictError("Tanggal mulai harus hari ini atau setelahnya; akhir tidak boleh mendahului mulai.");
      const replay = assignments.find((row) => row.appAccountId === targetAccountId && row.role === role && row.startsOn === startsOn && row.endsOn === endsOn);
      if (replay) return { replay: true };
      assignmentId = crypto.randomUUID(); action = "official.assignment_created";
    } else {
      const old = assignments.find((row) => row.id === value.assignmentId);
      if (!old) throw new OfficialNotFoundError();
      role = old.role; assignmentId = old.id;
      if (value.operation === "end") {
        if (role === "rt_chairman") throw new OfficialConflictError("Gunakan pergantian Ketua agar penerus ditetapkan sekaligus.");
        if (value.endsOn < today || value.endsOn < old.startsOn || (old.endsOn !== null && value.endsOn > old.endsOn)) throw new OfficialConflictError("Tanggal akhir harus hari ini atau setelahnya dan hanya boleh memperpendek masa jabatan.");
        if (old.endsOn === value.endsOn) return { replay: true };
        targetAccountId = old.appAccountId; startsOn = old.startsOn; endsOn = value.endsOn;
        action = "official.assignment_ended";
      } else {
        const priorDate = new Date(`${value.startsOn}T00:00:00Z`);
        priorDate.setUTCDate(priorDate.getUTCDate() - 1);
        const priorEnd = priorDate.toISOString().slice(0, 10);
        if (value.startsOn <= today || value.startsOn <= old.startsOn || value.accountId === old.appAccountId || (old.endsOn !== null && old.endsOn < priorEnd)) throw new OfficialConflictError("Pergantian paling cepat besok, harus memakai akun berbeda, dan tidak boleh memperpanjang masa jabatan lama.");
        const replay = assignments.find((row) => row.appAccountId === value.accountId && row.role === role && row.startsOn === value.startsOn && row.endsOn === null);
        if (old.endsOn === priorEnd && replay) return { replay: true };
        if (old.endsOn !== null && old.endsOn < today) throw new OfficialConflictError("Jabatan yang sudah berakhir tidak dapat diganti.");
        await transaction.update(officialAssignments).set({ endsOn: priorEnd }).where(eq(officialAssignments.id, old.id));
        old.endsOn = priorEnd;
        previousAccountId = old.appAccountId;
        targetAccountId = value.accountId; startsOn = value.startsOn; endsOn = null;
        assignmentId = crypto.randomUUID(); action = "official.assignment_handover";
      }
    }
    const [target] = await transaction.select({ userId: appAccounts.authUserId }).from(appAccounts)
      .where(and(eq(appAccounts.id, targetAccountId), eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.accountType, "official"), value.operation === "end" ? undefined : eq(appAccounts.status, "active")));
    if (!target) throw new OfficialNotFoundError();
    const overlap = assignments.some((row) => row.id !== assignmentId && (row.role === role || row.appAccountId === targetAccountId)
      && (endsOn === null || row.startsOn <= endsOn) && (row.endsOn === null || row.endsOn >= startsOn));
    if (overlap) throw new OfficialConflictError("Jadwal bertumpang tindih dengan jabatan pada peran atau akun yang sama.");
    if (value.operation === "end") {
      await transaction.update(officialAssignments).set({ endsOn }).where(eq(officialAssignments.id, assignmentId));
    } else {
      await transaction.insert(officialAssignments).values({ id: assignmentId, rtUnitId, appAccountId: targetAccountId, role, startsOn, endsOn });
    }
    const affected = [targetAccountId, ...(previousAccountId ? [previousAccountId] : [])];
    const sessions = await transaction.delete(authSession).where(inArray(authSession.userId,
      transaction.select({ userId: appAccounts.authUserId }).from(appAccounts).where(and(eq(appAccounts.rtUnitId, rtUnitId), inArray(appAccounts.id, affected)))))
      .returning({ id: authSession.id });
    await appendAuditEvent(transaction, { actorAppAccountId: principal.appAccountId, action, entityType: "official_assignment", entityId: assignmentId,
      reason: value.reason, context: { startsOn, endsOn, role, targetAccountId, previousAccountId, revokedSessionCount: sessions.length } });
    return { replay: false };
  });
}
