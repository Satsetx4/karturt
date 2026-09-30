import type { AppDatabase } from "@/db/client";
import { auditEvents } from "@/db/schema";

export interface AppendAuditEventInput {
  actorAppAccountId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  context?: Record<string, unknown>;
}

export async function appendAuditEvent<TTransaction>(transaction: TTransaction, input: AppendAuditEventInput) {
  const action = input.action.trim();
  const entityType = input.entityType.trim();
  const entityId = input.entityId.trim();
  const reason = input.reason?.trim() || null;
  if (!action || !entityType || !entityId) throw new Error("Audit action and entity identity are required.");
  if (input.reason != null && !reason) throw new Error("Audit reason cannot be blank.");
  if (action.length > 120 || entityType.length > 80 || entityId.length > 160 || (reason?.length ?? 0) > 500) {
    throw new Error("Audit event fields exceed the supported length.");
  }

  const transactionalWriter = transaction as Pick<AppDatabase, "insert">;
  const [event] = await transactionalWriter
    .insert(auditEvents)
    .values({
      actorAppAccountId: input.actorAppAccountId,
      action,
      entityType,
      entityId,
      reason,
      context: input.context ?? {},
    })
    .returning({ id: auditEvents.id, occurredAt: auditEvents.occurredAt });
  return event;
}
