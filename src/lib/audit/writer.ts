import type { AppDatabase } from "@/db/client";
import { auditEvents } from "@/db/schema";

export type AuditContextValue = string | number | boolean | null;
export type AuditContext = Readonly<Record<string, AuditContextValue>>;

export interface AppendAuditEventInput {
  actorAppAccountId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  context?: AuditContext;
}

type TransactionExecutor = { insert: unknown; rollback: () => never };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actionPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const entityTypePattern = /^[a-z][a-z0-9_]*$/;
const recoveryReferencePattern = /^[A-Z]{2,10}-\d{4}-\d{3,8}$/;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const indonesianPhonePattern = /\b(?:\+?62|0)8\d{7,11}\b/;
const credentialAssignmentPattern = /\b(?:password|passcode|pin|otp|totp|secret|token|api[_ -]?key|authorization|cookie|email|phone)\s*[:=]\s*[^\s,;]+/i;
const labeledCodePattern = /\b(?:pin|otp|totp|password|passcode)\s+(?:is\s+)?\d{4,12}\b/i;
const jwtPattern = /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/;

const recoveryActions = new Set([
  "resident.pin.structured_recovery",
  "system_admin.two_factor.emergency_recovery",
]);

function normalizeContext(action: string, context: AuditContext | undefined): AuditContext {
  const value = context ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Audit context must be a flat object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Audit context must be a plain object.");
  }

  const keys = Object.keys(value).sort();
  if (action === "payment_request.created") {
    if (keys.join(",") !== "itemCount,periods,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const periods = value.periods;
    const periodList = typeof periods === "string" ? periods.split(",") : [];
    if (
      periodList.length === 0 ||
      periodList.some((period) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) ||
      periodList.some((period, index) => index > 0 && periodList[index - 1] >= period)
    ) {
      throw new Error("Audit request periods must be canonical and ordered.");
    }
    const totalAmount = value.totalAmount;
    const itemCount = value.itemCount;
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit payment total must be a positive safe integer.");
    }
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount !== periodList.length) {
      throw new Error("Audit payment item count must match its periods.");
    }
    return { periods: periods as string, totalAmount, itemCount };
  }

  if (action === "payment_request.verified") {
    if (keys.join(",") !== "itemCount,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const itemCount = value.itemCount;
    const totalAmount = value.totalAmount;
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount <= 0) {
      throw new Error("Audit payment item count must be a positive safe integer.");
    }
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit payment total must be a positive safe integer.");
    }
    return { itemCount, totalAmount };
  }

  if (action === "payment_request.rejected" || action === "payment_request.cancelled") {
    if (keys.join(",") !== "itemCount,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const itemCount = value.itemCount;
    const totalAmount = value.totalAmount;
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount <= 0) {
      throw new Error("Audit payment item count must be a positive safe integer.");
    }
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit payment total must be a positive safe integer.");
    }
    return { itemCount, totalAmount };
  }

  if (action === "resident.pin.reset" || recoveryActions.has(action)) {
    if (keys.join(",") !== "recoveryReference,revokedSessionCount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const reference = value.recoveryReference;
    if (action === "resident.pin.reset") {
      if (reference !== null) throw new Error("Resident PIN reset context cannot include a recovery reference.");
    } else if (typeof reference !== "string" || !recoveryReferencePattern.test(reference)) {
      throw new Error("Audit recovery reference must use the approved reference format.");
    }

    const revokedSessionCount = value.revokedSessionCount;
    if (typeof revokedSessionCount !== "number" || !Number.isSafeInteger(revokedSessionCount) || revokedSessionCount < 0) {
      throw new Error("Audit session count must be a non-negative integer.");
    }

    return { recoveryReference: reference as string | null, revokedSessionCount };
  }

  if (keys.length > 0) {
    throw new Error("Audit context fields must be explicitly allowlisted for the action.");
  }
  return {};
}

function assertSafeReason(reason: string | null) {
  if (reason === null) return;
  if (emailPattern.test(reason) || indonesianPhonePattern.test(reason) || credentialAssignmentPattern.test(reason) || labeledCodePattern.test(reason) || jwtPattern.test(reason)) {
    throw new Error("Audit reason contains a credential or personal data value.");
  }
}

export function normalizeAuditReason(value: string | null | undefined) {
  const reason = value?.trim() || null;
  if (value != null && !reason) throw new Error("Audit reason cannot be blank.");
  if ((reason?.length ?? 0) > 500) throw new Error("Audit reason exceeds the supported length.");
  assertSafeReason(reason);
  return reason;
}

export async function appendAuditEvent<TTransaction extends TransactionExecutor>(
  transaction: TTransaction,
  input: AppendAuditEventInput,
) {
  const action = input.action.trim();
  const entityType = input.entityType.trim();
  const entityId = input.entityId.trim();
  const reason = normalizeAuditReason(input.reason);
  if (!action || !entityType || !entityId) throw new Error("Audit action and entity identity are required.");
  if (action.length > 120 || entityType.length > 80 || entityId.length > 160) {
    throw new Error("Audit event fields exceed the supported length.");
  }
  if (!uuidPattern.test(input.actorAppAccountId) || !uuidPattern.test(entityId)) {
    throw new Error("Audit actor and entity identifiers must be UUIDs.");
  }
  if (!actionPattern.test(action) || !entityTypePattern.test(entityType)) {
    throw new Error("Audit action and entity type must use canonical identifiers.");
  }
  const safeContext = normalizeContext(action, input.context);
  if (Buffer.byteLength(JSON.stringify(safeContext), "utf8") > 2048) {
    throw new Error("Audit context exceeds the supported size.");
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
      context: safeContext,
    })
    .returning({ id: auditEvents.id, occurredAt: auditEvents.occurredAt });
  return event;
}
