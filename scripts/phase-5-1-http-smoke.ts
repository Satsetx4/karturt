import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authUser,
  billingYears,
  feeRates,
  households,
  monthlyDues,
  officialAssignments,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  people,
  rtSettings,
  rtUnits,
  houses,
} from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
  databaseName: "neondb",
};

let residentAuthUserId: string | undefined;

function assertDevelopmentTarget() {
  const env = requireDatabaseEnvironment();
  if (env.appEnv !== "development" || env.databaseEnv !== "development") {
    throw new Error("Phase 5.1 HTTP smoke requires APP_ENV and DATABASE_ENV to both be development.");
  }
  const expected = {
    KARTURT_NEON_DEV_PROJECT_ID: target.projectId,
    KARTURT_NEON_DEV_BRANCH_ID: target.branchId,
    KARTURT_NEON_DEV_ENDPOINT_ID: target.endpointId,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new Error(`The verified development target is required in ${key}.`);
  }
  const url = new URL(env.databaseUrl);
  if (url.hostname.split(".")[0] !== target.endpointId || url.hostname.includes("pooler")) {
    throw new Error("DATABASE_URL must use the direct endpoint belonging to karturt-development.");
  }
  if (url.pathname !== `/${target.databaseName}`) {
    throw new Error("The HTTP smoke only runs against the verified neondb database.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || new URL(appUrl).hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_APP_URL must point to the local HTTP smoke server.");
  }
  return { baseUrl: new URL(appUrl).origin, databaseHost: url.hostname };
}

function postgresCode(error: unknown): string | undefined {
  let current = error;
  while (current && typeof current === "object") {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { baseUrl, databaseHost } = assertDevelopmentTarget();
  const database = getDb();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const residentName = `Phase 5.1 smoke resident ${suffix}`;
  const houseNumber = `HTTP-${suffix}`;
  const email = `phase51-resident-${suffix.toLowerCase()}@example.invalid`;
  const password = String(randomInt(100000, 1000000));
  residentAuthUserId = randomUUID();

  const [rtUnit] = await database.insert(rtUnits).values({
    code: `HTTP-${suffix}`,
    rwCode: `HTTP-${suffix}`,
    name: `Phase 5.1 HTTP smoke ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  await database.insert(rtSettings).values({ rtUnitId: rtUnit.id });

  const [house] = await database.insert(houses).values({
    rtUnitId: rtUnit.id,
    number: houseNumber,
  }).returning({ id: houses.id });
  const [household] = await database.insert(households).values({
    rtUnitId: rtUnit.id,
    houseId: house.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [residentPerson] = await database.insert(people).values({
    rtUnitId: rtUnit.id,
    householdId: household.id,
    fullName: residentName,
  }).returning({ id: people.id });
  await database.insert(authUser).values({
    id: residentAuthUserId,
    name: residentName,
    email,
    emailVerified: true,
  });
  await database.insert(authAccount).values({
    id: randomUUID(),
    accountId: residentAuthUserId,
    providerId: "credential",
    userId: residentAuthUserId,
    password: await hashPassword(password),
  });
  const [residentAccount] = await database.insert(appAccounts).values({
    rtUnitId: rtUnit.id,
    authUserId: residentAuthUserId,
    accountType: "resident",
    loginIdentifier: houseNumber,
    personId: residentPerson.id,
    householdId: household.id,
  }).returning({ id: appAccounts.id });

  const [billingYear] = await database.insert(billingYears).values({
    rtUnitId: rtUnit.id,
    year: 2026,
    status: "open",
  }).returning({ id: billingYears.id });
  const [feeRate] = await database.insert(feeRates).values({
    rtUnitId: rtUnit.id,
    billingYearId: billingYear.id,
    effectiveMonth: 1,
    monthlyAmount: 18000,
  }).returning({ id: feeRates.id });
  for (const month of [6, 7]) {
    await database.insert(monthlyDues).values({
      rtUnitId: rtUnit.id,
      householdId: household.id,
      billingYearId: billingYear.id,
      feeRateId: feeRate.id,
      month,
      amount: 18000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid",
    });
  }

  const [treasurerHouse] = await database.insert(houses).values({
    rtUnitId: rtUnit.id,
    number: `TREASURER-${suffix}`,
  }).returning({ id: houses.id });
  const [treasurerHousehold] = await database.insert(households).values({
    rtUnitId: rtUnit.id,
    houseId: treasurerHouse.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [treasurerPerson] = await database.insert(people).values({
    rtUnitId: rtUnit.id,
    householdId: treasurerHousehold.id,
    fullName: `Phase 5.1 smoke Treasurer ${suffix}`,
    phone: "08123456789",
  }).returning({ id: people.id });
  const [treasurerUser] = await database.insert(authUser).values({
    id: randomUUID(),
    name: `Phase 5.1 smoke Treasurer ${suffix}`,
    email: `phase51-treasurer-${suffix}@example.invalid`,
    emailVerified: true,
  }).returning({ id: authUser.id });
  const [treasurerAccount] = await database.insert(appAccounts).values({
    rtUnitId: rtUnit.id,
    authUserId: treasurerUser.id,
    accountType: "official",
    loginIdentifier: `phase51-treasurer-${suffix}`,
    personId: treasurerPerson.id,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId: rtUnit.id,
    appAccountId: treasurerAccount.id,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const signIn = await fetch(`${baseUrl}/api/login/resident`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ identifier: houseNumber, password }),
  });
  const signInBody = await signIn.clone().text();
  assert.equal(signIn.status, 200, `The resident login route should create a normal session: ${signInBody}`);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.length > 0, "Better Auth should return a session cookie.");

  const getDues = () => fetch(`${baseUrl}/api/resident/monthly-dues`, {
    headers: { cookie },
    cache: "no-store",
  });
  const initialRead = await getDues();
  assert.equal(initialRead.status, 200, "A real resident session should read the monthly dues route.");
  const initialBody = await initialRead.json() as { dues: Array<{ month: number; status: string; paymentRequestStatus: string | null }> };
  assert.deepEqual(initialBody.dues.map(({ month, status, paymentRequestStatus }) => ({ month, status, paymentRequestStatus })), [
    { month: 6, status: "unpaid", paymentRequestStatus: null },
    { month: 7, status: "unpaid", paymentRequestStatus: null },
  ]);

  const postRequest = (period: string, idempotencyKey: string) => fetch(`${baseUrl}/api/resident/payment-requests`, {
    method: "POST",
    headers: {
      cookie,
      origin: baseUrl,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ period }),
  });
  const firstKey = randomUUID();
  const firstResponse = await postRequest("2026-06", firstKey);
  assert.equal(firstResponse.status, 200, "The real payment request route should accept an authenticated resident request.");
  const first = await firstResponse.json() as {
    requestCode: string;
    status: string;
    periods: string[];
    totalAmount: number;
    whatsappUrl: string | null;
  };
  assert.deepEqual(first.periods, ["2026-06"]);
  assert.equal(first.totalAmount, 18000);
  assert.equal(first.status, "pending");
  assert.match(first.whatsappUrl ?? "", /^https:\/\/wa\.me\/628123456789\?text=/);

  const replay = await postRequest("2026-06", firstKey);
  assert.equal(replay.status, 200, "A same-key replay should return the same active request.");
  assert.equal((await replay.json() as { requestCode: string }).requestCode, first.requestCode);

  const race = await Promise.all([
    postRequest("2026-07", randomUUID()),
    postRequest("2026-07", randomUUID()),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [200, 409]);
  const raceWinner = await race.find((response) => response.status === 200)!.json() as {
    requestCode: string;
    status: string;
    periods: string[];
    totalAmount: number;
  };
  assert.deepEqual(raceWinner.periods, ["2026-07"]);
  assert.equal(raceWinner.totalAmount, 18000);

  const refreshedResponse = await getDues();
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json() as { dues: Array<{ month: number; amount: number; status: string; paymentRequestStatus: string | null }> };
  assert.deepEqual(refreshed.dues.map(({ month, amount, status, paymentRequestStatus }) => ({ month, amount, status, paymentRequestStatus })), [
    { month: 6, amount: 18000, status: "unpaid", paymentRequestStatus: "pending" },
    { month: 7, amount: 18000, status: "unpaid", paymentRequestStatus: "pending" },
  ]);

  const [firstRequest] = await database.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, first.requestCode));
  const [firstItem] = await database.select().from(paymentRequestItems)
    .where(eq(paymentRequestItems.requestId, firstRequest.id));
  assert.ok(firstItem, "A normal request should have inserted its snapshot item.");

  async function assertFirstRequestUnchanged() {
    const items = await database.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, firstRequest.id));
    const claims = await database.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, firstRequest.id));
    const [request] = await database.select().from(paymentRequests)
      .where(eq(paymentRequests.id, firstRequest.id));
    const [due] = await database.select({ status: monthlyDues.status })
      .from(monthlyDues)
      .where(eq(monthlyDues.id, firstItem.monthlyDueId));
    const events = await database.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(
        eq(auditEvents.actorAppAccountId, residentAccount.id),
        eq(auditEvents.action, "payment_request.created"),
        eq(auditEvents.entityId, firstRequest.id),
      ));
    assert.equal(items.length, 1);
    assert.equal(items[0]!.amount, 18000);
    assert.equal(items[0]!.period, "2026-06");
    assert.equal(claims.length, 1);
    assert.equal(request.status, "pending");
    assert.equal(due.status, "unpaid");
    assert.equal(events.length, 1);
  }

  const blockedMutations: Array<[string, string, () => Promise<unknown>]> = [
    ["UPDATE", "55000", () => database.update(paymentRequestItems)
      .set({ amount: 99999 })
      .where(and(
        eq(paymentRequestItems.requestId, firstRequest.id),
        eq(paymentRequestItems.monthlyDueId, firstItem.monthlyDueId),
      ))],
    ["DELETE", "55000", () => database.delete(paymentRequestItems)
      .where(and(
        eq(paymentRequestItems.requestId, firstRequest.id),
        eq(paymentRequestItems.monthlyDueId, firstItem.monthlyDueId),
      ))],
    ["TRUNCATE", "0A000", () => database.execute(sql.raw("TRUNCATE TABLE public.payment_request_items"))],
    ["TRUNCATE CASCADE", "55000", () => database.execute(sql.raw("TRUNCATE TABLE public.payment_request_items CASCADE"))],
  ];
  for (const [operation, expectedSqlState, mutation] of blockedMutations) {
    let error: unknown;
    try {
      await mutation();
    } catch (caught) {
      error = caught;
    }
    assert.equal(postgresCode(error), expectedSqlState, `${operation} must be rejected without mutating the snapshot.`);
    await assertFirstRequestUnchanged();
  }

  const pendingCount = refreshed.dues.filter((due) => due.paymentRequestStatus === "pending").length;
  assert.equal(pendingCount, 2);
  assert.equal(refreshed.dues.every((due) => due.status === "unpaid"), true);

  console.info(JSON.stringify({
    event: "phase_5_1.real_http_smoke",
    environment: "development",
    projectId: target.projectId,
    branchName: "karturt-development",
    branchId: target.branchId,
    endpointId: target.endpointId,
    databaseHost,
    auth: "Resident login endpoint issued a normal Better Auth session cookie; no bypass route or injected resident principal",
    httpPath: "GET monthly-dues -> POST payment-request -> same-key replay -> concurrent different-key requests -> refreshed GET",
    results: "one request created, replay reused it, concurrent period requests returned one success and one conflict",
    itemMutationSqlStates: { update: "55000", delete: "55000", truncate: "0A000 (foreign key guard)", truncateCascade: "55000 (immutable trigger)" },
    financialRecordsPreservedAfterEachFailure: true,
    requestInsertAndRefresh: "pending status visible while monthly dues remain unpaid",
    whatsappDeepLink: "same-RT Treasurer contact verified",
    syntheticFixture: "retained on development to preserve financial history; the test session is removed on exit",
  }));
}

main()
  .catch((error: unknown) => {
    const code = postgresCode(error);
    const message = error instanceof Error ? error.message : "Unexpected HTTP smoke failure.";
    console.error(`Phase 5.1 development HTTP smoke failed${code ? ` (SQLSTATE ${code})` : ""}: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (residentAuthUserId) {
      try {
        await getDb().delete(authSession).where(eq(authSession.userId, residentAuthUserId));
      } catch {
        // The session may not have been created if sign-in failed.
      }
    }
    await closeDb();
  });
