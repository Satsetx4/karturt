import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { AppDatabase } from "@/db/client";
import { appAccounts, auditEvents, authUser, sheet2ImportBatches } from "@/db/schema";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";

export const auditActions = {
  "official.assignment_created": "Jabatan pengurus dijadwalkan",
  "official.assignment_ended": "Masa jabatan pengurus diakhiri",
  "official.assignment_handover": "Pergantian pengurus dijadwalkan",
  "payment_request.created": "Permintaan pembayaran dibuat",
  "payment_request.verified": "Pembayaran transfer diverifikasi",
  "payment_request.rejected": "Permintaan pembayaran ditolak",
  "payment_request.cancelled": "Permintaan pembayaran dibatalkan",
  "payment.cash_recorded": "Pembayaran tunai dicatat",
  "payment.reversed": "Pembayaran dibatalkan",
  "fee_rate.created": "Tarif iuran dijadwalkan",
  "billing.adjustment_created": "Kewajiban iuran disesuaikan",
  "billing.sheet2_opening_balance_imported": "Saldo awal dicatat",
  "waiver.created": "Pemutihan iuran dicatat",
  "household.created": "Rumah tangga ditambahkan",
  "household.updated": "Data rumah tangga diperbarui",
  "household.deactivated": "Masa tinggal diakhiri",
  "household.resident_replaced": "Penghuni rumah diganti",
  "account.password.changed": "Password akun diganti",
  "account.pin.changed": "PIN akun diganti",
  "account.pin.recovered": "PIN akun dipulihkan",
  "resident.pin.reset": "PIN warga diatur ulang",
  "resident.pin.structured_recovery": "Akses warga dipulihkan",
  "system_admin.two_factor.emergency_recovery": "Verifikasi dua langkah dipulihkan",
  "preview.synthetic_credential.rekeyed": "Akses akun uji diperbarui",
} as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const cursor = z.string().max(100).refine((value) => {
  const [time, id, extra] = value.split("|");
  return !extra && z.iso.datetime().safeParse(time).success && z.uuid().safeParse(id).success;
});
export const auditFilterSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  action: z.enum(Object.keys(auditActions) as [keyof typeof auditActions, ...(keyof typeof auditActions)[]]).optional(),
  before: cursor.optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to);
export type AuditFilters = z.infer<typeof auditFilterSchema>;
export class AuditForbiddenError extends Error {}

export async function readAuditEvents(database: AppDatabase, principal: Principal, input: AuditFilters = {}) {
  const filters = auditFilterSchema.parse(input);
  // Recheck stored account, assignment and MFA rather than trusting a caller's role/RT.
  const active = await resolvePrincipalForUser(database, principal.authUserId);
  if (active.appAccountId !== principal.appAccountId || active.role !== principal.role ||
      active.rtUnitId !== principal.rtUnitId ||
      !canPerform(active, "audit:read", active.rtUnitId ? { rtUnitId: active.rtUnitId } : undefined)) {
    throw new AuditForbiddenError();
  }
  const target = alias(appAccounts, "audit_target");
  const conditions = [];
  if (active.role === "rt_chairman" && active.rtUnitId) {
    conditions.push(or(eq(appAccounts.rtUnitId, active.rtUnitId), eq(target.rtUnitId, active.rtUnitId),
      eq(sheet2ImportBatches.rtUnitId, active.rtUnitId))!);
  } else if (active.role !== "system_admin") {
    throw new AuditForbiddenError();
  }
  if (filters.from) conditions.push(gte(auditEvents.occurredAt, new Date(`${filters.from}T00:00:00+07:00`)));
  if (filters.to) conditions.push(lt(auditEvents.occurredAt, sql`(${filters.to}::date + interval '1 day') at time zone 'Asia/Jakarta'`));
  if (filters.action) conditions.push(eq(auditEvents.action, filters.action));
  if (filters.before) {
    const [time, id] = filters.before.split("|");
    const exactTime = sql`${time}::timestamptz`;
    conditions.push(or(lt(auditEvents.occurredAt, exactTime),
      and(eq(auditEvents.occurredAt, exactTime), lt(auditEvents.id, id!)))!);
  }
  const rows = await database.select({ id: auditEvents.id, occurredAt: auditEvents.occurredAt,
    action: auditEvents.action, actorName: authUser.name,
    cursorTime: sql<string>`to_char(${auditEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(auditEvents)
    .innerJoin(appAccounts, eq(appAccounts.id, auditEvents.actorAppAccountId))
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .leftJoin(target, and(inArray(auditEvents.entityType, ["resident_account", "account_pin", "account_credential", "system_admin_account"]),
      eq(sql`${target.id}::text`, auditEvents.entityId)))
    .leftJoin(sheet2ImportBatches, and(eq(auditEvents.entityType, "sheet2_import_batch"),
      eq(sql`${sheet2ImportBatches.id}::text`, auditEvents.entityId)))
    .where(and(...conditions))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id)).limit(26);
  const visible = rows.slice(0, 25);
  const last = visible.at(-1);
  return {
    events: visible.map((row) => ({ id: row.id, occurredAt: row.occurredAt.toISOString(), actorName: row.actorName,
      label: auditActions[row.action as keyof typeof auditActions] ?? "Aktivitas lainnya" })),
    next: rows.length > 25 && last ? `${last.cursorTime}|${last.id}` : null,
  };
}
