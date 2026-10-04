import { describe, expect, it, vi } from "vitest";
import { appendAuditEvent } from "../../src/lib/audit/writer";

const actorId = "00000000-0000-4000-8000-000000000001";
const householdId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";
const nextHouseholdId = "00000000-0000-4000-8000-000000000004";
const nextAccountId = "00000000-0000-4000-8000-000000000005";

function auditWriter() {
  const returning = vi.fn().mockResolvedValue([{ id: "event-id", occurredAt: new Date() }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { transaction: { insert } as never, insert, values };
}

describe("Phase 12 household audit contracts", () => {
  it("stores only canonical create metadata", async () => {
    const writer = auditWriter();
    await appendAuditEvent(writer.transaction, {
      actorAppAccountId: actorId,
      action: "household.created",
      entityType: "household",
      entityId: householdId,
      context: { createdResidentAccountId: accountId, generatedDueCount: 5, startsOn: "2026-11-01" },
    });

    expect(writer.values).toHaveBeenCalledWith({
      actorAppAccountId: actorId,
      action: "household.created",
      entityType: "household",
      entityId: householdId,
      reason: null,
      context: { createdResidentAccountId: accountId, generatedDueCount: 5, startsOn: "2026-11-01" },
    });
  });

  it("accepts only canonical changed-field names", async () => {
    const writer = auditWriter();
    await appendAuditEvent(writer.transaction, {
      actorAppAccountId: actorId,
      action: "household.updated",
      entityType: "household",
      entityId: householdId,
      context: { changedFields: "fullName,phone" },
    });

    await expect(appendAuditEvent(writer.transaction, {
      actorAppAccountId: actorId,
      action: "household.updated",
      entityType: "household",
      entityId: householdId,
      context: { changedFields: "phone,fullName" },
    })).rejects.toThrow("not canonical");
    await expect(appendAuditEvent(writer.transaction, {
      actorAppAccountId: actorId,
      action: "household.updated",
      entityType: "household",
      entityId: householdId,
      context: { changedFields: "phone=081234567890" },
    })).rejects.toThrow("not canonical");
  });

  it("requires a reason and validates deactivation counts and date", async () => {
    const writer = auditWriter();
    const input = {
      actorAppAccountId: actorId,
      action: "household.deactivated",
      entityType: "household",
      entityId: householdId,
      reason: "Pindah domisili",
      context: {
        disabledAccountCount: 1,
        effectiveEndDate: "2026-11-30",
        revokedSessionCount: 2,
        transitionedDueCount: 3,
      },
    } as const;
    await appendAuditEvent(writer.transaction, input);

    await expect(appendAuditEvent(writer.transaction, { ...input, reason: null })).rejects.toThrow("mandatory reason");
    await expect(appendAuditEvent(writer.transaction, {
      ...input,
      context: { ...input.context, effectiveEndDate: "2026-02-30" },
    })).rejects.toThrow("date is invalid");
    await expect(appendAuditEvent(writer.transaction, {
      ...input,
      context: { ...input.context, transitionedDueCount: -1 },
    })).rejects.toThrow("non-negative integers");
  });

  it("requires replacement account and household IDs while omitting secrets", async () => {
    const writer = auditWriter();
    const input = {
      actorAppAccountId: actorId,
      action: "household.resident_replaced",
      entityType: "household",
      entityId: householdId,
      reason: "Pergantian penghuni",
      context: {
        effectiveDate: "2027-01-01",
        newAccountId: nextAccountId,
        newHouseholdId: nextHouseholdId,
        oldAccountId: accountId,
        oldHouseholdId: householdId,
        revokedSessionCount: 1,
        transitionedDueCount: 2,
      },
    } as const;
    await appendAuditEvent(writer.transaction, input);

    const stored = writer.values.mock.calls[0]?.[0];
    expect(JSON.stringify(stored)).not.toMatch(/pin|password|hash|token/i);
    await expect(appendAuditEvent(writer.transaction, {
      ...input,
      context: { ...input.context, newAccountId: "not-a-uuid" },
    })).rejects.toThrow("must be UUIDs");
  });
});
