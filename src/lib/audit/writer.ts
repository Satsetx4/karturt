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

function assertContextKeys(keys: string[], expected: string) {
  if (keys.join(",") !== expected) {
    throw new Error("Audit context fields do not match the action contract.");
  }
}

function assertAuditDate(value: AuditContextValue | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Audit lifecycle date must use YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Audit lifecycle date is invalid.");
  }
}

function assertAuditUuid(value: AuditContextValue | undefined) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("Audit lifecycle identifiers must be UUIDs.");
  }
}

function assertAuditCount(value: AuditContextValue | undefined) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Audit lifecycle counts must be non-negative integers.");
  }
}

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

  if (action === "payment.cash_recorded") {
    if (keys.join(",") !== "itemCount,method,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const itemCount = value.itemCount;
    const method = value.method;
    const totalAmount = value.totalAmount;
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount <= 0) {
      throw new Error("Audit payment item count must be a positive safe integer.");
    }
    if (method !== "cash") throw new Error("Cash payment audit method must be cash.");
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit payment total must be a positive safe integer.");
    }
    return { itemCount, method, totalAmount };
  }

  if (action === "payment.reversed") {
    if (keys.join(",") !== "itemCount,method,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const itemCount = value.itemCount;
    const method = value.method;
    const totalAmount = value.totalAmount;
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount <= 0) {
      throw new Error("Audit payment item count must be a positive safe integer.");
    }
    if (method !== "cash" && method !== "transfer") {
      throw new Error("Reversal audit method must be cash or transfer.");
    }
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit payment total must be a positive safe integer.");
    }
    return { itemCount, method, totalAmount };
  }

  if (action === "fee_rate.created") {
    if (keys.join(",") !== "monthlyAmount,period") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const period = value.period;
    const monthlyAmount = value.monthlyAmount;
    if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new Error("Tariff audit period must be canonical.");
    }
    if (typeof monthlyAmount !== "number" || !Number.isSafeInteger(monthlyAmount) || monthlyAmount <= 0) {
      throw new Error("Tariff audit amount must be a positive safe integer.");
    }
    return { period, monthlyAmount };
  }

  if (action === "billing.adjustment_created") {
    if (keys.join(",") !== "amountDelta,effectiveTargetAfter,originalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const amountDelta = value.amountDelta;
    const effectiveTargetAfter = value.effectiveTargetAfter;
    const originalAmount = value.originalAmount;
    if (typeof amountDelta !== "number" || !Number.isSafeInteger(amountDelta) || amountDelta === 0) {
      throw new Error("Adjustment audit delta must be a nonzero safe integer.");
    }
    if (typeof effectiveTargetAfter !== "number" || !Number.isSafeInteger(effectiveTargetAfter) || effectiveTargetAfter <= 0) {
      throw new Error("Adjustment audit target must be a positive safe integer.");
    }
    if (typeof originalAmount !== "number" || !Number.isSafeInteger(originalAmount) || originalAmount <= 0) {
      throw new Error("Adjustment audit original amount must be a positive safe integer.");
    }
    return { amountDelta, effectiveTargetAfter, originalAmount };
  }

  if (action === "household.created") {
    assertContextKeys(keys, "createdResidentAccountId,generatedDueCount,startsOn");
    assertAuditUuid(value.createdResidentAccountId);
    assertAuditCount(value.generatedDueCount);
    assertAuditDate(value.startsOn);
    return {
      createdResidentAccountId: value.createdResidentAccountId as string,
      generatedDueCount: value.generatedDueCount as number,
      startsOn: value.startsOn as string,
    };
  }

  if (action === "household.updated") {
    assertContextKeys(keys, "changedFields");
    const fields = value.changedFields;
    const allowed = new Set(["fullName", "houseLabel", "phone"]);
    const parsed = typeof fields === "string" ? fields.split(",") : [];
    if (
      parsed.length === 0 ||
      parsed.some((field) => !allowed.has(field)) ||
      parsed.some((field, index) => index > 0 && parsed[index - 1] >= field)
    ) {
      throw new Error("Household update audit fields are not canonical.");
    }
    return { changedFields: fields as string };
  }

  if (action === "household.deactivated") {
    assertContextKeys(keys, "disabledAccountCount,effectiveEndDate,revokedSessionCount,transitionedDueCount");
    assertAuditCount(value.disabledAccountCount);
    assertAuditDate(value.effectiveEndDate);
    assertAuditCount(value.revokedSessionCount);
    assertAuditCount(value.transitionedDueCount);
    return {
      disabledAccountCount: value.disabledAccountCount as number,
      effectiveEndDate: value.effectiveEndDate as string,
      revokedSessionCount: value.revokedSessionCount as number,
      transitionedDueCount: value.transitionedDueCount as number,
    };
  }

  if (action === "household.resident_replaced") {
    assertContextKeys(keys, "effectiveDate,newAccountId,newHouseholdId,oldAccountId,oldHouseholdId,revokedSessionCount,transitionedDueCount");
    assertAuditDate(value.effectiveDate);
    assertAuditUuid(value.newAccountId);
    assertAuditUuid(value.newHouseholdId);
    assertAuditUuid(value.oldAccountId);
    assertAuditUuid(value.oldHouseholdId);
    assertAuditCount(value.revokedSessionCount);
    assertAuditCount(value.transitionedDueCount);
    return {
      effectiveDate: value.effectiveDate as string,
      newAccountId: value.newAccountId as string,
      newHouseholdId: value.newHouseholdId as string,
      oldAccountId: value.oldAccountId as string,
      oldHouseholdId: value.oldHouseholdId as string,
      revokedSessionCount: value.revokedSessionCount as number,
      transitionedDueCount: value.transitionedDueCount as number,
    };
  }

  if (action === "waiver.created") {
    if (keys.join(",") !== "itemCount,periods,totalAmount") {
      throw new Error("Audit context fields do not match the action contract.");
    }
    const itemCount = value.itemCount;
    const periods = value.periods;
    const totalAmount = value.totalAmount;
    const periodList = typeof periods === "string" ? periods.split(",") : [];
    if (
      periodList.length === 0 ||
      periodList.some((period) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) ||
      periodList.some((period, index) => index > 0 && periodList[index - 1] >= period)
    ) {
      throw new Error("Audit waiver periods must be canonical and ordered.");
    }
    if (typeof itemCount !== "number" || !Number.isSafeInteger(itemCount) || itemCount !== periodList.length) {
      throw new Error("Audit waiver item count must match its periods.");
    }
    if (typeof totalAmount !== "number" || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new Error("Audit waiver total must be a positive safe integer.");
    }
    return { itemCount, periods: periods as string, totalAmount };
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
  if (action === "payment.cash_recorded" && (entityType !== "payment" || reason !== null)) {
    throw new Error("Cash payment audit requires a payment entity and no reason.");
  }
  if (action === "payment.reversed" && (entityType !== "payment" || reason === null)) {
    throw new Error("Payment reversal audit requires a payment entity and a reason.");
  }
  if (action === "waiver.created" && (entityType !== "waiver_action" || reason === null)) {
    throw new Error("Waiver audit requires a waiver action entity and a reason.");
  }
  if (action === "fee_rate.created" && (entityType !== "fee_rate" || reason !== null)) {
    throw new Error("Tariff creation audit requires a fee rate entity and no reason.");
  }
  if (action === "billing.adjustment_created" && (entityType !== "due_adjustment" || reason === null)) {
    throw new Error("Adjustment audit requires a due adjustment entity and a mandatory reason.");
  }
  if (
    (action === "household.created" || action === "household.updated") &&
    (entityType !== "household" || reason !== null)
  ) {
    throw new Error("Household create and update audits require a household entity and no reason.");
  }
  if (
    (action === "household.deactivated" || action === "household.resident_replaced") &&
    (entityType !== "household" || reason === null)
  ) {
    throw new Error("Household lifecycle audits require a household entity and a mandatory reason.");
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
