import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authAccount,
  authRateLimit,
  authUser,
  billingYears,
  feeRates,
  houses,
  monthlyDues,
  officialAssignments,
  people,
  rtUnits,
} from "@/db/schema";
import { bootstrapR2SyntheticFixture, type R2StagingFixtureCredentials } from "@/lib/rt/r2-staging-fixture";
import { createTestDatabase } from "../helpers/database";

const credentials: R2StagingFixtureCredentials = {
  residentPin: "482913",
  chairmanPassword: "chairman-r2-fixture-password-2026",
  treasurerPassword: "treasurer-r2-fixture-password-2026",
  systemAdminPassword: "system-admin-r2-fixture-password-26",
};

describe("canonical R2 synthetic staging fixture", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterEach(async () => {
    await testDatabase?.close();
  });

  it("creates one RT, authentic synthetic roles, an open annual tariff, and 12 future due periods idempotently", async () => {
    const created = await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const retry = await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const units = await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits);
    const accounts = await testDatabase.db.select({ id: appAccounts.id, accountType: appAccounts.accountType })
      .from(appAccounts).orderBy(appAccounts.accountType);
    const assignments = await testDatabase.db.select({ role: officialAssignments.role }).from(officialAssignments)
      .orderBy(officialAssignments.role);
    const year = await testDatabase.db.select({ id: billingYears.id, year: billingYears.year, status: billingYears.status })
      .from(billingYears);
    const rates = await testDatabase.db.select({ effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
      .from(feeRates);
    const dues = await testDatabase.db.select({ month: monthlyDues.month, dueDate: monthlyDues.dueDate, status: monthlyDues.status })
      .from(monthlyDues).orderBy(monthlyDues.month);
    const passwordHashes = await testDatabase.db.select({ password: authAccount.password }).from(authAccount);

    expect(created.status).toBe("created");
    expect(retry.status).toBe("already_present");
    expect(created.counts).toEqual({ rtUnits: 1, residents: 1, treasurers: 1, chairmen: 1, systemAdmins: 1, billingYears: 1, feeRates: 1, monthlyDues: 12 });
    expect(units).toHaveLength(1);
    expect(accounts.map(({ accountType }) => accountType).sort()).toEqual(["official", "official", "resident", "system_admin"]);
    expect(assignments.map(({ role }) => role).sort()).toEqual(["rt_chairman", "treasurer"]);
    expect(year).toEqual([{ id: expect.any(String), year: 2027, status: "open" }]);
    expect(rates).toEqual([{ effectiveMonth: 1, monthlyAmount: 50000 }]);
    expect(dues).toHaveLength(12);
    expect(dues.map(({ month }) => month)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(dues.every(({ dueDate, status }) => dueDate.startsWith("2027-") && status === "unpaid")).toBe(true);
    expect(passwordHashes).toHaveLength(4);
    expect(passwordHashes.every(({ password }) => typeof password === "string" && password.length > 20)).toBe(true);
    expect(passwordHashes.map(({ password }) => password)).not.toContain(credentials.chairmanPassword);
    expect(passwordHashes.map(({ password }) => password)).not.toContain(credentials.treasurerPassword);
    expect(passwordHashes.map(({ password }) => password)).not.toContain(credentials.systemAdminPassword);
    expect(passwordHashes.map(({ password }) => password)).not.toContain(credentials.residentPin);
  });

  it("refuses an idempotent retry when supplied credentials differ from the seeded fixture", async () => {
    await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const changedCredentials = [
      { ...credentials, residentPin: "927164" },
      { ...credentials, chairmanPassword: "different-chairman-password-2026" },
      { ...credentials, treasurerPassword: "different-treasurer-password-2026" },
      { ...credentials, systemAdminPassword: "different-system-admin-password-26" },
    ];

    for (const changed of changedCredentials) {
      await expect(bootstrapR2SyntheticFixture(database, changed, "2026-10-25"))
        .rejects.toThrow("credentials do not match the existing synthetic fixture");
    }
    const [chairman] = await testDatabase.db.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts).where(eq(appAccounts.loginIdentifier, "r2-chairman"));
    const [credential] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, chairman!.authUserId));

    expect(await verifyPassword({ hash: credential!.password!, password: credentials.chairmanPassword })).toBe(true);
    expect(await testDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(4);
  });

  it("refuses to seed when an unrelated RT already occupies the database", async () => {
    const conflictDatabase = await createTestDatabase();
    const conflictAppDatabase = conflictDatabase.db as unknown as AppDatabase;
    await conflictDatabase.db.insert(rtUnits).values({
      code: "RT-OTHER",
      rwCode: "RW-OTHER",
      name: "Unrelated fixture",
      village: "Synthetic Test",
    });

    await expect(bootstrapR2SyntheticFixture(conflictAppDatabase, credentials, "2026-10-25"))
      .rejects.toThrow("unrelated RT occupies");
    expect(await conflictDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(1);
    expect(await conflictDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(0);
    await conflictDatabase.close();
  });

  it("refuses to seed an otherwise empty database containing unrelated auth state", async () => {
    await testDatabase.db.insert(authRateLimit).values({
      id: "unrelated-staging-rate-limit",
      key: "unrelated-staging-rate-limit",
      count: 1,
      lastRequest: Date.now(),
    });

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("Canonical staging row counts");
    expect(await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(0);
  });

  it("does not report a locked fixture account as a successful retry", async () => {
    await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    await testDatabase.db.update(appAccounts)
      .set({ status: "locked" })
      .where(eq(appAccounts.loginIdentifier, "R2-101"));

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("missing or inactive accounts");
  });

  it("refuses an idempotent retry when the synthetic house label has drifted", async () => {
    await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const [house] = await testDatabase.db.select({ id: houses.id }).from(houses);
    await testDatabase.db.update(houses).set({ label: "Label lain" }).where(eq(houses.id, house!.id));

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("house does not match");
  });

  it("refuses an idempotent retry when a synthetic resident profile has drifted", async () => {
    await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const [resident] = await testDatabase.db.select({ personId: appAccounts.personId })
      .from(appAccounts).where(eq(appAccounts.loginIdentifier, "R2-101"));
    await testDatabase.db.update(people).set({ fullName: "Nama lain" }).where(eq(people.id, resident!.personId!));

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("synthetic profiles");
  });

  it("refuses an idempotent retry when a synthetic authentication identity has drifted", async () => {
    await bootstrapR2SyntheticFixture(database, credentials, "2026-10-25");
    const [resident] = await testDatabase.db.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts).where(eq(appAccounts.loginIdentifier, "R2-101"));
    await testDatabase.db.update(authUser).set({ name: "Nama autentikasi lain" })
      .where(eq(authUser.id, resident!.authUserId));

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("authentication profiles");
  });

  it("rolls back all seeded rows when a required synthetic credential is invalid", async () => {
    const invalidCredentials = { ...credentials, residentPin: "not-a-pin" };
    await expect(bootstrapR2SyntheticFixture(database, invalidCredentials, "2026-10-25"))
      .rejects.toThrow("six-digit synthetic PIN");
    expect(await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(0);
    expect(await testDatabase.db.select({ id: billingYears.id }).from(billingYears)).toHaveLength(0);
  });

  it("rolls back earlier inserts when a later seed write fails", async () => {
    await testDatabase.client.exec(`
      CREATE FUNCTION reject_r2_settings_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic seed rollback test'; END;
      $$;
      CREATE TRIGGER reject_r2_settings_insert BEFORE INSERT ON rt_settings
      FOR EACH ROW EXECUTE FUNCTION reject_r2_settings_insert();
    `);

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow("Failed query: insert into \"rt_settings\"");
    expect(await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(0);
    expect(await testDatabase.db.select({ id: billingYears.id }).from(billingYears)).toHaveLength(0);
    expect(await testDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(0);
  });

  it("rolls back the account, tariff, and household writes when dues creation fails late", async () => {
    await testDatabase.client.exec(`
      CREATE FUNCTION reject_r2_dues_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic dues rollback test'; END;
      $$;
      CREATE TRIGGER reject_r2_dues_insert BEFORE INSERT ON monthly_dues
      FOR EACH ROW EXECUTE FUNCTION reject_r2_dues_insert();
    `);

    await expect(bootstrapR2SyntheticFixture(database, credentials, "2026-10-25"))
      .rejects.toThrow('insert into "monthly_dues"');
    expect(await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(0);
    expect(await testDatabase.db.select({ id: billingYears.id }).from(billingYears)).toHaveLength(0);
    expect(await testDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(0);
  });
});
