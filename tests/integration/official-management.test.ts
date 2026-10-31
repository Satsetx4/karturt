import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appAccounts, auditEvents, authSession, officialAssignments } from "@/db/schema";
import { changeOfficial, listOfficials, OfficialConflictError, OfficialForbiddenError, OfficialNotFoundError } from "@/lib/officials/management";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import * as audit from "@/lib/audit/writer";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";
vi.mock("@/lib/officials/lifecycle", async (original) => ({ ...await original<typeof import("@/lib/officials/lifecycle")>(), jakartaBusinessDate: () => "2026-10-31" }));

describe("Chairman official lifecycle", () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => { test = await createTestDatabase(); });
  afterAll(async () => { await test.close(); });
  const db = () => test.db as never;
  async function official(rt: string) {
    const person = await createHousehold(test.db, rt);
    const user = await createAuthUser(test.db);
    const [account] = await test.db.insert(appAccounts).values({ rtUnitId: rt, authUserId: user.id, accountType: "official", loginIdentifier: randomUUID(), personId: person.personId }).returning();
    return account;
  }
  async function fixture() {
    const rt = await createRt(test.db);
    const chair = await official(rt);
    const target = await official(rt);
    const [assignment] = await test.db.insert(officialAssignments).values({ rtUnitId: rt, appAccountId: chair.id, role: "rt_chairman", startsOn: "2026-01-01" }).returning();
    const principal = await resolvePrincipalForUser(db(), chair.authUserId, "2026-10-31");
    return { rt, chair, target, assignment, principal };
  }
  async function session(userId: string) {
    await test.db.insert(authSession).values({ id: randomUUID(), token: randomUUID(), userId, expiresAt: new Date("2027-01-01") });
  }
  it("creates a future assignment, revokes sessions and writes one redacted audit; exact retry is a no-op", async () => {
    const f = await fixture(); await session(f.target.authUserId);
    const input = { operation: "schedule", accountId: f.target.id, role: "treasurer", startsOn: "2026-11-01", endsOn: null, reason: "Penetapan pengurus" } as const;
    expect(await changeOfficial(db(), f.principal, input)).toEqual({ replay: false });
    expect(await changeOfficial(db(), f.principal, input)).toEqual({ replay: true });
    expect(await test.db.select().from(authSession).where(eq(authSession.userId, f.target.authUserId))).toHaveLength(0);
    const events = await test.db.select().from(auditEvents).where(eq(auditEvents.actorAppAccountId, f.chair.id));
    expect(events).toHaveLength(1); expect(events[0].context).toMatchObject({ revokedSessionCount: 1, targetAccountId: f.target.id });
    await expect(resolvePrincipalForUser(db(), f.target.authUserId, "2026-10-31")).rejects.toThrow();
    await expect(resolvePrincipalForUser(db(), f.target.authUserId, "2026-11-01")).resolves.toMatchObject({ role: "treasurer" });
  });
  it("atomically hands the Chairman role to a successor on the next day and preserves both historical rows", async () => {
    const f = await fixture(); await session(f.chair.authUserId); await session(f.target.authUserId);
    const input = { operation: "handover", assignmentId: f.assignment.id, accountId: f.target.id, startsOn: "2026-11-01", reason: "Serah terima pengurus" } as const;
    expect(await changeOfficial(db(), f.principal, input)).toEqual({ replay: false });
    expect(await changeOfficial(db(), f.principal, input)).toEqual({ replay: true });
    const rows = await test.db.select().from(officialAssignments).where(eq(officialAssignments.rtUnitId, f.rt));
    expect(rows).toHaveLength(2); expect(rows.find((r) => r.id === f.assignment.id)?.endsOn).toBe("2026-10-31");
    await expect(resolvePrincipalForUser(db(), f.chair.authUserId, "2026-10-31")).resolves.toMatchObject({ role: "rt_chairman" });
    await expect(resolvePrincipalForUser(db(), f.chair.authUserId, "2026-11-01")).rejects.toThrow();
    await expect(resolvePrincipalForUser(db(), f.target.authUserId, "2026-11-01")).resolves.toMatchObject({ role: "rt_chairman" });
    expect(await test.db.select().from(authSession).where(eq(authSession.userId, f.chair.authUserId))).toHaveLength(0);
  });
  it("ends a Treasurer inclusively, never deletes the assignment and rejects extending or backdating", async () => {
    const f = await fixture();
    const [a] = await test.db.insert(officialAssignments).values({ rtUnitId: f.rt, appAccountId: f.target.id, role: "treasurer", startsOn: "2026-01-01" }).returning();
    await changeOfficial(db(), f.principal, { operation: "end", assignmentId: a.id, endsOn: "2026-10-31", reason: "Akhir masa jabatan" });
    await expect(resolvePrincipalForUser(db(), f.target.authUserId, "2026-10-31")).resolves.toMatchObject({ role: "treasurer" });
    await expect(resolvePrincipalForUser(db(), f.target.authUserId, "2026-11-01")).rejects.toThrow();
    for (const endsOn of ["2026-10-30", "2026-11-01"]) await expect(changeOfficial(db(), f.principal, { operation: "end", assignmentId: a.id, endsOn, reason: "Akhir masa jabatan" })).rejects.toBeInstanceOf(OfficialConflictError);
  });
  it("denies cross-RT targets and assignments without changing the old term", async () => {
    const f = await fixture(); const other = await fixture();
    await expect(changeOfficial(db(), f.principal, { operation: "handover", assignmentId: f.assignment.id, accountId: other.target.id, startsOn: "2026-11-01", reason: "Serah terima" })).rejects.toBeInstanceOf(OfficialNotFoundError);
    await expect(changeOfficial(db(), f.principal, { operation: "end", assignmentId: other.assignment.id, endsOn: "2026-11-01", reason: "Akhir jabatan" })).rejects.toBeInstanceOf(OfficialNotFoundError);
    const [a] = await test.db.select().from(officialAssignments).where(eq(officialAssignments.id, f.assignment.id)); expect(a.endsOn).toBeNull();
    const list = await listOfficials(db(), f.principal); expect(list.accounts.some((a) => a.id === other.target.id)).toBe(false);
  });
  it("denies forged roles, disabled Chairman and non-Chairman roles", async () => {
    const f = await fixture();
    for (const role of ["resident", "treasurer", "system_admin"] as const) await expect(listOfficials(db(), { ...f.principal, role })).rejects.toBeInstanceOf(OfficialForbiddenError);
    await expect(listOfficials(db(), { ...f.principal, authUserId: f.target.authUserId })).rejects.toThrow();
    await test.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, f.chair.id));
    await expect(listOfficials(db(), f.principal)).rejects.toThrow();
  });
  it("rejects overlapping role/account periods and invalid dates, leaving no audit", async () => {
    const f = await fixture();
    await expect(changeOfficial(db(), f.principal, { operation: "schedule", accountId: f.target.id, role: "rt_chairman", startsOn: "2026-11-01", endsOn: null, reason: "Penetapan pengurus" })).rejects.toBeInstanceOf(OfficialConflictError);
    for (const startsOn of ["2026-10-30", "2026-02-30"]) await expect(changeOfficial(db(), f.principal, { operation: "schedule", accountId: f.target.id, role: "treasurer", startsOn, endsOn: null, reason: "Penetapan pengurus" })).rejects.toThrow();
    expect(await test.db.select().from(auditEvents).where(eq(auditEvents.actorAppAccountId, f.chair.id))).toHaveLength(0);
  });
  it("requires a successor for ending a Chairman, and a different account for handover", async () => {
    const f = await fixture();
    await expect(changeOfficial(db(), f.principal, { operation: "end", assignmentId: f.assignment.id, endsOn: "2026-11-01", reason: "Akhir jabatan" })).rejects.toBeInstanceOf(OfficialConflictError);
    await expect(changeOfficial(db(), f.principal, { operation: "handover", assignmentId: f.assignment.id, accountId: f.chair.id, startsOn: "2026-11-01", reason: "Serah terima" })).rejects.toBeInstanceOf(OfficialConflictError);
  });
  it("does not hand a Chairman role to an account holding an overlapping Treasurer term", async () => {
    const f = await fixture();
    await test.db.insert(officialAssignments).values({ rtUnitId: f.rt, appAccountId: f.target.id, role: "treasurer", startsOn: "2026-01-01" });
    await expect(changeOfficial(db(), f.principal, { operation: "handover", assignmentId: f.assignment.id, accountId: f.target.id, startsOn: "2026-11-01", reason: "Serah terima" })).rejects.toBeInstanceOf(OfficialConflictError);
    const [old] = await test.db.select().from(officialAssignments).where(eq(officialAssignments.id, f.assignment.id)); expect(old.endsOn).toBeNull();
  });
  it("denies inactive targets and sensitive/extra input without mutating terms", async () => {
    const f = await fixture();
    const input = { operation: "schedule", accountId: f.target.id, role: "treasurer", startsOn: "2026-11-01", endsOn: null, reason: "Penetapan pengurus" } as const;
    for (const extra of [{ reason: "PIN=123456" }, { rtUnitId: f.rt }]) await expect(changeOfficial(db(), f.principal, { ...input, ...extra })).rejects.toThrow();
    await test.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, f.target.id));
    await expect(changeOfficial(db(), f.principal, input)).rejects.toBeInstanceOf(OfficialNotFoundError);
  });
  it("rolls back term, successor and session deletion when transactional audit fails", async () => {
    const f = await fixture(); await session(f.target.authUserId);
    const spy = vi.spyOn(audit, "appendAuditEvent").mockRejectedValueOnce(new Error("Synthetic audit failure"));
    try { await expect(changeOfficial(db(), f.principal, { operation: "handover", assignmentId: f.assignment.id, accountId: f.target.id, startsOn: "2026-11-01", reason: "Serah terima" })).rejects.toThrow("Synthetic audit failure"); } finally { spy.mockRestore(); }
    const rows = await test.db.select().from(officialAssignments).where(eq(officialAssignments.rtUnitId, f.rt)); expect(rows).toHaveLength(1); expect(rows[0].endsOn).toBeNull();
    expect(await test.db.select().from(authSession).where(eq(authSession.userId, f.target.authUserId))).toHaveLength(1);
  });
});
