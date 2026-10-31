import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appAccounts, auditEvents, authTwoFactor, authUser, households } from "@/db/schema";
import { searchRecoveryAccounts, RecoveryDirectoryForbiddenError } from "@/lib/accounts/recovery-directory";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("verified-admin recovery account directory", () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => { test = await createTestDatabase(); }); afterAll(async () => { await test.close(); });
  const db = () => test.db as never;
  async function admin() {
    const user = await createAuthUser(test.db);
    await test.db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, user.id));
    await test.db.insert(authTwoFactor).values({ id: randomUUID(), userId: user.id, secret: "synthetic-encrypted-factor", backupCodes: "synthetic-encrypted-codes", verified: true });
    const [account] = await test.db.insert(appAccounts).values({ accountType: "system_admin", authUserId: user.id, loginIdentifier: randomUUID() }).returning();
    const principal = await resolvePrincipalForUser(db(), user.id); return { user, account, principal };
  }
  async function resident(loginIdentifier: string) {
    const rt = await createRt(test.db); const household = await createHousehold(test.db, rt); const user = await createAuthUser(test.db);
    const [account] = await test.db.insert(appAccounts).values({ rtUnitId: rt, authUserId: user.id, accountType: "resident", loginIdentifier, householdId: household.householdId, personId: household.personId }).returning();
    return { rt, household, user, account };
  }
  it("uses exact case-insensitive identifiers and distinguishes matching accounts in separate RTs without exporting credential/contact fields", async () => {
    const actor = await admin(); const query = `S-${randomUUID().slice(0, 8)}`;
    const first = await resident(query); const second = await resident(query);
    const before = await test.db.select().from(auditEvents);
    const result = await searchRecoveryAccounts(db(), actor.principal, { query: query.toLowerCase() });
    expect(result.accounts).toHaveLength(2); expect(result.hasMore).toBe(false);
    expect(result.accounts.map((row) => row.id).sort()).toEqual([first.account.id, second.account.id].sort());
    expect(new Set(result.accounts.map((row) => row.rtLabel)).size).toBe(2);
    expect(result.accounts.every((row) => row.recovery === "resident_pin")).toBe(true);
    expect(Object.keys(result.accounts[0]).sort()).toEqual(["id", "name", "loginIdentifier", "type", "status", "rtLabel", "recovery"].sort());
    expect(JSON.stringify(result)).not.toContain("accounts.test.invalid"); expect(JSON.stringify(result)).not.toContain("synthetic-encrypted");
    expect(await test.db.select().from(auditEvents)).toEqual(before);
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: query.slice(0, 3) })).accounts).toHaveLength(0);
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: "%" })).accounts).toHaveLength(0);
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: first.account.id })).accounts[0].id).toBe(first.account.id);
  });
  it("denies every other role, fake/stale principals, disabled actors and missing verified MFA", async () => {
    const actor = await admin(); const target = await resident("SEC-" + randomUUID());
    for (const role of ["resident", "treasurer", "rt_chairman"] as const) await expect(searchRecoveryAccounts(db(), { ...actor.principal, role }, { query: target.account.loginIdentifier })).rejects.toBeInstanceOf(RecoveryDirectoryForbiddenError);
    await expect(searchRecoveryAccounts(db(), { ...actor.principal, appAccountId: target.account.id }, { query: "SEC" })).rejects.toBeInstanceOf(RecoveryDirectoryForbiddenError);
    await expect(searchRecoveryAccounts(db(), { ...actor.principal, authUserId: target.user.id }, { query: "SEC" })).rejects.toBeInstanceOf(RecoveryDirectoryForbiddenError);
    await test.db.update(authTwoFactor).set({ verified: false }).where(eq(authTwoFactor.userId, actor.user.id));
    await expect(searchRecoveryAccounts(db(), actor.principal, { query: "SEC" })).rejects.toThrow();
    await test.db.update(authTwoFactor).set({ verified: true }).where(eq(authTwoFactor.userId, actor.user.id));
    await test.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, actor.account.id));
    await expect(searchRecoveryAccounts(db(), actor.principal, { query: "SEC" })).rejects.toThrow();
  });
  it("offers no recovery action for own Admin, disabled/locked residents, or inactive household membership", async () => {
    const actor = await admin(); const other = await admin();
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: actor.account.id })).accounts[0].recovery).toBeNull();
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: other.account.id })).accounts[0].recovery).toBe("admin_two_factor");
    const target = await resident("STATUS-" + randomUUID());
    for (const status of ["disabled", "locked"] as const) {
      await test.db.update(appAccounts).set({ status }).where(eq(appAccounts.id, target.account.id));
      expect((await searchRecoveryAccounts(db(), actor.principal, { query: target.account.id })).accounts[0].recovery).toBeNull();
    }
    await test.db.update(appAccounts).set({ status: "active" }).where(eq(appAccounts.id, target.account.id));
    await test.db.update(households).set({ status: "inactive", endsOn: "2026-10-31" }).where(eq(households.id, target.household.householdId));
    expect((await searchRecoveryAccounts(db(), actor.principal, { query: target.account.id })).accounts[0].recovery).toBeNull();
  });
  it("caps duplicate-identifier results and rejects empty/extra/control-character input", async () => {
    const actor = await admin(); const query = "LIMIT-" + randomUUID();
    for (let i = 0; i < 11; i++) await resident(query);
    const result = await searchRecoveryAccounts(db(), actor.principal, { query }); expect(result.accounts).toHaveLength(10); expect(result.hasMore).toBe(true);
    for (const input of [{ query: "" }, { query: "a\nb" }, { query: "ok", rtUnitId: randomUUID() }]) await expect(searchRecoveryAccounts(db(), actor.principal, input)).rejects.toThrow();
  });
});
