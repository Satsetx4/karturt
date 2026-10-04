import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  authSession,
  authAccount,
  authUser,
  billingYears,
  dueAdjustments,
  feeRates,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  people,
} from "@/db/schema";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { findUniqueLoginAccount } from "@/lib/auth/login-account";
import { resolvePrincipalForUser, UnauthenticatedError } from "@/lib/auth/principal";
import type { Principal } from "@/lib/auth/permissions";
import {
  createHouseholdResident,
  deactivateHousehold,
  HouseholdConflictError,
  HouseholdForbiddenError,
  InvalidHouseholdInputError,
  listHouseholdManagement,
  replaceHouseholdResident,
  updateHouseholdResident,
} from "@/lib/households/lifecycle";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const businessDate = "2026-10-03";

describe("F12 household lifecycle domain services", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairmanFixture() {
    const rtUnitId = await createRt(testDatabase.db);
    const original = await createHousehold(testDatabase.db, rtUnitId, { number: `CHAIR-${randomUUID().slice(0, 8)}` });
    const auth = await createAuthUser(testDatabase.db, "F12 chairman");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: auth.id,
      accountType: "official",
      loginIdentifier: `chair-${randomUUID()}`,
      personId: original.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairman: Principal = {
      authUserId: auth.id,
      appAccountId: account!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: original.personId,
    };
    return { rtUnitId, original, chairman };
  }

  async function openBillingYear(rtUnitId: string) {
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40_000,
    });
    return year!.id;
  }

  async function addResidentAccount(input: {
    rtUnitId: string;
    houseId: string;
    householdId: string;
    personId: string;
  }) {
    const [house] = await testDatabase.db.select({ number: houses.number })
      .from(houses).where(eq(houses.id, input.houseId)).limit(1);
    return createResidentAuthRecords(testDatabase.db as unknown as Pick<AppDatabase, "insert">, {
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      personId: input.personId,
      loginIdentifier: house!.number.trim().toUpperCase(),
      fullName: "Penghuni lama",
      pin: "123456",
    });
  }

  async function addOldAnnualDues(
    rtUnitId: string,
    householdId: string,
    billingYearId: string,
    notDueMonths: readonly number[] = [],
  ) {
    const [feeRate] = await testDatabase.db.select({ id: feeRates.id })
      .from(feeRates).where(eq(feeRates.billingYearId, billingYearId)).limit(1);
    return testDatabase.db.insert(monthlyDues).values(Array.from({ length: 12 }, (_, index) => ({
      rtUnitId,
      householdId,
      billingYearId,
      feeRateId: notDueMonths.includes(index + 1) ? null : feeRate!.id,
      month: index + 1,
      amount: notDueMonths.includes(index + 1) ? 0 : 40_000,
      dueDate: `2026-${String(index + 1).padStart(2, "0")}-10`,
      status: notDueMonths.includes(index + 1) ? "not_due" as const : "unpaid" as const,
    }))).returning({ id: monthlyDues.id, month: monthlyDues.month, status: monthlyDues.status });
  }

  async function addSession(authUserId: string) {
    const sessionId = randomUUID();
    await testDatabase.db.insert(authSession).values({
      id: sessionId,
      token: randomUUID(),
      userId: authUserId,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    return sessionId;
  }

  it("creates a resident in a new house, generates month-safe dues, and audits only IDs/counts", async () => {
    const { chairman, rtUnitId } = await createChairmanFixture();
    const billingYearId = await openBillingYear(rtUnitId);

    const created = await createHouseholdResident(database, chairman, {
      newHouse: { number: "A-01", label: "Blok A" },
      startsOn: "2026-11-15",
      fullName: "Warga Baru",
      phone: "+62 812-3456-7890",
      initialPin: "482913",
    }, businessDate);

    const dues = await testDatabase.db.select({ month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues).where(eq(monthlyDues.householdId, created.householdId)).orderBy(monthlyDues.month);
    const [account] = await testDatabase.db.select({
      id: appAccounts.id,
      loginIdentifier: appAccounts.loginIdentifier,
      status: appAccounts.status,
      authUserId: appAccounts.authUserId,
    }).from(appAccounts).where(eq(appAccounts.id, created.residentAccountId));
    const [credential] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, account!.authUserId));
    const [audit] = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.created"),
      eq(auditEvents.entityId, created.householdId),
    ));
    const managementList = await listHouseholdManagement(database, chairman, "A-01", businessDate);

    expect(created).toMatchObject({ startsOn: "2026-11-15", generatedDueCount: 12 });
    expect(dues.filter((due) => due.month <= 10).every((due) => due.status === "not_due")).toBe(true);
    expect(dues.filter((due) => due.month >= 11).every((due) => due.status === "unpaid")).toBe(true);
    expect(account).toMatchObject({ id: created.residentAccountId, loginIdentifier: "A-01", status: "active" });
    expect(credential?.password).not.toBe("482913");
    expect(credential?.password).toBeTruthy();
    await expect(resolvePrincipalForUser(database, account!.authUserId, businessDate))
      .rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(resolvePrincipalForUser(database, account!.authUserId, "2026-11-15"))
      .resolves.toMatchObject({ householdId: created.householdId, personId: created.personId, role: "resident" });
    expect(created).not.toHaveProperty("initialPin");
    expect(audit?.context).toEqual({
      createdResidentAccountId: created.residentAccountId,
      generatedDueCount: 12,
      startsOn: "2026-11-15",
    });
    expect(JSON.stringify(audit?.context)).not.toContain("482913");
    expect(await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.billingYearId, billingYearId))).toHaveLength(12);
    expect(managementList.households).toHaveLength(1);
    expect(managementList.households[0]).toMatchObject({
      householdId: created.householdId,
      houseNumber: "A-01",
      status: "active",
      residents: [{ personId: created.personId, fullName: "Warga Baru", residentAccountId: created.residentAccountId }],
      financialHistory: { dueCount: 12, unpaidCount: 2, notDueCount: 10 },
    });
    expect(managementList.availableHouses.some((house) => house.houseId === created.houseId)).toBe(false);
  });

  it("maps a missing applicable open-year tariff to a safe conflict and rolls the create back", async () => {
    const { chairman, rtUnitId } = await createChairmanFixture();
    await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    });

    await expect(createHouseholdResident(database, chairman, {
      newHouse: { number: "NO-RATE-01" },
      startsOn: "2026-11-15",
      fullName: "Penghuni Baru",
      initialPin: "482913",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    expect(await testDatabase.db.select({ id: houses.id }).from(houses)
      .where(eq(houses.number, "NO-RATE-01"))).toHaveLength(0);
    expect(await testDatabase.db.select({ id: households.id }).from(households)
      .innerJoin(houses, eq(houses.id, households.houseId))
      .where(eq(houses.number, "NO-RATE-01"))).toHaveLength(0);
  });

  it("edits only the resident profile and house label, and records changed field names", async () => {
    const { chairman, rtUnitId } = await createChairmanFixture();
    const created = await createHouseholdResident(database, chairman, {
      newHouse: { number: "B-02" },
      startsOn: businessDate,
      fullName: "Nama Sebelum",
      phone: "081234567890",
      initialPin: "543210",
    }, businessDate);
    const beforeDues = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.householdId, created.householdId));

    const edited = await updateHouseholdResident(database, chairman, {
      householdId: created.householdId,
      personId: created.personId,
      fullName: "Nama Sesudah",
      phone: "+62 812 3456 7890",
      houseLabel: "Blok B",
    }, businessDate);
    const [person] = await testDatabase.db.select().from(people).where(eq(people.id, created.personId));
    const [house] = await testDatabase.db.select({ label: houses.label })
      .from(houses).where(eq(houses.id, created.houseId));
    const [account] = await testDatabase.db.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts).where(eq(appAccounts.id, created.residentAccountId));
    const [updatedAuthUser] = await testDatabase.db.select({ name: authUser.name })
      .from(authUser).where(eq(authUser.id, account!.authUserId));
    const afterDues = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.householdId, created.householdId));
    const [audit] = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.updated"),
      eq(auditEvents.entityId, created.householdId),
    ));

    expect(edited.changedFields).toEqual(["fullName", "houseLabel", "phone"]);
    expect(person).toMatchObject({ fullName: "Nama Sesudah", phone: "+62 812 3456 7890" });
    expect(house?.label).toBe("Blok B");
    expect(updatedAuthUser?.name).toBe("Nama Sesudah");
    expect(afterDues).toEqual(beforeDues);
    expect(audit?.context).toEqual({ changedFields: "fullName,houseLabel,phone" });
    expect(JSON.stringify(audit?.context)).not.toContain("Nama Sesudah");
    await expect(updateHouseholdResident(database, chairman, {
      householdId: created.householdId,
      personId: created.personId,
      rtUnitId,
    } as never, businessDate)).rejects.toBeInstanceOf(InvalidHouseholdInputError);
  });

  it("deactivates without waiving active-period dues and revokes sessions", async () => {
    const { chairman, rtUnitId, original } = await createChairmanFixture();
    const account = await addResidentAccount({
      rtUnitId,
      houseId: original.houseId,
      householdId: original.householdId,
      personId: original.personId,
    });
    await addSession(account.authUserId);
    const billingYearId = await openBillingYear(rtUnitId);
    await addOldAnnualDues(rtUnitId, original.householdId, billingYearId);

    const result = await deactivateHousehold(database, chairman, {
      householdId: original.householdId,
      effectiveMonth: "2026-10",
      reason: "Pindah domisili sesuai permohonan",
    }, businessDate);
    const [household] = await testDatabase.db.select().from(households).where(eq(households.id, original.householdId));
    const [person] = await testDatabase.db.select().from(people).where(eq(people.id, original.personId));
    const [residentAccount] = await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.id, account.appAccountId));
    const dues = await testDatabase.db.select({ month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues).where(eq(monthlyDues.householdId, original.householdId)).orderBy(monthlyDues.month);
    const sessions = await testDatabase.db.select().from(authSession).where(eq(authSession.userId, account.authUserId));
    const audits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.deactivated"),
      eq(auditEvents.entityId, original.householdId),
    ));

    expect(result).toMatchObject({ effectiveDate: "2026-10-31", disabledAccountCount: 1, revokedSessionCount: 1, transitionedDueCount: 2 });
    expect(household).toMatchObject({ status: "inactive", endsOn: "2026-10-31" });
    expect(person?.isActive).toBe(false);
    expect(residentAccount?.status).toBe("disabled");
    expect(sessions).toHaveLength(0);
    expect(dues.filter((due) => due.month <= 10).every((due) => due.status === "unpaid")).toBe(true);
    expect(dues.filter((due) => due.month >= 11).every((due) => due.status === "not_due")).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.reason).toBe("Pindah domisili sesuai permohonan");
    expect(audits[0]?.context).toEqual({
      disabledAccountCount: 1,
      effectiveEndDate: "2026-10-31",
      revokedSessionCount: 1,
      transitionedDueCount: 2,
    });
  });

  it("rejects deactivation when an already-NOT_DUE post-end row has legacy adjustment history", async () => {
    const { chairman, rtUnitId, original } = await createChairmanFixture();
    const account = await addResidentAccount({
      rtUnitId,
      houseId: original.houseId,
      householdId: original.householdId,
      personId: original.personId,
    });
    const billingYearId = await openBillingYear(rtUnitId);
    const dues = await addOldAnnualDues(rtUnitId, original.householdId, billingYearId, [11, 12]);
    const postEndNotDue = dues.find((due) => due.month === 11)!;

    // Model pre-existing invalid legacy ledger data. Current DB ledger guards
    // prevent adjustments on NOT_DUE rows; this verifies service fail-closed
    // behavior if such a row is nevertheless encountered.
    await testDatabase.client.exec("ALTER TABLE public.due_adjustments DISABLE TRIGGER USER");
    try {
      await testDatabase.db.insert(dueAdjustments).values({
        rtUnitId,
        householdId: original.householdId,
        monthlyDueId: postEndNotDue.id,
        amountDelta: 1,
        effectiveTargetAfter: 40_001,
        reason: "Legacy fixture anomaly",
        adjustedByAccountId: chairman.appAccountId,
        adjustedByAccountType: "official",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
      });
    } finally {
      await testDatabase.client.exec("ALTER TABLE public.due_adjustments ENABLE TRIGGER USER");
    }

    await expect(deactivateHousehold(database, chairman, {
      householdId: original.householdId,
      effectiveMonth: "2026-10",
      reason: "Menutup masa huni dengan anomali riwayat",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const [household] = await testDatabase.db.select({ status: households.status })
      .from(households).where(eq(households.id, original.householdId));
    const [residentAccount] = await testDatabase.db.select({ status: appAccounts.status })
      .from(appAccounts).where(eq(appAccounts.id, account.appAccountId));
    expect(household?.status).toBe("active");
    expect(residentAccount?.status).toBe("active");
  });

  it("replaces a resident at the same house with new identity, login access, and no inherited dues", async () => {
    const { chairman, rtUnitId, original } = await createChairmanFixture();
    const account = await addResidentAccount({
      rtUnitId,
      houseId: original.houseId,
      householdId: original.householdId,
      personId: original.personId,
    });
    await addSession(account.authUserId);
    const billingYearId = await openBillingYear(rtUnitId);
    await addOldAnnualDues(rtUnitId, original.householdId, billingYearId);

    const replaced = await replaceHouseholdResident(database, chairman, {
      householdId: original.householdId,
      effectiveMonth: "2026-11",
      fullName: "Penghuni Pengganti",
      phone: "081298765432",
      initialPin: "654321",
      reason: "Pergantian penghuni setelah serah terima",
    }, businessDate);
    const [oldAccount] = await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.id, account.appAccountId));
    const [newAccount] = await testDatabase.db.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts).where(eq(appAccounts.id, replaced.newResidentAccountId));
    const [oldHousehold] = await testDatabase.db.select().from(households).where(eq(households.id, original.householdId));
    const [newHousehold] = await testDatabase.db.select().from(households).where(eq(households.id, replaced.newHouseholdId));
    const oldDues = await testDatabase.db.select({ month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues).where(eq(monthlyDues.householdId, original.householdId)).orderBy(monthlyDues.month);
    const newDues = await testDatabase.db.select({ month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues).where(eq(monthlyDues.householdId, replaced.newHouseholdId)).orderBy(monthlyDues.month);
    const houseNumber = await testDatabase.db.select({ number: houses.number }).from(houses).where(eq(houses.id, original.houseId));
    const resolvedLogin = await findUniqueLoginAccount(database, "resident", houseNumber[0]!.number.toLowerCase());
    const sessions = await testDatabase.db.select().from(authSession).where(eq(authSession.userId, account.authUserId));
    const [replacementAudit] = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.resident_replaced"),
      eq(auditEvents.entityId, original.householdId),
    ));

    expect(replaced).toMatchObject({
      effectiveDate: "2026-11-01",
      transitionedDueCount: 2,
      generatedDueCount: 12,
    });
    expect(oldAccount?.status).toBe("disabled");
    expect(sessions).toHaveLength(0);
    await expect(resolvePrincipalForUser(database, account.authUserId, businessDate)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(resolvePrincipalForUser(database, newAccount!.authUserId, businessDate)).rejects.toBeInstanceOf(UnauthenticatedError);
    const newPrincipal = await resolvePrincipalForUser(database, newAccount!.authUserId, "2026-11-01");
    expect(newPrincipal).toMatchObject({ householdId: replaced.newHouseholdId, personId: replaced.newPersonId, role: "resident" });
    expect(oldHousehold).toMatchObject({ status: "inactive", endsOn: "2026-10-31" });
    expect(newHousehold).toMatchObject({ status: "active", startsOn: "2026-11-01", endsOn: null });
    expect(oldDues.filter((due) => due.month <= 10).every((due) => due.status === "unpaid")).toBe(true);
    expect(oldDues.filter((due) => due.month >= 11).every((due) => due.status === "not_due")).toBe(true);
    expect(newDues.filter((due) => due.month <= 10).every((due) => due.status === "not_due")).toBe(true);
    expect(newDues.filter((due) => due.month >= 11).every((due) => due.status === "unpaid")).toBe(true);
    expect(resolvedLogin?.id).toBe(replaced.newResidentAccountId);
    expect(replacementAudit?.reason).toBe("Pergantian penghuni setelah serah terima");
    expect(replacementAudit?.context).toMatchObject({
      effectiveDate: "2026-11-01",
      newAccountId: replaced.newResidentAccountId,
      newHouseholdId: replaced.newHouseholdId,
      oldAccountId: account.appAccountId,
      oldHouseholdId: original.householdId,
    });
    expect(houseNumber[0]?.number).toBeTruthy();
  });

  it("rolls back a deactivation when the critical audit insert fails", async () => {
    const { chairman, rtUnitId, original } = await createChairmanFixture();
    const account = await addResidentAccount({
      rtUnitId,
      houseId: original.houseId,
      householdId: original.householdId,
      personId: original.personId,
    });
    const functionName = `phase12_audit_failure_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${functionName}_trigger`;
    await testDatabase.client.exec(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'household.deactivated' THEN
          RAISE EXCEPTION 'forced phase 12 audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
    `);

    try {
      await expect(deactivateHousehold(database, chairman, {
        householdId: original.householdId,
        effectiveMonth: "2026-10",
        reason: "Perpindahan warga",
      }, businessDate)).rejects.toThrow();
    } finally {
      await testDatabase.client.exec(`DROP TRIGGER ${triggerName} ON public.audit_events; DROP FUNCTION public.${functionName}();`);
    }

    const [household] = await testDatabase.db.select().from(households).where(eq(households.id, original.householdId));
    const [person] = await testDatabase.db.select().from(people).where(eq(people.id, original.personId));
    const [residentAccount] = await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.id, account.appAccountId));
    const auditRows = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.deactivated"),
      eq(auditEvents.entityId, original.householdId),
    ));
    expect(household?.status).toBe("active");
    expect(household?.endsOn).toBeNull();
    expect(person?.isActive).toBe(true);
    expect(residentAccount?.status).toBe("active");
    expect(auditRows).toHaveLength(0);
  });

  it("rejects non-Chairman lifecycle calls before any mutation", async () => {
    const { chairman, rtUnitId } = await createChairmanFixture();
    const treasurer = { ...chairman, role: "treasurer" as const };
    await expect(createHouseholdResident(database, treasurer, {
      newHouse: { number: "NO-ACCESS" },
      startsOn: businessDate,
      fullName: "Tidak dibuat",
      initialPin: "112233",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdForbiddenError);
    const [house] = await testDatabase.db.select().from(houses).where(and(
      eq(houses.rtUnitId, rtUnitId),
      eq(houses.number, "NO-ACCESS"),
    ));
    expect(house).toBeUndefined();
  });
});
