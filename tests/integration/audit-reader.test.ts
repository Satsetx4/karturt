import { randomUUID } from "node:crypto";
import { eq, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts, auditEvents, authTwoFactor, authUser, officialAssignments } from "@/db/schema";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { auditFilterSchema, readAuditEvents } from "@/lib/audit/reader";
import { createAuthUser, createHousehold, createRt, createTestDatabase, ensureTestChairman } from "../helpers/database";

describe("read-only audit viewer", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;
  beforeAll(async () => { fixture = await createTestDatabase(); database = fixture.db as unknown as AppDatabase; });
  afterAll(async () => { await fixture.close(); });

  async function chairman() {
    const rtUnitId = await createRt(fixture.db);
    const accountId = await ensureTestChairman(fixture.db, rtUnitId);
    const [account] = await fixture.db.select().from(appAccounts).where(eq(appAccounts.id, accountId));
    const principal = await resolvePrincipalForUser(database, account!.authUserId);
    return { principal, rtUnitId, accountId };
  }
  async function admin() {
    const user = await createAuthUser(fixture.db);
    await fixture.db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, user.id));
    await fixture.db.insert(authTwoFactor).values({ id: randomUUID(), userId: user.id, verified: true,
      secret: randomUUID(), backupCodes: randomUUID() });
    const [account] = await fixture.db.insert(appAccounts).values({ authUserId: user.id, accountType: "system_admin", loginIdentifier: randomUUID() }).returning();
    return { principal: await resolvePrincipalForUser(database, user.id), accountId: account!.id };
  }
  async function event(actor: string, overrides: Omit<Partial<typeof auditEvents.$inferInsert>, "occurredAt"> & { occurredAt?: Date | SQL } = {}) {
    const [row] = await fixture.db.insert(auditEvents).values({ actorAppAccountId: actor, action: "household.updated", entityType: "household", entityId: randomUUID(), ...overrides }).returning();
    return row!;
  }

  it("scopes Chairman events to their RT and includes Admin recovery of a same-RT account without exposing raw context or reason", async () => {
    const own = await chairman(); const other = await chairman(); const system = await admin();
    const household = await createHousehold(fixture.db, own.rtUnitId);
    const user = await createAuthUser(fixture.db);
    const [resident] = await fixture.db.insert(appAccounts).values({ accountType: "resident", authUserId: user.id,
      rtUnitId: own.rtUnitId, householdId: household.householdId, personId: household.personId, loginIdentifier: randomUUID() }).returning();
    const ownEvent = await event(own.accountId, { context: { privateValue: "never-return-this" }, reason: "private reason" });
    const recovery = await event(system.accountId, { action: "resident.pin.structured_recovery", entityType: "resident_account", entityId: resident!.id });
    await event(other.accountId); await event(system.accountId, { entityType: "resident_account", entityId: other.accountId });
    const before = await fixture.db.select().from(auditEvents);
    const result = await readAuditEvents(database, own.principal);
    expect(result.events.map((row) => row.id).sort()).toEqual([ownEvent.id, recovery.id].sort());
    expect(JSON.stringify(result)).not.toMatch(/privateValue|never-return-this|private reason|context|entityId/);
    expect(await fixture.db.select().from(auditEvents)).toEqual(before);
    const adminResult = await readAuditEvents(database, system.principal);
    expect(adminResult.events.some((row) => row.id === recovery.id)).toBe(true);
  });

  it("uses Jakarta date boundaries and exact activity filters", async () => {
    const own = await chairman();
    await event(own.accountId, { occurredAt: new Date("2026-10-30T16:59:59.999Z") });
    const selected = await event(own.accountId, { occurredAt: new Date("2026-10-30T17:00:00Z") });
    const late = await event(own.accountId, { occurredAt: sql`'2026-10-31T16:59:59.999999Z'::timestamptz` });
    await event(own.accountId, { occurredAt: new Date("2026-10-31T17:00:00Z") });
    await event(own.accountId, { action: "payment.cash_recorded", occurredAt: new Date("2026-10-31T10:00:00Z") });
    const result = await readAuditEvents(database, own.principal, { from: "2026-10-31", to: "2026-10-31", action: "household.updated" });
    expect(result.events.map((row) => row.id)).toEqual([late.id, selected.id]);
  });

  it("paginates equal timestamps at database microsecond precision, including after a new event arrives", async () => {
    const own = await chairman();
    for (let i = 0; i < 30; i++) await event(own.accountId, { occurredAt: sql`'2026-10-31T08:00:00.123456Z'::timestamptz` });
    const first = await readAuditEvents(database, own.principal);
    expect(first.events).toHaveLength(25); expect(first.next).toContain(".123456Z|");
    await event(own.accountId, { occurredAt: new Date("2026-11-01T00:00:00Z") });
    const second = await readAuditEvents(database, own.principal, { before: first.next! });
    expect(second.events).toHaveLength(5); expect(second.next).toBeNull();
    expect(new Set([...first.events, ...second.events].map((row) => row.id)).size).toBe(30);
  });

  it("denies forged RT/role, disabled accounts, ended assignments and unverified Admin MFA", async () => {
    const own = await chairman(); const other = await chairman();
    await expect(readAuditEvents(database, { ...own.principal, rtUnitId: other.rtUnitId })).rejects.toThrow();
    await expect(readAuditEvents(database, { ...own.principal, role: "system_admin" })).rejects.toThrow();
    await fixture.db.update(officialAssignments).set({ endsOn: "2020-01-02" }).where(eq(officialAssignments.appAccountId, own.accountId));
    await expect(readAuditEvents(database, own.principal)).rejects.toThrow();
    await fixture.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, other.accountId));
    await expect(readAuditEvents(database, other.principal)).rejects.toThrow();
    const system = await admin();
    await fixture.db.update(authTwoFactor).set({ verified: false }).where(eq(authTwoFactor.userId, system.principal.authUserId));
    await expect(readAuditEvents(database, system.principal)).rejects.toThrow();
  });

  it("denies a real Treasurer and a real Resident", async () => {
    const own = await chairman();
    const household = await createHousehold(fixture.db, own.rtUnitId);
    for (const accountType of ["official", "resident"] as const) {
      const user = await createAuthUser(fixture.db);
      const [account] = await fixture.db.insert(appAccounts).values({ accountType, authUserId: user.id,
        rtUnitId: own.rtUnitId, personId: household.personId, householdId: accountType === "resident" ? household.householdId : null,
        loginIdentifier: randomUUID() }).returning();
      if (accountType === "official") await fixture.db.insert(officialAssignments).values({ rtUnitId: own.rtUnitId, appAccountId: account!.id, role: "treasurer", startsOn: "2020-01-01" });
      const principal = await resolvePrincipalForUser(database, user.id);
      await expect(readAuditEvents(database, principal)).rejects.toThrow();
    }
  });

  it("rejects invalid dates, unknown filters/actions, and malformed cursors", () => {
    for (const filter of [{ from: "2026-02-30" }, { from: "2026-11-01", to: "2026-10-01" },
      { rtUnitId: randomUUID() }, { action: "unknown" }, { before: "invalid" }]) {
      expect(auditFilterSchema.safeParse(filter).success).toBe(false);
    }
  });
});
