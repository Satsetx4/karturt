import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequests,
  paymentReversals,
  payments,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import {
  getRtFinancialReport,
  ReportForbiddenError,
} from "@/lib/reports/rt-financial-report";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const businessDate = "2026-10-04";

describe("Chairman RT report service authorization", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createOfficial(role: "rt_chairman" | "treasurer" = "rt_chairman") {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, `Reports ${role} ${randomUUID().slice(0, 8)}`);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `reports-${role}-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    const [assignment] = await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role,
      startsOn: "2020-01-01",
    }).returning({ id: officialAssignments.id });
    const principal = await resolvePrincipalForUser(database, user.id, businessDate);
    return {
      rtUnitId,
      householdId: household.householdId,
      accountId: account!.id,
      assignmentId: assignment!.id,
      principal,
    };
  }

  async function createResident() {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, `Reports resident ${randomUUID().slice(0, 8)}`);
    await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: `reports-resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    });
    return resolvePrincipalForUser(database, user.id, businessDate);
  }

  async function ledgerSnapshot() {
    const rows = await Promise.all([
      testDatabase.db.select().from(monthlyDues),
      testDatabase.db.select().from(dueAdjustments),
      testDatabase.db.select().from(paymentRequests),
      testDatabase.db.select().from(payments),
      testDatabase.db.select().from(paymentAllocations),
      testDatabase.db.select().from(paymentReversals),
      testDatabase.db.select().from(waiverActions),
      testDatabase.db.select().from(waiverItems),
      testDatabase.db.select().from(auditEvents),
    ]);
    return rows;
  }

  it("allows an active Chairman to read their own RT report without changing financial or audit rows", async () => {
    const fixture = await createOfficial("rt_chairman");
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: fixture.rtUnitId,
      householdId: fixture.householdId,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      month: 1,
      amount: 40000,
      dueDate: "2026-01-10",
      status: "unpaid",
    });
    const before = await ledgerSnapshot();

    const report = await getRtFinancialReport(database, fixture.principal, {
      year: 2026,
      businessDate,
    });

    const after = await ledgerSnapshot();
    expect(report.year).toBe(2026);
    expect(after).toEqual(before);
  });

  it("denies a Chairman whose account became inactive after principal resolution", async () => {
    const fixture = await createOfficial("rt_chairman");
    await testDatabase.db.update(appAccounts)
      .set({ status: "disabled" })
      .where(eq(appAccounts.id, fixture.accountId));

    await expect(getRtFinancialReport(database, fixture.principal, { year: 2026, businessDate }))
      .rejects.toBeInstanceOf(ReportForbiddenError);
  });

  it("denies a Chairman whose assignment has ended after principal resolution", async () => {
    const fixture = await createOfficial("rt_chairman");
    await testDatabase.db.update(officialAssignments)
      .set({ endsOn: "2026-10-03" })
      .where(eq(officialAssignments.id, fixture.assignmentId));

    await expect(getRtFinancialReport(database, fixture.principal, { year: 2026, businessDate }))
      .rejects.toBeInstanceOf(ReportForbiddenError);
  });

  it.each(["treasurer", "resident", "system_admin"] as const)("denies %s", async (role) => {
    const fixture = role === "resident"
      ? { principal: await createResident() }
      : role === "treasurer"
        ? await createOfficial("treasurer")
        : { principal: {
          authUserId: "system-admin-user",
          appAccountId: randomUUID(),
          role: "system_admin" as const,
          rtUnitId: null,
          householdId: null,
          personId: null,
        } satisfies Principal };

    await expect(getRtFinancialReport(database, fixture.principal, { year: 2026, businessDate }))
      .rejects.toBeInstanceOf(ReportForbiddenError);
  });

  it("does not let a Chairman widen scope by substituting a different RT", async () => {
    const fixture = await createOfficial("rt_chairman");
    const otherRt = await createRt(testDatabase.db);
    const forgedScope: Principal = { ...fixture.principal, rtUnitId: otherRt };

    await expect(getRtFinancialReport(database, forgedScope, { year: 2026, businessDate }))
      .rejects.toBeInstanceOf(ReportForbiddenError);
  });

  it("does not disclose another RT's available billing years", async () => {
    const fixture = await createOfficial("rt_chairman");
    const otherRt = await createRt(testDatabase.db);
    await testDatabase.db.insert(billingYears).values({ rtUnitId: otherRt, year: 2026, status: "open" });

    const report = await getRtFinancialReport(database, fixture.principal, { year: 2026, businessDate });

    expect(report.availableYears).toEqual([]);
    expect(report.year).toBe(2026);
  });
});
