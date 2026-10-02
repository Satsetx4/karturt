import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { closeDb, getDb } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authUser,
  billingYears,
  dueAdjustments,
  feeRates,
  households,
  houses,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
  paymentReversals,
  people,
  rtSettings,
  rtUnits,
  waiverItems,
} from "@/db/schema";
import { generateHouseholdDues } from "@/lib/billing/generator";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { requireAuthEnvironment, requireDatabaseEnvironment } from "@/lib/env";
import type { Principal } from "@/lib/auth/permissions";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
  databaseName: "neondb",
} as const;
const baselineSha = "0d52cfe5dd3cdd70a2d3471f68cc410df0757052";
const baselineMigration = "0011_phase_10_waiver";
const nextMigration = "0012_phase_11_tariff_adjustment";
const root = process.cwd();
const expectedPort = 3200;
const baseUrl = `http://127.0.0.1:${expectedPort}`;
const userIds: string[] = [];
let nextProcess: ChildProcess | undefined;
let currentStage = "initialization";

type FixturePerson = {
  accountId: string;
  authUserId: string;
  householdId: string;
  personId: string;
  identifier: string;
  password: string;
};

type ScenarioFixture = {
  resident: FixturePerson;
  dues: Map<number, string>;
};

type MigrationRow = { hash: string };
type SqlResult<T> = { rows?: T[] };

function assertSourceBranch() {
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (branch.status !== 0 || branch.stdout.trim() !== "feat/phase-11-tariff-adjustment") {
    throw new Error("The local branch must be feat/phase-11-tariff-adjustment.");
  }
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, "HEAD"], {
    cwd: root,
    stdio: "ignore",
  });
  if (ancestry.status !== 0) {
    throw new Error("The local branch must descend from the exact F10 baseline commit.");
  }
}

function assertDevelopmentTarget() {
  if (process.env.APP_ENV !== "development" || process.env.DATABASE_ENV !== "development") {
    throw new Error("Both APP_ENV and DATABASE_ENV must explicitly equal development.");
  }
  const env = requireDatabaseEnvironment();
  const expectedIds = {
    KARTURT_NEON_DEV_PROJECT_ID: target.projectId,
    KARTURT_NEON_DEV_BRANCH_ID: target.branchId,
    KARTURT_NEON_DEV_ENDPOINT_ID: target.endpointId,
  };
  for (const [name, expected] of Object.entries(expectedIds)) {
    if (process.env[name] !== expected) throw new Error(`The approved development target is required in ${name}.`);
  }

  const databaseUrl = new URL(env.databaseUrl);
  const hostnameParts = databaseUrl.hostname.toLowerCase().split(".");
  if (
    hostnameParts[0] !== target.endpointId ||
    !databaseUrl.hostname.toLowerCase().endsWith(".neon.tech") ||
    databaseUrl.hostname.toLowerCase().includes("pooler") ||
    databaseUrl.pathname !== `/${target.databaseName}`
  ) {
    throw new Error("DATABASE_URL must use the direct approved Neon development endpoint and neondb database.");
  }

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL!);
  if (
    appUrl.protocol !== "http:" ||
    appUrl.hostname !== "127.0.0.1" ||
    Number(appUrl.port) !== expectedPort ||
    appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash
  ) {
    throw new Error(`The local smoke server must use ${baseUrl}.`);
  }
  return { databaseHost: databaseUrl.hostname, appUrl: appUrl.origin };
}

function migrationHash(fileName: string) {
  const source = readFileSync(resolve(root, "drizzle", `${fileName}.sql`), "utf8");
  const canonicalSource = fileName === baselineMigration ? source.replace(/\r\n?/g, "\n") : source;
  return createHash("sha256").update(canonicalSource).digest("hex");
}

async function databaseIdentity() {
  const result = await getDb().execute(sql`SELECT current_database() AS database_name`);
  const row = (result as unknown as SqlResult<{ database_name: string }>).rows?.[0];
  if (row?.database_name !== target.databaseName) {
    throw new Error("Connected database name did not match the approved development database.");
  }
}

async function verifyMigrationHead(expectedMigration: string) {
  const result = await getDb().execute(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const rows = (result as unknown as SqlResult<MigrationRow>).rows;
  const expectedHash = migrationHash(expectedMigration);
  if (!rows?.[0]?.hash || rows[0].hash !== expectedHash) {
    throw new Error(`Development migration head must be exactly ${expectedMigration}.`);
  }
  return rows[0].hash;
}

async function currentMigrationHash() {
  const result = await getDb().execute(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return (result as unknown as SqlResult<MigrationRow>).rows?.[0]?.hash ?? null;
}

async function diagnoseDevelopmentHeadReadOnly() {
  assertDevelopmentTarget();
  const identity = await getDb().execute(sql`SELECT current_database() AS database_name`);
  const databaseName = (identity as unknown as SqlResult<{ database_name: string }>).rows?.[0]?.database_name ?? "unavailable";
  let f10MigrationHashMatches = false;
  let f11MigrationHashMatches = false;
  try {
    const hash = await currentMigrationHash();
    f10MigrationHashMatches = typeof hash === "string" && hash === migrationHash(baselineMigration);
    f11MigrationHashMatches = typeof hash === "string" && hash === migrationHash(nextMigration);
  } catch {
    f10MigrationHashMatches = false;
    f11MigrationHashMatches = false;
  }
  const fixtures = await getDb().execute(sql`
    SELECT
      (SELECT count(*)::int FROM public.rt_units WHERE name LIKE 'Phase 11 synthetic unit %') AS rt_units,
      (SELECT count(*)::int FROM public.monthly_dues due JOIN public.rt_units unit ON unit.id = due.rt_unit_id WHERE unit.name LIKE 'Phase 11 synthetic unit %') AS dues,
      (SELECT count(*)::int FROM public.fee_rates rate JOIN public.rt_units unit ON unit.id = rate.rt_unit_id WHERE unit.name LIKE 'Phase 11 synthetic unit %') AS fee_rates,
      (SELECT count(*)::int FROM public.due_adjustments adjustment JOIN public.rt_units unit ON unit.id = adjustment.rt_unit_id WHERE unit.name LIKE 'Phase 11 synthetic unit %') AS adjustments,
      (SELECT count(*)::int FROM public.payments payment JOIN public.rt_units unit ON unit.id = payment.rt_unit_id WHERE unit.name LIKE 'Phase 11 synthetic unit %') AS payments,
      (SELECT count(*)::int FROM public.payment_requests request JOIN public.rt_units unit ON unit.id = request.rt_unit_id WHERE unit.name LIKE 'Phase 11 synthetic unit %') AS payment_requests
  `);
  const fixtureCounts = (fixtures as unknown as SqlResult<{
    rt_units: number | string;
    dues: number | string;
    fee_rates: number | string;
    adjustments: number | string;
    payments: number | string;
    payment_requests: number | string;
  }>).rows?.[0];
  console.info(JSON.stringify({
    databaseName,
    f10MigrationHashMatches,
    f11MigrationHashMatches,
    syntheticFixtureCounts: fixtureCounts ? Object.fromEntries(Object.entries(fixtureCounts).map(([key, value]) => [key, Number(value)])) : null,
  }));
}

async function assertPortFree() {
  await new Promise<void>((resolveListen, rejectListen) => {
    const server = createServer();
    server.once("error", () => rejectListen(new Error(`Local smoke port ${expectedPort} is already in use.`)));
    server.listen(expectedPort, "127.0.0.1", () => {
      server.close((error) => error ? rejectListen(error) : resolveListen());
    });
  });
}

async function startNext() {
  let spawnFailure: NodeJS.ErrnoException | undefined;
  nextProcess = spawn(process.execPath, [
    resolve(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(expectedPort),
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "development",
      APP_ENV: "development",
      DATABASE_ENV: "development",
      NEXT_PUBLIC_APP_URL: baseUrl,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  nextProcess.on("error", (error) => {
    spawnFailure = error as NodeJS.ErrnoException;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (spawnFailure) throw new Error(`Local application server could not start (${spawnFailure.code ?? spawnFailure.name}).`);
    if (nextProcess.exitCode !== null) {
      throw new Error(`Local application server exited (code ${nextProcess.exitCode}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/login/pengurus`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The local development server is still starting.
    }
    await delay(500);
  }
  throw new Error("Local application server did not become ready within 60 seconds.");
}

async function stopNext() {
  const child = nextProcess;
  nextProcess = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), delay(5000)]);
}

async function createPerson(
  rtUnitId: string,
  options: { purpose: string; startsOn: string; official?: "rt_chairman" | "treasurer" },
): Promise<FixturePerson> {
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const houseNumber = `P11-${suffix}`;
  currentStage = "create synthetic " + options.purpose + " house";
  const [house] = await getDb().insert(houses).values({ rtUnitId, number: houseNumber })
    .returning({ id: houses.id });
  currentStage = "create synthetic " + options.purpose + " household";
  const [household] = await getDb().insert(households).values({
    rtUnitId,
    houseId: house!.id,
    startsOn: options.startsOn,
  }).returning({ id: households.id });
  currentStage = "create synthetic " + options.purpose + " person";
  const [person] = await getDb().insert(people).values({
    rtUnitId,
    householdId: household!.id,
    fullName: `Phase 11 synthetic ${options.purpose} ${suffix}`,
  }).returning({ id: people.id });
  const authUserId = randomUUID();
  const identifier = options.official
    ? `p11-${options.official}-${suffix}-${randomUUID().slice(0, 8)}`
    : houseNumber;
  const password = options.official ? randomBytes(18).toString("base64url") : String(randomInt(100000, 1000000));
  currentStage = "create synthetic " + options.purpose + " authentication user";
  await getDb().insert(authUser).values({
    id: authUserId,
    name: `Phase 11 synthetic ${options.purpose} ${suffix}`,
    email: `${randomUUID()}@example.invalid`,
    emailVerified: true,
  });
  userIds.push(authUserId);
  currentStage = "create synthetic " + options.purpose + " application account";
  const [account] = await getDb().insert(appAccounts).values({
    rtUnitId,
    authUserId,
    accountType: options.official ? "official" : "resident",
    loginIdentifier: identifier,
    personId: person!.id,
    householdId: options.official ? null : household!.id,
  }).returning({ id: appAccounts.id });
  currentStage = "hash synthetic " + options.purpose + " login password";
  const hashedPassword = await hashPassword(password);
  currentStage = "persist synthetic " + options.purpose + " login credential";
  await getDb().insert(authAccount).values({
    id: randomUUID(),
    accountId: authUserId,
    providerId: "credential",
    userId: authUserId,
    password: hashedPassword,
  });
  if (options.official) {
    currentStage = "create synthetic " + options.purpose + " official assignment";
    await getDb().insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: options.official,
      startsOn: "2020-01-01",
    });
  }
  return {
    accountId: account!.id,
    authUserId,
    householdId: household!.id,
    personId: person!.id,
    identifier,
    password,
  };
}

async function signIn(type: "resident" | "official", person: FixturePerson) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    currentStage = `normal ${type} login through Better Auth`;
    const response = await fetch(`${baseUrl}/api/login/${type}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ identifier: person.identifier, password: person.password }),
    });
    if (response.status === 429 && attempt === 0) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000 + 1000
        : 61_000;
      await delay(waitMs);
      continue;
    }
    if (response.status !== 200) throw new Error(`Normal ${type} login returned HTTP ${response.status}.`);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    if (!cookie) throw new Error(`Normal ${type} login returned no session cookie.`);
    return cookie;
  }
  throw new Error(`Normal ${type} login remained rate limited after the retry window.`);
}

async function postJson(url: string, cookie: string, body: unknown, idempotencyKey?: string) {
  const headers = new Headers({ "content-type": "application/json", origin: baseUrl, cookie });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
}

async function jsonBody<T>(response: Response, expectedStatus: number, label: string) {
  const body = await response.json().catch(() => ({})) as T;
  assert.equal(response.status, expectedStatus, `${label} returned HTTP ${response.status}.`);
  return body;
}

async function createRequest(residentCookie: string, period: string, expectedAmount: number) {
  const response = await postJson(`${baseUrl}/api/resident/payment-requests`, residentCookie, { period }, randomUUID());
  const request = await jsonBody<{ requestCode: string; status: string; periods: string[]; totalAmount: number }>(response, 200, "Resident payment request");
  assert.equal(request.status, "pending");
  assert.deepEqual(request.periods, [period]);
  assert.equal(request.totalAmount, expectedAmount);
  return request;
}

async function verifyRequest(treasurerCookie: string, requestCode: string, expectedAmount: number) {
  const response = await postJson(
    `${baseUrl}/api/treasurer/payment-requests/${requestCode}/verify`,
    treasurerCookie,
    {},
  );
  const verified = await jsonBody<{ status: string; itemCount: number; totalAmount: number }>(response, 200, "Treasurer payment verification");
  assert.equal(verified.status, "verified");
  assert.equal(verified.itemCount, 1);
  assert.equal(verified.totalAmount, expectedAmount);
}

async function createAdjustment(
  chairmanCookie: string,
  monthlyDueId: string,
  amountDelta: number,
  expectedStatus = 200,
  idempotencyKey = randomUUID(),
) {
  const response = await postJson(`${baseUrl}/api/chairman/adjustments`, chairmanCookie, {
    monthlyDueId,
    amountDelta,
    reason: "Smoke fase sebelas, penyesuaian sintetik terukur",
  }, idempotencyKey);
  return jsonBody<{ id?: string; idempotentReplay?: boolean; message?: string }>(response, expectedStatus, "Chairman adjustment");
}

async function createWaiver(chairmanCookie: string, householdId: string, period: string) {
  const response = await postJson(`${baseUrl}/api/chairman/waivers`, chairmanCookie, {
    householdId,
    periods: [period],
    reason: "Keputusan administrasi terukur untuk smoke pengembangan",
  }, randomUUID());
  return jsonBody<{ periods: string[]; totalAmount: number; message?: string }>(response, 200, "Chairman waiver");
}

async function reversePayment(treasurerCookie: string, paymentId: string) {
  const response = await postJson(`${baseUrl}/api/treasurer/payments/${paymentId}/reverse`, treasurerCookie, {
    reason: "Koreksi transaksi uji pengembangan yang terdokumentasi",
  });
  return jsonBody<{ status: string; method: string; itemCount: number; totalAmount: number }>(response, 200, "Treasurer payment reversal");
}

async function createTariff(chairmanCookie: string, billingYearId: string, effectiveMonth: number, monthlyAmount: number) {
  const response = await postJson(`${baseUrl}/api/chairman/fee-rates`, chairmanCookie, {
    billingYearId,
    effectiveMonth,
    monthlyAmount,
  }, randomUUID());
  return jsonBody<{ rate: { monthlyAmount: number; effectiveMonth: number } }>(response, 200, "Chairman future tariff");
}

async function snapshotFinancialHistory() {
  const definitions = [
    { name: "fee_rates", columns: "id, rt_unit_id, billing_year_id, effective_month, monthly_amount, created_at", order: "id" },
    { name: "monthly_dues", columns: "id, rt_unit_id, household_id, billing_year_id, fee_rate_id, month, amount, due_date, status, waived_reason, created_at", order: "id" },
    { name: "payment_requests", columns: "id, request_code, rt_unit_id, household_id, requested_by_account_id, requested_by_account_type, status, idempotency_key, request_fingerprint, total_amount, item_count, verified_by_account_id, verified_by_account_type, verified_at, resolved_at, resolved_by_account_id, resolved_by_account_type, resolution_reason, created_at", order: "id" },
    { name: "payment_request_items", columns: "request_id, rt_unit_id, household_id, monthly_due_id, period, amount, created_at", order: "request_id, monthly_due_id" },
    { name: "payment_request_claims", columns: "request_id, monthly_due_id, claimed_at", order: "request_id, monthly_due_id" },
    { name: "payments", columns: "id, rt_unit_id, household_id, payment_request_id, amount, method, verified_by_account_id, verified_by_account_type, verified_at, cash_idempotency_key, cash_idempotency_fingerprint, created_at", order: "id" },
    { name: "payment_allocations", columns: "id, rt_unit_id, household_id, payment_request_id, payment_id, monthly_due_id, amount, created_at", order: "id" },
    { name: "active_due_settlements", columns: "monthly_due_id, rt_unit_id, household_id, payment_id, allocation_id, amount, created_at", order: "allocation_id" },
    { name: "payment_reversals", columns: "id, rt_unit_id, household_id, payment_id, reversed_by_account_id, reversed_by_account_type, reason, reversed_at", order: "id" },
    { name: "waiver_actions", columns: "id, rt_unit_id, household_id, waived_by_account_id, waived_by_account_type, reason, item_count, total_amount, idempotency_key, request_fingerprint, created_at", order: "id" },
    { name: "waiver_items", columns: "waiver_action_id, rt_unit_id, household_id, monthly_due_id, period, amount, created_at", order: "waiver_action_id, monthly_due_id" },
    { name: "audit_events", columns: "id, actor_app_account_id, action, entity_type, entity_id, reason, context, occurred_at", order: "id" },
  ] as const;
  const snapshot: Record<string, { count: number; digest: string }> = {};
  for (const table of definitions) {
    const query = `
      SELECT count(*)::int AS count,
        md5(coalesce(string_agg(row_to_json(snapshot_row)::text, E'\\n' ORDER BY ${table.order}), '')) AS digest
      FROM (SELECT ${table.columns} FROM public.${table.name}) snapshot_row
    `;
    const result = await getDb().execute(sql.raw(query));
    const row = (result as unknown as SqlResult<{ count: number | string; digest: string }>).rows?.[0];
    assert.ok(row, `Could not snapshot ${table.name}.`);
    snapshot[table.name] = { count: Number(row.count), digest: row.digest };
  }
  return snapshot;
}

function assertHistoryPreserved(
  before: Record<string, { count: number; digest: string }>,
  after: Record<string, { count: number; digest: string }>,
) {
  assert.deepEqual(after, before, "F11 migration changed immutable financial history.");
  return Object.values(before).reduce((sum, table) => sum + table.count, 0);
}

async function createFixtures() {
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  currentStage = "create synthetic RT unit";
  const [unit] = await getDb().insert(rtUnits).values({
    code: `P11-${suffix}`,
    rwCode: `P11-${suffix}`,
    name: `Phase 11 synthetic unit ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  const rtUnitId = unit!.id;
  currentStage = "create synthetic RT settings";
  await getDb().insert(rtSettings).values({ rtUnitId });

  currentStage = "create synthetic Chairman account";
  const chairman = await createPerson(rtUnitId, { purpose: "chairman", startsOn: "2020-01-01", official: "rt_chairman" });
  currentStage = "create synthetic Treasurer account";
  const treasurer = await createPerson(rtUnitId, { purpose: "treasurer", startsOn: "2020-01-01", official: "treasurer" });
  currentStage = "create synthetic 2027 billing year";
  const [year] = await getDb().insert(billingYears).values({ rtUnitId, year: 2027, status: "open" })
    .returning({ id: billingYears.id });

  const scenarioStarts = [
    ["unpaid", "2027-01-01"],
    ["paid", "2027-02-01"],
    ["pending", "2027-03-01"],
    ["negative", "2027-06-01"],
    ["tariff-paid-november", "2027-11-01"],
    ["tariff-pending-november", "2027-11-01"],
  ] as const;
  const scenarios = new Map<string, ScenarioFixture>();
  for (const [purpose, startsOn] of scenarioStarts) {
    currentStage = "create synthetic " + purpose + " resident account";
    const resident = await createPerson(rtUnitId, { purpose, startsOn });
    scenarios.set(purpose, { resident, dues: new Map() });
  }
  return {
    rtUnitId,
    billingYearId: year!.id,
    chairman,
    treasurer,
    scenarios,
  };
}

async function generateFixtureDues(fixtures: Awaited<ReturnType<typeof createFixtures>>) {
  const chairmanPrincipal: Principal = {
    authUserId: fixtures.chairman.authUserId,
    appAccountId: fixtures.chairman.accountId,
    role: "rt_chairman",
    rtUnitId: fixtures.rtUnitId,
    householdId: null,
    personId: fixtures.chairman.personId,
  };
  const generatedScenarios = new Set<ScenarioFixture>();
  for (const [purpose, scenario] of fixtures.scenarios) {
    if (generatedScenarios.has(scenario)) continue;
    generatedScenarios.add(scenario);
    const generated = await generateHouseholdDues(getDb(), chairmanPrincipal, {
      householdId: scenario.resident.householdId,
      billingYearId: fixtures.billingYearId,
    });
    assert.equal(generated.insertedCount, 12, `Annual dues were not generated for ${purpose}.`);
    scenario.dues = new Map(generated.rows.map((row) => [row.month, row.id]));
  }
}

const chairmanBrowserViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

async function testChairmanBrowserFlow(
  chairmanCookie: string,
  pendingHouseNumber: string,
  paidHouseNumber: string,
  adjustmentHouseNumber: string,
) {
  const tempRoot = resolve(tmpdir());
  const profile = mkdtempSync(join(tempRoot, "karturt-phase-11-chrome-"));
  if (!resolve(profile).startsWith(tempRoot + sep)) throw new Error("The temporary browser profile escaped its safe directory.");
  const browserCandidates = [
    process.env.CHROME_PATH,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const browserExecutable = browserCandidates.find((candidate) => existsSync(candidate));
  if (!browserExecutable) throw new Error("Chrome or Edge is required for the Chairman browser smoke.");

  let browserProcess: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  let commandId = 0;
  const pendingCommands = new Map<number, (message: Record<string, unknown>) => void>();
  const pageErrors: string[] = [];
  const mutationPosts = { feeRates: 0, adjustments: 0 };

  const command = (method: string, params: Record<string, unknown> = {}) => {
    const id = ++commandId;
    const pending = new Promise<Record<string, unknown>>((resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        pendingCommands.delete(id);
        rejectMessage(new Error("Browser DevTools command timed out: " + method));
      }, method === "Page.navigate" ? 120_000 : 30_000);
      pendingCommands.set(id, (message) => {
        clearTimeout(timeout);
        if (message.error) rejectMessage(new Error("Browser DevTools command failed: " + method));
        else resolveMessage(message);
      });
    });
    socket!.send(JSON.stringify({ id, method, params }));
    return pending;
  };

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const response = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const payload = response.result as { result?: { value?: T }; exceptionDetails?: unknown };
    if (payload?.exceptionDetails) throw new Error("Chairman browser page evaluation failed.");
    return payload?.result?.value as T;
  };

  const waitFor = async (expression: string, message: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate<boolean>(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };

  const setViewport = async (viewport: { width: number; height: number }) => {
    await command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 430,
    });
    await command("Emulation.setTouchEmulationEnabled", viewport.width <= 768
      ? { enabled: true, maxTouchPoints: 1 }
      : { enabled: false });
  };

  const navigate = async (path: string, viewport: { width: number; height: number }) => {
    await setViewport(viewport);
    const url = baseUrl + path;
    await command("Page.navigate", { url });
    await waitFor(
      "location.href === " + JSON.stringify(url) + " && document.readyState === 'complete'",
      "The Chairman page did not finish loading.",
    );
    await delay(150);
  };

  const setValue = (selector: string, value: string, kind: "input" | "select" | "textarea" = "input") => {
    const elementType = kind === "input" ? "HTMLInputElement" : kind === "select" ? "HTMLSelectElement" : "HTMLTextAreaElement";
    const eventType = kind === "input" ? "input" : "change";
    return evaluate<boolean>(
      "(() => { const element = document.querySelector(" + JSON.stringify(selector) + ");"
      + " if (!element) return false;"
      + " const setter = Object.getOwnPropertyDescriptor(" + elementType + ".prototype, 'value')?.set;"
      + " setter?.call(element, " + JSON.stringify(value) + ");"
      + " element.dispatchEvent(new Event(" + JSON.stringify(eventType) + ", { bubbles: true }));"
      + " return true; })()",
    );
  };

  const pointFor = async (selector: string, containsText?: string) => {
    const textCondition = containsText === undefined
      ? "true"
      : "candidate.textContent?.includes(" + JSON.stringify(containsText) + ")";
    const point = await evaluate<{ x: number; y: number; height: number; visible: boolean } | null>(
      "(() => { const element = [...document.querySelectorAll(" + JSON.stringify(selector) + ")]"
      + ".find(candidate => " + textCondition + "); if (!element) return null;"
      + " element.scrollIntoView({ block: 'center', inline: 'nearest' });"
      + " const bounds = element.getBoundingClientRect(); const x = bounds.left + bounds.width / 2;"
      + " const y = bounds.top + bounds.height / 2; const hit = document.elementFromPoint(x, y);"
      + " return { x, y, height: bounds.height, visible: bounds.width > 0 && bounds.height > 0"
      + " && Boolean(hit && (hit === element || element.contains(hit))) }; })()",
    );
    assert.ok(point, "Browser target " + selector + " was not found.");
    assert.ok(point!.visible, "Browser target " + selector + " was not pixel-clickable.");
    return point!;
  };

  const dispatchClick = async (point: { x: number; y: number }) => {
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };

  const tap = async (selector: string, containsText?: string) => {
    const point = await pointFor(selector, containsText);
    await dispatchClick(point);
    return { height: Math.round(point.height) };
  };

  const tapTwice = async (selector: string, containsText: string) => {
    const point = await pointFor(selector, containsText);
    await dispatchClick(point);
    await dispatchClick(point);
    return { height: Math.round(point.height) };
  };

  const saveScreenshot = async (name: string) => {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const data = (screenshot.result as { data?: string } | undefined)?.data;
    assert.ok(data, "The browser did not return screenshot data.");
    const evidenceDirectory = resolve(root, "docs/phase-11-browser-evidence");
    if (!evidenceDirectory.startsWith(root + sep)) throw new Error("Browser evidence must stay inside the repository.");
    mkdirSync(evidenceDirectory, { recursive: true });
    const path = join(evidenceDirectory, new Date().toISOString().replace(/[:.]/g, "-") + "-" + name + ".png");
    writeFileSync(path, Buffer.from(data!, "base64"));
    return path.slice(root.length + 1).replaceAll("\\", "/");
  };

  try {
    browserProcess = spawn(browserExecutable, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--user-data-dir=" + profile,
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    const activePortPath = join(profile, "DevToolsActivePort");
    for (let attempt = 0; attempt < 100 && !existsSync(activePortPath); attempt += 1) {
      if (browserProcess.exitCode !== null) throw new Error("The browser exited before its debug port opened.");
      await delay(100);
    }
    if (!existsSync(activePortPath)) throw new Error("The browser DevTools port did not open.");
    const debugPort = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];
    const targets = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json() as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const pageTarget = targets.find((item) => item.type === "page");
    if (!pageTarget) throw new Error("The browser did not provide a page target.");

    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown> & {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (message.method === "Network.requestWillBeSent") {
        const request = message.params?.request as { url?: string; method?: string } | undefined;
        if (request?.method === "POST" && request.url?.endsWith("/api/chairman/fee-rates")) mutationPosts.feeRates += 1;
        if (request?.method === "POST" && request.url?.endsWith("/api/chairman/adjustments")) mutationPosts.adjustments += 1;
      }
      if (message.method === "Runtime.exceptionThrown") pageErrors.push("runtime exception");
      if (message.method === "Log.entryAdded") {
        const entry = message.params?.entry as { level?: string } | undefined;
        if (entry?.level === "error") pageErrors.push("console error");
      }
      if (typeof message.id !== "number") return;
      const resolveMessage = pendingCommands.get(message.id);
      if (resolveMessage) {
        pendingCommands.delete(message.id);
        resolveMessage(message);
      }
    });
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => rejectOpen(new Error("Browser DevTools connection failed.")), { once: true });
    });
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
    await command("Log.enable");
    for (const part of chairmanCookie.split("; ")) {
      const separator = part.indexOf("=");
      await command("Network.setCookie", {
        name: part.slice(0, separator),
        value: part.slice(separator + 1),
        url: baseUrl,
        sameSite: "Lax",
      });
    }

    const viewportEvidence: Array<{ page: string; width: number; overflow: boolean; touchTargets: number[] }> = [];
    await navigate("/app/tarif", { width: 390, height: 844 });
    await waitFor("document.querySelector('#chairman-rate-title')?.innerText === 'Tarif iuran'", "Tariff screen did not render.");
    await waitFor("document.querySelector('.chairman-rate-form') !== null", "Tariff data and form controls did not finish loading.");
    assert.equal(await setValue("#chairman-rate-month", "12", "select"), true);
    assert.equal(await setValue("#chairman-rate-amount", "70000"), true);
    await waitFor("document.querySelector('.chairman-rate-preview strong')?.innerText.includes('70.000')", "Tariff preview did not appear.");
    const rateButton = await tapTwice(".chairman-rate-primary", "Catat tarif baru");
    assert.ok(rateButton.height >= 44, "The tariff submission control is below 44px.");
    await waitFor("[...document.querySelectorAll('[role=status]')].some(item => item.innerText.includes('Tarif baru berhasil dicatat'))", "Tariff submission did not reach success.");
    await delay(200);
    assert.equal(mutationPosts.feeRates, 1, "A tariff confirmation double tap sent more than one mutation.");

    for (const viewport of chairmanBrowserViewports) {
      await navigate("/app/tarif", viewport);
      await waitFor("document.querySelector('.chairman-rate-form') !== null && document.querySelector('.chairman-rate-list') !== null", "Tariff history did not finish loading at " + viewport.width + "px.");
      const view = await evaluate<{ overflow: boolean; heights: number[]; rateVisible: boolean }>(
        "(() => { const controls = ['#chairman-rate-year', '#chairman-rate-month', '#chairman-rate-amount', '.chairman-rate-primary']"
        + ".map(selector => document.querySelector(selector)).filter(Boolean); return {"
        + " overflow: document.documentElement.scrollWidth > window.innerWidth + 1,"
        + " heights: controls.map(item => Math.round(item.getBoundingClientRect().height)),"
        + " rateVisible: document.querySelector('.chairman-rate-list')?.innerText.includes('70.000') ?? false }; })()",
      );
      assert.equal(view.overflow, false, "Tariff page overflows at " + viewport.width + "px.");
      assert.equal(view.rateVisible, true, "Tariff history omits the new entry at " + viewport.width + "px.");
      assert.ok(view.heights.every((height) => height >= 44), "A tariff control is below 44px at " + viewport.width + "px.");
      viewportEvidence.push({ page: "tariff", width: viewport.width, overflow: view.overflow, touchTargets: view.heights });
      if (viewport.width === 390) await saveScreenshot("chairman-tariff-mobile-390x844");
      if (viewport.width === 1440) await saveScreenshot("chairman-tariff-desktop-1440x900");
    }

    const selectHouseholdDue = async (houseNumber: string, period: string) => {
      await navigate("/app/penyesuaian", { width: 390, height: 844 });
      await waitFor("document.querySelector('#chairman-adjustment-search') !== null", "Chairman adjustment search did not finish loading.");
      assert.equal(await setValue("#chairman-adjustment-search", houseNumber), true);
      await waitFor("document.querySelector('.chairman-adjustment-household') !== null", "Chairman household search did not return its fixture.");
      await tap(".chairman-adjustment-household", "Rumah " + houseNumber);
      await waitFor("document.querySelector('.chairman-adjustment-due') !== null", "Chairman due list did not render.");
      await tap(".chairman-adjustment-due", period);
    };

    await selectHouseholdDue(pendingHouseNumber, "November 2027");
    const pendingBlock = await evaluate<{ text: string; overflow: boolean; primaryCount: number }>(
      "(() => ({ text: document.querySelector('.chairman-adjustment-block')?.innerText ?? '',"
      + " overflow: document.documentElement.scrollWidth > window.innerWidth + 1,"
      + " primaryCount: document.querySelectorAll('.chairman-adjustment-primary').length }))()",
    );
    assert.match(pendingBlock.text, /permintaan pembayaran yang masih menunggu/i);
    assert.equal(pendingBlock.overflow, false);
    assert.equal(pendingBlock.primaryCount, 0, "The pending request state must not expose an adjustment action.");

    await selectHouseholdDue(paidHouseNumber, "November 2027");
    await tap(".chairman-adjustment-directions label", "Kurangi kewajiban");
    await setValue("#chairman-adjustment-amount", "10000");
    await setValue("#chairman-adjustment-reason", "Uji blok saldo kredit dari layar", "textarea");
    await waitFor("document.querySelector('.chairman-adjustment-error')?.innerText.includes('melebihi kewajiban')", "Negative credit preview was not blocked.");
    const creditBlock = await evaluate<{ disabled: boolean; overflow: boolean }>(
      "(() => ({ disabled: document.querySelector('.chairman-adjustment-primary')?.disabled ?? true,"
      + " overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }))()",
    );
    assert.equal(creditBlock.disabled, true, "Negative credit preview must block the review action.");
    assert.equal(creditBlock.overflow, false);

    await selectHouseholdDue(adjustmentHouseNumber, "Desember 2027");
    await setValue("#chairman-adjustment-amount", "1000");
    await setValue("#chairman-adjustment-reason", "Uji alur penyesuaian Ketua RT", "textarea");
    await waitFor("document.querySelector('.chairman-adjustment-preview-columns')?.innerText.includes('61.000')", "Adjustment preview did not show the effective target.");
    await tap(".chairman-adjustment-primary", "Tinjau penyesuaian");
    await waitFor("document.querySelector('.chairman-adjustment-confirm') !== null", "Adjustment confirmation did not render.");

    for (const viewport of chairmanBrowserViewports) {
      await setViewport(viewport);
      await delay(100);
      const view = await evaluate<{ overflow: boolean; household: boolean; period: boolean; amount: boolean; actionHeight: number }>(
        "(() => { const confirm = document.querySelector('.chairman-adjustment-confirm');"
        + " const text = confirm?.innerText.replace(/\\s+/g, ' ') ?? '';"
        + " const action = confirm?.querySelector('.chairman-adjustment-primary'); return {"
        + " overflow: document.documentElement.scrollWidth > window.innerWidth + 1,"
        + " household: document.body.innerText.includes(" + JSON.stringify("Rumah " + adjustmentHouseNumber) + "),"
        + " period: text.includes('Desember 2027'), amount: text.includes('61.000'),"
        + " actionHeight: action ? Math.round(action.getBoundingClientRect().height) : 0 }; })()",
      );
      assert.equal(view.overflow, false, "Adjustment page overflows at " + viewport.width + "px.");
      assert.equal(view.household, true, "Adjustment confirmation lost the household at " + viewport.width + "px.");
      assert.equal(view.period, true, "Adjustment confirmation lost the period at " + viewport.width + "px.");
      assert.equal(view.amount, true, "Adjustment confirmation lost the preview amount at " + viewport.width + "px.");
      assert.ok(view.actionHeight >= 44, "Adjustment confirmation CTA is below 44px at " + viewport.width + "px.");
      viewportEvidence.push({ page: "adjustment-confirmation", width: viewport.width, overflow: view.overflow, touchTargets: [view.actionHeight] });
      if (viewport.width === 390) await saveScreenshot("chairman-adjustment-mobile-390x844");
      if (viewport.width === 1440) await saveScreenshot("chairman-adjustment-desktop-1440x900");
    }

    await setViewport({ width: 390, height: 844 });
    const adjustmentButton = await tapTwice(".chairman-adjustment-confirm .chairman-adjustment-primary", "Konfirmasi penyesuaian");
    assert.ok(adjustmentButton.height >= 44);
    await waitFor("[...document.querySelectorAll('[role=status]')].some(item => item.innerText.includes('Penyesuaian berhasil dicatat'))", "Adjustment did not reach success.");
    await delay(200);
    assert.equal(mutationPosts.adjustments, 1, "An adjustment confirmation double tap sent more than one mutation.");
    assert.equal(pageErrors.length, 0, "Chairman browser flow emitted a page exception or console error.");
    return {
      viewports: chairmanBrowserViewports.map((viewport) => viewport.width + "x" + viewport.height),
      viewportEvidence,
      pendingRequestBlocked: true,
      negativeCreditBlocked: true,
      feeRateMutationPosts: mutationPosts.feeRates,
      adjustmentMutationPosts: mutationPosts.adjustments,
      pageErrors,
    };
  } finally {
    socket?.close();
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
      browserProcess.kill();
      await Promise.race([once(browserProcess, "exit"), delay(5000)]);
    }
    const resolvedProfile = resolve(profile);
    if (resolvedProfile.startsWith(tempRoot + sep)) rmSync(resolvedProfile, { recursive: true, force: true });
  }
}

async function main() {
  loadEnvConfig(root);
  process.env.NEXT_PUBLIC_APP_URL = baseUrl;
  assertSourceBranch();
  const verifiedTarget = assertDevelopmentTarget();
  if (process.argv.includes("--guard-only")) {
    console.info(JSON.stringify({
      event: "phase11.http-smoke.guard-pass",
      target: { project: target.projectId, branch: target.branchId, database: target.databaseName, directEndpointVerified: verifiedTarget.databaseHost.startsWith(target.endpointId) },
      source: { featureBranch: "feat/phase-11-tariff-adjustment", f10BaselineAncestorVerified: true },
      operation: "No database connection or mutation performed.",
    }));
    return;
  }
  if (process.argv.includes("--diagnose-head")) {
    currentStage = "read-only approved-target database and F10 head diagnosis";
    await diagnoseDevelopmentHeadReadOnly();
    return;
  }
  requireAuthEnvironment();

  currentStage = "verify approved development database migration head";
  const databaseTarget = assertDevelopmentTarget();
  assert.equal(databaseTarget.databaseHost, verifiedTarget.databaseHost);
  await databaseIdentity();
  const f10Hash = migrationHash(baselineMigration);
  const f11Hash = migrationHash(nextMigration);
  const migrationHead = await currentMigrationHash();
  let preservedRows: number | null = null;
  const resumedExistingF11 = process.argv.includes("--resume-f11");
  if (migrationHead === f10Hash && !resumedExistingF11) {
    await assertPortFree();
    currentStage = "snapshot existing F10 financial history before migration";
    const historyBeforeMigration = await snapshotFinancialHistory();

    currentStage = "revalidate exact F10 head and migrate approved development database to F11";
    const migrationTarget = assertDevelopmentTarget();
    assert.equal(migrationTarget.databaseHost, verifiedTarget.databaseHost);
    await databaseIdentity();
    assert.equal(await verifyMigrationHead(baselineMigration), f10Hash);
    await migrate(getDb(), { migrationsFolder: resolve(root, "drizzle") });
    await closeDb();

    currentStage = "verify F11 migration head and historical row preservation";
    await databaseIdentity();
    assert.equal(await verifyMigrationHead(nextMigration), f11Hash);
    const historyAfterMigration = await snapshotFinancialHistory();
    preservedRows = assertHistoryPreserved(historyBeforeMigration, historyAfterMigration);
  } else if (resumedExistingF11 && migrationHead === f11Hash) {
    currentStage = "verify already migrated F11 development head before resuming smoke";
    await verifyMigrationHead(nextMigration);
    await snapshotFinancialHistory();
  } else {
    throw new Error("The approved development database must be at the exact F10 baseline or an explicitly resumed F11 head.");
  }

  currentStage = "start local development server on F11";
  await assertPortFree();
  await startNext();
  currentStage = "create synthetic F11 fixture dataset";
  const fixtures = await createFixtures();
  const { scenarios } = fixtures;
  const paidScenario = scenarios.get("paid")!;
  const paidNovemberScenario = scenarios.get("tariff-paid-november")!;
  const pendingNovemberScenario = scenarios.get("tariff-pending-november")!;
  const unpaidScenario = scenarios.get("unpaid")!;
  const negativeScenario = scenarios.get("negative")!;

  const chairmanCookie = await signIn("official", fixtures.chairman);
  const treasurerCookie = await signIn("official", fixtures.treasurer);
  const residentCookies = new Map<string, string>();
  const residentSessions = new Map<string, string>();
  for (const [purpose, scenario] of scenarios) {
    let cookie = residentSessions.get(scenario.resident.accountId);
    if (!cookie) {
      cookie = await signIn("resident", scenario.resident);
      residentSessions.set(scenario.resident.accountId, cookie);
    }
    residentCookies.set(purpose, cookie);
  }

  currentStage = "create initial future tariff schedule through Chairman HTTP API";
  const tariffJanuary = await createTariff(chairmanCookie, fixtures.billingYearId, 1, 40000);
  const tariffApril = await createTariff(chairmanCookie, fixtures.billingYearId, 4, 50000);
  const tariffSeptember = await createTariff(chairmanCookie, fixtures.billingYearId, 9, 40000);
  assert.deepEqual([
    [tariffJanuary.rate.effectiveMonth, tariffJanuary.rate.monthlyAmount],
    [tariffApril.rate.effectiveMonth, tariffApril.rate.monthlyAmount],
    [tariffSeptember.rate.effectiveMonth, tariffSeptember.rate.monthlyAmount],
  ], [[1, 40000], [4, 50000], [9, 40000]]);
  await generateFixtureDues(fixtures);

  currentStage = "create verified and pending snapshots through normal F11 HTTP APIs";
  const paidFebruaryRequest = await createRequest(residentCookies.get("paid")!, "2027-02", 40000);
  await verifyRequest(treasurerCookie, paidFebruaryRequest.requestCode, 40000);
  const paidNovemberRequest = await createRequest(residentCookies.get("tariff-paid-november")!, "2027-11", 40000);
  await verifyRequest(treasurerCookie, paidNovemberRequest.requestCode, 40000);
  const pendingNovemberRequest = await createRequest(residentCookies.get("tariff-pending-november")!, "2027-11", 40000);

  const paidFebruaryDueId = paidScenario.dues.get(2)!;
  const paidNovemberDueId = paidNovemberScenario.dues.get(11)!;
  const pendingNovemberDueId = pendingNovemberScenario.dues.get(11)!;
  const oldPaymentRows = await getDb().select({ id: payments.id, amount: payments.amount })
    .from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, paidFebruaryDueId));
  assert.equal(oldPaymentRows.length, 1);
  assert.equal(oldPaymentRows[0]!.amount, 40000);

  const paidNovemberBeforeTariff = await getDb().select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
    .from(monthlyDues).where(eq(monthlyDues.id, paidNovemberDueId));
  const pendingNovemberBeforeTariff = await getDb().select({ amount: paymentRequestItems.amount, requestId: paymentRequestItems.requestId })
    .from(paymentRequestItems).innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestItems.requestId))
    .where(and(eq(paymentRequestItems.monthlyDueId, pendingNovemberDueId), eq(paymentRequests.requestCode, pendingNovemberRequest.requestCode)));
  assert.equal(paidNovemberBeforeTariff[0]?.amount, 40000);
  assert.equal(pendingNovemberBeforeTariff[0]?.amount, 40000);

  currentStage = "unpaid original obligation plus positive adjustment and full payment";
  const unpaidDueId = unpaidScenario.dues.get(1)!;
  const adjustmentIdempotencyKey = randomUUID();
  const firstPositiveAdjustment = await createAdjustment(chairmanCookie, unpaidDueId, 10000, 200, adjustmentIdempotencyKey);
  const replayedPositiveAdjustment = await createAdjustment(chairmanCookie, unpaidDueId, 10000, 200, adjustmentIdempotencyKey);
  assert.ok(firstPositiveAdjustment.id);
  assert.equal(replayedPositiveAdjustment.idempotentReplay, true);
  const conflictingReplay = await createAdjustment(chairmanCookie, unpaidDueId, 5000, 409, adjustmentIdempotencyKey);
  assert.ok(conflictingReplay.message);
  assert.equal(await getDb().select().from(dueAdjustments).where(eq(dueAdjustments.monthlyDueId, unpaidDueId)).then((rows) => rows.length), 1);
  const unpaidBalance = (await getDueFinancialBalances(getDb(), [unpaidDueId]))[0]!;
  assert.deepEqual(
    [unpaidBalance.originalAmount, unpaidBalance.adjustmentTotal, unpaidBalance.effectiveTarget, unpaidBalance.activeReceived, unpaidBalance.outstanding],
    [40000, 10000, 50000, 0, 50000],
  );
  const unpaidRequest = await createRequest(residentCookies.get("unpaid")!, "2027-01", 50000);
  const unpaidSnapshot = await getDb().select({ amount: paymentRequestItems.amount })
    .from(paymentRequestItems).innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestItems.requestId))
    .where(eq(paymentRequests.requestCode, unpaidRequest.requestCode));
  assert.deepEqual(unpaidSnapshot.map((item) => item.amount), [50000]);
  await verifyRequest(treasurerCookie, unpaidRequest.requestCode, 50000);
  const unpaidSettled = (await getDueFinancialBalances(getDb(), [unpaidDueId]))[0]!;
  assert.deepEqual([unpaidSettled.effectiveTarget, unpaidSettled.activeReceived, unpaidSettled.outstanding, unpaidSettled.status], [50000, 50000, 0, "paid"]);

  currentStage = "paid due plus positive adjustment and second full payment without rewriting original history";
  const paidAdjustmentRowsBefore = await getDb().select({
    requestId: payments.paymentRequestId,
    paymentId: payments.id,
    paymentAmount: payments.amount,
    allocationId: paymentAllocations.id,
    allocationAmount: paymentAllocations.amount,
  }).from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, paidFebruaryDueId));
  assert.equal(paidAdjustmentRowsBefore.length, 1);
  await createAdjustment(chairmanCookie, paidFebruaryDueId, 10000);
  const paidAfterAdjustment = (await getDueFinancialBalances(getDb(), [paidFebruaryDueId]))[0]!;
  assert.deepEqual([paidAfterAdjustment.originalAmount, paidAfterAdjustment.effectiveTarget, paidAfterAdjustment.activeReceived, paidAfterAdjustment.outstanding, paidAfterAdjustment.status], [40000, 50000, 40000, 10000, "unpaid"]);
  const repaymentRequest = await createRequest(residentCookies.get("paid")!, "2027-02", 10000);
  await verifyRequest(treasurerCookie, repaymentRequest.requestCode, 10000);
  const paidAdjustmentRowsAfter = await getDb().select({
    requestId: payments.paymentRequestId,
    paymentId: payments.id,
    paymentAmount: payments.amount,
    allocationId: paymentAllocations.id,
    allocationAmount: paymentAllocations.amount,
  }).from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, paidFebruaryDueId))
    .orderBy(paymentAllocations.amount);
  assert.equal(paidAdjustmentRowsAfter.length, 2);
  assert.ok(paidAdjustmentRowsAfter.some((row) =>
    row.paymentId === paidAdjustmentRowsBefore[0]!.paymentId && row.paymentAmount === 40000 && row.allocationAmount === 40000 && row.allocationId === paidAdjustmentRowsBefore[0]!.allocationId,
  ));
  assert.ok(paidAdjustmentRowsAfter.some((row) => row.paymentAmount === 10000 && row.allocationAmount === 10000));
  const paidSettled = (await getDueFinancialBalances(getDb(), [paidFebruaryDueId]))[0]!;
  assert.deepEqual([paidSettled.effectiveTarget, paidSettled.activeReceived, paidSettled.outstanding, paidSettled.status], [50000, 50000, 0, "paid"]);

  currentStage = "negative adjustment against remaining balance after historical receipt";
  await createAdjustment(chairmanCookie, paidFebruaryDueId, 10000);
  const higherTargetBalance = (await getDueFinancialBalances(getDb(), [paidFebruaryDueId]))[0]!;
  assert.deepEqual([higherTargetBalance.effectiveTarget, higherTargetBalance.activeReceived, higherTargetBalance.outstanding], [60000, 50000, 10000]);
  await createAdjustment(chairmanCookie, paidFebruaryDueId, -5000);
  const reducedTargetBalance = (await getDueFinancialBalances(getDb(), [paidFebruaryDueId]))[0]!;
  assert.deepEqual([reducedTargetBalance.effectiveTarget, reducedTargetBalance.activeReceived, reducedTargetBalance.outstanding], [55000, 50000, 5000]);
  const finalBalanceRequest = await createRequest(residentCookies.get("paid")!, "2027-02", 5000);
  await verifyRequest(treasurerCookie, finalBalanceRequest.requestCode, 5000);
  const finalPaidRows = await getDb().select({ paymentAmount: payments.amount, allocationAmount: paymentAllocations.amount })
    .from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, paidFebruaryDueId));
  assert.equal(finalPaidRows.length, 3);
  assert.deepEqual(finalPaidRows.reduce((sum, row) => sum + row.allocationAmount, 0), 55000);
  const finalPaidBalance = (await getDueFinancialBalances(getDb(), [paidFebruaryDueId]))[0]!;
  assert.deepEqual([finalPaidBalance.effectiveTarget, finalPaidBalance.activeReceived, finalPaidBalance.outstanding, finalPaidBalance.status], [55000, 55000, 0, "paid"]);

  currentStage = "direct database over-allocation rejection after multiple active allocations";
  const invalidPaymentId = randomUUID();
  const invalidCashKey = randomUUID();
  let overAllocationError: unknown;
  try {
    await getDb().transaction(async (transaction) => {
      await transaction.insert(payments).values({
        id: invalidPaymentId,
        rtUnitId: fixtures.rtUnitId,
        householdId: paidScenario.resident.householdId,
        paymentRequestId: null,
        amount: 1,
        method: "cash",
        verifiedByAccountId: fixtures.treasurer.accountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: invalidCashKey,
        cashIdempotencyFingerprint: createHash("sha256").update(invalidCashKey).digest("hex"),
      });
      const [allocation] = await transaction.insert(paymentAllocations).values({
        rtUnitId: fixtures.rtUnitId,
        householdId: paidScenario.resident.householdId,
        paymentRequestId: null,
        paymentId: invalidPaymentId,
        monthlyDueId: paidFebruaryDueId,
        amount: 1,
      }).returning({ id: paymentAllocations.id });
      await transaction.insert(activeDueSettlements).values({
        rtUnitId: fixtures.rtUnitId,
        householdId: paidScenario.resident.householdId,
        paymentId: invalidPaymentId,
        allocationId: allocation!.id,
        monthlyDueId: paidFebruaryDueId,
        amount: 1,
      });
      await transaction.insert(auditEvents).values({
        actorAppAccountId: fixtures.treasurer.accountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: invalidPaymentId,
        reason: null,
        context: { itemCount: 1, method: "cash", totalAmount: 1 },
      });
    });
  } catch (error) {
    overAllocationError = error;
  }
  assert.ok(overAllocationError, "The database accepted an extra allocation above the effective target.");
  let errorProbe: unknown = overAllocationError;
  let overAllocationCode: unknown;
  let overAllocationConstraint: unknown;
  for (let depth = 0; depth < 5 && errorProbe && typeof errorProbe === "object"; depth += 1) {
    const fields = errorProbe as { code?: unknown; constraint?: unknown; cause?: unknown };
    overAllocationCode ??= fields.code;
    overAllocationConstraint ??= fields.constraint;
    errorProbe = fields.cause;
  }
  assert.equal(overAllocationCode, "23514");
  assert.equal(overAllocationConstraint, "payment_allocation_due_unpaid");
  assert.equal(await getDb().select().from(payments).where(eq(payments.id, invalidPaymentId)).then((rows) => rows.length), 0);
  assert.equal(await getDb().select().from(activeDueSettlements).where(eq(activeDueSettlements.monthlyDueId, paidFebruaryDueId)).then((rows) => rows.length), 3);

  currentStage = "pending request protection against positive adjustment";
  const pendingAdjustmentResponse = await createAdjustment(chairmanCookie, pendingNovemberDueId, 10000, 409);
  assert.ok(pendingAdjustmentResponse.message);
  assert.equal(await getDb().select().from(dueAdjustments).where(eq(dueAdjustments.monthlyDueId, pendingNovemberDueId)).then((rows) => rows.length), 0);
  const pendingNovemberSnapshot = await getDb().select({ amount: paymentRequestItems.amount, status: paymentRequests.status })
    .from(paymentRequestItems).innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestItems.requestId))
    .where(eq(paymentRequestItems.monthlyDueId, pendingNovemberDueId));
  assert.deepEqual(pendingNovemberSnapshot, [{ amount: 40000, status: "pending" }]);
  assert.equal(await getDb().select().from(paymentRequestClaims).where(eq(paymentRequestClaims.monthlyDueId, pendingNovemberDueId)).then((rows) => rows.length), 1);
  const pendingBalance = (await getDueFinancialBalances(getDb(), [pendingNovemberDueId]))[0]!;
  assert.deepEqual([pendingBalance.originalAmount, pendingBalance.effectiveTarget, pendingBalance.outstanding, pendingBalance.hasPendingRequest], [40000, 40000, 40000, true]);

  currentStage = "negative adjustment before payment and full adjusted payment";
  const negativeDueId = negativeScenario.dues.get(6)!;
  const negativeBefore = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.equal(negativeBefore.originalAmount, 50000);
  await createAdjustment(chairmanCookie, negativeDueId, -10000);
  const negativeAdjusted = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.deepEqual([negativeAdjusted.originalAmount, negativeAdjusted.adjustmentTotal, negativeAdjusted.effectiveTarget, negativeAdjusted.activeReceived, negativeAdjusted.outstanding], [50000, -10000, 40000, 0, 40000]);
  const negativeRequest = await createRequest(residentCookies.get("negative")!, "2027-06", 40000);
  await verifyRequest(treasurerCookie, negativeRequest.requestCode, 40000);
  const negativeSettled = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.deepEqual([negativeSettled.effectiveTarget, negativeSettled.activeReceived, negativeSettled.outstanding, negativeSettled.status], [40000, 40000, 0, "paid"]);

  currentStage = "payment reversal followed by adjustment and full repayment";
  const negativePaymentRows = await getDb().select({ id: payments.id, amount: payments.amount })
    .from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, negativeDueId));
  assert.equal(negativePaymentRows.length, 1);
  assert.equal(negativePaymentRows[0]?.amount, 40000);
  const reversedPayment = await reversePayment(treasurerCookie, negativePaymentRows[0]!.id);
  assert.deepEqual([reversedPayment.status, reversedPayment.method, reversedPayment.totalAmount], ["reversed", "transfer", 40000]);
  const reversalRecord = await getDb().select({ paymentId: paymentReversals.paymentId })
    .from(paymentReversals).where(eq(paymentReversals.paymentId, negativePaymentRows[0]!.id));
  assert.deepEqual(reversalRecord, [{ paymentId: negativePaymentRows[0]!.id }]);
  const reversedBalance = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.deepEqual([reversedBalance.effectiveTarget, reversedBalance.activeReceived, reversedBalance.outstanding, reversedBalance.status], [40000, 0, 40000, "unpaid"]);
  await createAdjustment(chairmanCookie, negativeDueId, 10000);
  const postReversalAdjustment = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.deepEqual([postReversalAdjustment.effectiveTarget, postReversalAdjustment.activeReceived, postReversalAdjustment.outstanding], [50000, 0, 50000]);
  const negativeRepaymentRequest = await createRequest(residentCookies.get("negative")!, "2027-06", 50000);
  await verifyRequest(treasurerCookie, negativeRepaymentRequest.requestCode, 50000);
  const negativeRepaid = (await getDueFinancialBalances(getDb(), [negativeDueId]))[0]!;
  assert.deepEqual([negativeRepaid.effectiveTarget, negativeRepaid.activeReceived, negativeRepaid.outstanding, negativeRepaid.status], [50000, 50000, 0, "paid"]);

  currentStage = "WAIVED and NOT_DUE adjustment protections";
  const waivedDueId = unpaidScenario.dues.get(7)!;
  const waivedPeriod = await createWaiver(chairmanCookie, unpaidScenario.resident.householdId, "2027-07");
  assert.deepEqual(waivedPeriod.periods, ["2027-07"]);
  const waivedAdjustment = await createAdjustment(chairmanCookie, waivedDueId, 1000, 409);
  assert.ok(waivedAdjustment.message);
  assert.equal(await getDb().select().from(dueAdjustments).where(eq(dueAdjustments.monthlyDueId, waivedDueId)).then((rows) => rows.length), 0);
  const notDueId = pendingNovemberScenario.dues.get(3)!;
  const notDueAdjustment = await createAdjustment(chairmanCookie, notDueId, 1000, 409);
  assert.ok(notDueAdjustment.message);
  assert.equal(await getDb().select().from(dueAdjustments).where(eq(dueAdjustments.monthlyDueId, notDueId)).then((rows) => rows.length), 0);

  currentStage = "future tariff creation preserves generated paid and pending November snapshots";
  const tariff = await createTariff(chairmanCookie, fixtures.billingYearId, 11, 60000);
  assert.equal(tariff.rate.effectiveMonth, 11);
  assert.equal(tariff.rate.monthlyAmount, 60000);
  const paidNovemberAfterTariff = await getDb().select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
    .from(monthlyDues).where(eq(monthlyDues.id, paidNovemberDueId));
  assert.deepEqual(paidNovemberAfterTariff, paidNovemberBeforeTariff);
  const paidNovemberPaymentAfterTariff = await getDb().select({ amount: payments.amount, allocationAmount: paymentAllocations.amount })
    .from(payments).innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.monthlyDueId, paidNovemberDueId));
  assert.deepEqual(paidNovemberPaymentAfterTariff, [{ amount: 40000, allocationAmount: 40000 }]);
  const pendingNovemberAfterTariff = await getDb().select({ amount: paymentRequestItems.amount, requestId: paymentRequestItems.requestId })
    .from(paymentRequestItems).innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestItems.requestId))
    .where(eq(paymentRequestItems.monthlyDueId, pendingNovemberDueId));
  assert.deepEqual(pendingNovemberAfterTariff, pendingNovemberBeforeTariff);
  const pendingNovemberStatus = await getDb().select({ status: paymentRequests.status })
    .from(paymentRequests).innerJoin(paymentRequestItems, eq(paymentRequestItems.requestId, paymentRequests.id))
    .where(eq(paymentRequestItems.monthlyDueId, pendingNovemberDueId));
  assert.deepEqual(pendingNovemberStatus, [{ status: "pending" }]);

  const futureResident = await createPerson(fixtures.rtUnitId, { purpose: "future tariff generation", startsOn: "2027-11-01" });
  const chairmanPrincipal: Principal = {
    authUserId: fixtures.chairman.authUserId,
    appAccountId: fixtures.chairman.accountId,
    role: "rt_chairman",
    rtUnitId: fixtures.rtUnitId,
    householdId: null,
    personId: fixtures.chairman.personId,
  };
  const futureDues = await generateHouseholdDues(getDb(), chairmanPrincipal, {
    householdId: futureResident.householdId,
    billingYearId: fixtures.billingYearId,
  });
  assert.equal(futureDues.insertedCount, 12);
  const generatedNovember = futureDues.rows.find((row) => row.month === 11);
  const generatedDecember = futureDues.rows.find((row) => row.month === 12);
  assert.equal(generatedNovember?.status, "unpaid");
  assert.equal(generatedDecember?.status, "unpaid");
  const generatedNovemberSnapshot = await getDb().select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
    .from(monthlyDues).where(eq(monthlyDues.id, generatedNovember!.id));
  assert.equal(generatedNovemberSnapshot[0]?.amount, 60000);
  assert.notEqual(generatedNovemberSnapshot[0]?.feeRateId, paidNovemberBeforeTariff[0]?.feeRateId);
  const generatedDecemberSnapshot = await getDb().select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
    .from(monthlyDues).where(eq(monthlyDues.id, generatedDecember!.id));
  assert.equal(generatedDecemberSnapshot[0]?.amount, 60000);

  const oldPaidNovRequest = await getDb().select({ itemAmount: paymentRequestItems.amount, requestAmount: paymentRequests.totalAmount })
    .from(paymentRequests).innerJoin(paymentRequestItems, eq(paymentRequestItems.requestId, paymentRequests.id))
    .where(eq(paymentRequests.requestCode, paidNovemberRequest.requestCode));
  assert.deepEqual(oldPaidNovRequest, [{ itemAmount: 40000, requestAmount: 40000 }]);

  currentStage = "responsive Chairman tariff and adjustment browser smoke";
  const chairmanBrowser = await testChairmanBrowserFlow(
    chairmanCookie,
    pendingNovemberScenario.resident.identifier,
    paidNovemberScenario.resident.identifier,
    futureResident.identifier,
  );
  const browserCreatedRate = await getDb().select({ monthlyAmount: feeRates.monthlyAmount })
    .from(feeRates).where(and(
      eq(feeRates.billingYearId, fixtures.billingYearId),
      eq(feeRates.effectiveMonth, 12),
    ));
  assert.deepEqual(browserCreatedRate, [{ monthlyAmount: 70000 }]);
  const browserAdjustedDue = (await getDueFinancialBalances(getDb(), [generatedDecember!.id]))[0]!;
  assert.deepEqual(
    [browserAdjustedDue.originalAmount, browserAdjustedDue.adjustmentTotal, browserAdjustedDue.effectiveTarget, browserAdjustedDue.activeReceived, browserAdjustedDue.outstanding],
    [60000, 1000, 61000, 0, 61000],
    "A later tariff must not reprice a generated due; the Chairman adjustment must update only its effective balance.",
  );

  currentStage = "independent pre-Gate-C financial dataset arithmetic";
  const preGateDueIds = [
    generatedDecember!.id,
    paidFebruaryDueId,
    waivedDueId,
    notDueId,
    negativeDueId,
    pendingNovemberDueId,
  ];
  const preGateDueRows = await getDb().select({ id: monthlyDues.id, amount: monthlyDues.amount, status: monthlyDues.status })
    .from(monthlyDues).where(inArray(monthlyDues.id, preGateDueIds));
  const preGateAdjustments = await getDb().select({ monthlyDueId: dueAdjustments.monthlyDueId, amountDelta: dueAdjustments.amountDelta })
    .from(dueAdjustments).where(inArray(dueAdjustments.monthlyDueId, preGateDueIds));
  const waivedRows = await getDb().select({ monthlyDueId: waiverItems.monthlyDueId, amount: waiverItems.amount })
    .from(waiverItems).where(inArray(waiverItems.monthlyDueId, preGateDueIds));
  const preGateBalances = await getDueFinancialBalances(getDb(), preGateDueIds);
  assert.equal(preGateDueRows.length, preGateDueIds.length);
  assert.equal(preGateBalances.length, preGateDueIds.length);
  const originalPotential = preGateDueRows.reduce((sum, row) => sum + row.amount, 0);
  const positiveAdjustments = preGateAdjustments.filter((row) => row.amountDelta > 0)
    .reduce((sum, row) => sum + row.amountDelta, 0);
  const negativeAdjustments = preGateAdjustments.filter((row) => row.amountDelta < 0)
    .reduce((sum, row) => sum - row.amountDelta, 0);
  const waivedAmount = waivedRows.reduce((sum, row) => sum + row.amount, 0);
  const payableOriginal = originalPotential - waivedAmount;
  const manualEffectiveTarget = payableOriginal + positiveAdjustments - negativeAdjustments;
  const payableBalances = preGateBalances.filter((balance) => balance.status === "paid" || balance.status === "unpaid");
  const databaseEffectiveTarget = payableBalances.reduce((sum, balance) => sum + balance.effectiveTarget, 0);
  const activeReceived = payableBalances.reduce((sum, balance) => sum + balance.activeReceived, 0);
  const outstanding = payableBalances.reduce((sum, balance) => sum + balance.outstanding, 0);
  assert.equal(databaseEffectiveTarget, manualEffectiveTarget);
  assert.equal(outstanding, databaseEffectiveTarget - activeReceived);
  assert.deepEqual(
    [originalPotential, payableOriginal, positiveAdjustments, negativeAdjustments, waivedAmount, databaseEffectiveTarget, activeReceived, outstanding],
    [240000, 190000, 31000, 15000, 50000, 206000, 105000, 101000],
    "Database totals must equal the independently computed pre-Gate-C dataset arithmetic.",
  );
  const preGateCDataset = {
    selectedDues: preGateDueRows.map((row) => ({ originalAmount: row.amount, status: row.status })),
    originalPotential: originalPotential,
    payableOriginal: payableOriginal,
    positiveAdjustments: positiveAdjustments,
    negativeAdjustments: negativeAdjustments,
    waivedAmount: waivedAmount,
    effectiveTarget: databaseEffectiveTarget,
    activeReceived: activeReceived,
    outstanding: outstanding,
    formula: "190000 + 31000 - 15000 = 206000; 206000 - 105000 = 101000; 50000 waived excluded from payable target",
  };

  console.info(JSON.stringify({
    event: "phase11.tariff-adjustment.development-http-smoke.pass",
    target: {
      environment: "development",
      project: target.projectId,
      branch: target.branchId,
      endpoint: target.endpointId,
      database: target.databaseName,
      direct: true,
    },
    migration: { from: baselineMigration, fromHash: f10Hash, to: nextMigration, toHash: f11Hash, resumedExistingF11, historicalRowsComparedBeforeAndAfter: preservedRows },
    preservedHistoricalFinancialRowsAcrossMigration: preservedRows,
    chairmanBrowser: chairmanBrowser,
    preGateCDataset: preGateCDataset,
    scenarios: {
      unpaidPositive: { original: 40000, adjustment: 10000, effectiveTarget: 50000, verifiedPayment: 50000, outstanding: 0 },
      paidPositive: { original: 40000, adjustment: 10000, secondPayment: 10000, activeAllocationsAfterAdditionalBalance: 3, activeReceivedAfterFinalPayment: 55000, outstanding: 0, originalPaymentPreserved: true },
      idempotency: { sameKeySameFingerprint: "replayed", sameKeyDifferentFingerprint: "conflict", duplicateLedgerRows: false },
      pendingProtection: { attemptedAdjustment: 10000, result: "blocked", requestSnapshot: 40000, requestStillPending: true },
      negativeBeforePayment: { original: 50000, adjustment: -10000, effectiveTarget: 40000, verifiedPayment: 40000, outstanding: 0 },
      negativeAfterHistoricalReceipt: { targetBeforeReduction: 60000, received: 50000, negativeAdjustment: -5000, finalTarget: 55000, finalPayment: 5000, outstanding: 0 },
      reversalAdjustmentRepayment: { original: 50000, initialAdjustment: -10000, reversedPayment: 40000, laterAdjustment: 10000, repayment: 50000, outstanding: 0, originalPaymentPreserved: true },
      terminalStateProtection: { waived: "blocked", notDue: "blocked", adjustmentRowsCreated: 0 },
      directDatabaseOverAllocation: { attemptedAmount: 1, databaseConstraint: "payment_allocation_due_unpaid", transactionRolledBack: true },
      futureTariff: { effectivePeriod: "2027-11", newAmount: 60000, existingPaidDueSnapshot: 40000, existingPendingRequestSnapshot: 40000, newlyGeneratedDueSnapshot: 60000 },
      browserUi: { newRateEffectiveMonth: 12, amount: 70000, existingDueSnapshot: 60000, adjustment: 1000, effectiveTarget: 61000, outstanding: 61000 },
    },
    syntheticRecords: "Financial and identity fixtures remain only on the verified development database; smoke login sessions are removed.",
  }));
}

loadEnvConfig(root);
process.env.NEXT_PUBLIC_APP_URL = baseUrl;
main()
  .catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnexpectedError";
    let safeReason = error instanceof Error ? error.message : "Unknown failure.";
    if (process.env.DATABASE_URL) safeReason = safeReason.replaceAll(process.env.DATABASE_URL, "[database url]");
    if (process.env.BETTER_AUTH_SECRET) safeReason = safeReason.replaceAll(process.env.BETTER_AUTH_SECRET, "[auth secret]");
    safeReason = safeReason
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database url]")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[id]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/\$2[aby]\$[^\s,;"']+/g, "[password hash]")
      .replace(/(?:Failed query|Query:)[\s\S]*/i, "Database operation failed; query details redacted.")
      .slice(0, 240);
    const errorRecord = error !== null && typeof error === "object"
      ? error as { code?: unknown; constraint?: unknown; cause?: unknown }
      : undefined;
    const causeRecord = errorRecord?.cause !== null && typeof errorRecord?.cause === "object"
      ? errorRecord.cause as { code?: unknown; constraint?: unknown }
      : undefined;
    const code = [errorRecord?.code, causeRecord?.code].find((value) => typeof value === "string");
    const constraint = [errorRecord?.constraint, causeRecord?.constraint].find((value) => typeof value === "string");
    console.error(JSON.stringify({
      event: "phase11.tariff-adjustment.development-http-smoke.fail",
      stage: currentStage,
      error: errorName,
      reason: safeReason,
      ...(code ? { databaseCode: code } : {}),
      ...(constraint ? { databaseConstraint: constraint } : {}),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopNext();
    if (userIds.length) {
      try {
        await getDb().delete(authSession).where(inArray(authSession.userId, userIds));
      } catch {
        // Keep synthetic financial history intact; session cleanup is best effort.
      }
    }
    await closeDb();
  });
