import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { appAccounts, auditEvents, authAccount, authSession, authUser, feeRates, households, houses, monthlyDues, officialAssignments, people } from "@/db/schema";
import { requireAuthEnvironment, requireDatabaseEnvironment } from "@/lib/env";

const baselineSha = "b933cc9a279d91191d6d7fa8c76f6202fbb68da5";
const target = { projectId: "billowing-base-57949906", branchId: "br-crimson-band-az6i637k", endpointId: "ep-quiet-cake-azrhjiyh", database: "neondb" } as const;
const expectedMigration = "0013_phase_12_household_management";
const sourceRoot = "D:\\!AGY\\karturt";
const root = process.cwd();
const port = 3212;
const baseUrl = "http://127.0.0.1:" + port;
const evidenceDir = resolve(root, "docs/phase-12-1-acceptance-evidence");
const runId = randomUUID();
let stage = "initialization";
let nextProcess: ChildProcess | undefined;
let browserProcess: ChildProcess | undefined;
let socket: WebSocket | undefined;
const pending = new Map<number, (message: Record<string, unknown>) => void>();
let commandId = 0;
const mutationCounts = { create: 0, edit: 0, reset: 0, deactivate: 0, replace: 0 };
const apiStatuses: Record<string, number[]> = {};
const authStatuses: Record<string, number[]> = {};
const lifecyclePayloadMonths: Array<{ path: string; month: string | null }> = [];
const viewportResults: Array<{ width: number; height: number; overflow: boolean; undersizedTargets: UndersizedTarget[] }> = [];
let safeDiagnostics: Record<string, unknown> | undefined;
let clockPreloadDir: string | undefined;

type Rows<T> = { rows?: T[] };

function writeEvidence(name: string, value: unknown) {
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, name);
  if (!path.startsWith(evidenceDir + sep)) throw new Error("Evidence path escaped its directory.");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  return path.slice(root.length + 1).replaceAll("\\", "/");
}

function assertSource() {
  const branch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (branch.status !== 0 || branch.stdout.trim() !== "fix/phase-12-1-acceptance-closure") throw new Error("Unexpected branch.");
  if (head.status !== 0) throw new Error("Current HEAD could not be resolved.");
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, "HEAD"], { cwd: root, stdio: "ignore" });
  if (ancestry.status !== 0) throw new Error("Current branch does not descend from the exact F12 baseline.");
  return head.stdout.trim();
}

function assertTarget() {
  if (process.env.APP_ENV !== "development" || process.env.DATABASE_ENV !== "development") throw new Error("Explicit development labels are missing.");
  const env = requireDatabaseEnvironment();
  if (process.env.KARTURT_NEON_DEV_PROJECT_ID !== target.projectId ||
      process.env.KARTURT_NEON_DEV_BRANCH_ID !== target.branchId ||
      process.env.KARTURT_NEON_DEV_ENDPOINT_ID !== target.endpointId) throw new Error("Approved development project and branch identifiers do not match.");
  const url = new URL(env.databaseUrl);
  if (url.hostname.split(".")[0]?.toLowerCase() !== target.endpointId ||
      !url.hostname.toLowerCase().endsWith(".neon.tech") ||
      url.hostname.toLowerCase().includes("pooler") ||
      url.pathname !== "/" + target.database) throw new Error("Database URL does not resolve to the approved direct development endpoint.");
  process.env.NEXT_PUBLIC_APP_URL = baseUrl;
  return { directEndpointVerified: true, localAppOrigin: baseUrl };
}

function expectedMigrationHash() {
  const migrationSource = readFileSync(resolve(root, "drizzle", expectedMigration + ".sql"), "utf8");
  return createHash("sha256").update(migrationSource.replace(/\r\n?/g, "\n")).digest("hex");
}

function identifyLocalMigration(hash: string | undefined) {
  if (!hash) return null;
  for (const fileName of readdirSync(resolve(root, "drizzle")).filter((name) => /^\d{4}_.+\.sql$/.test(name))) {
    const source = readFileSync(resolve(root, "drizzle", fileName), "utf8");
    const normalized = createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("hex");
    const raw = createHash("sha256").update(source).digest("hex");
    if ([normalized, raw].includes(hash.toLowerCase())) return fileName.replace(/\.sql$/, "");
  }
  return null;
}

async function readOnlyPreflight() {
  stage = "verify approved database name";
  const identity = await getDb().execute(sql.raw("SELECT current_database() AS database_name"));
  const dbName = (identity as unknown as Rows<{ database_name: string }>).rows?.[0]?.database_name;
  if (dbName !== target.database) throw new Error("Connected database name does not match the approved target.");
  stage = "read development migration journal";
  const journal = await getDb().execute(sql.raw("SELECT count(*)::int AS entries, (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS latest_hash FROM drizzle.__drizzle_migrations"));
  const row = (journal as unknown as Rows<{ entries: number; latest_hash: string }>).rows?.[0];
  stage = "verify exactly 14 migrations ending at 0013";
  if (!row || Number(row.entries) !== 14 || row.latest_hash?.toLowerCase() !== expectedMigrationHash()) {
    console.info(JSON.stringify({ preflight: "migration-journal", databaseName: dbName, entryCount: Number(row?.entries ?? 0), latest0013HashMatches: row?.latest_hash?.toLowerCase() === expectedMigrationHash(), latestMatchesLocalMigration: identifyLocalMigration(row?.latest_hash) }));
    throw new Error("Development migration journal is not exactly 14 entries ending at 0013.");
  }
  return { database: dbName, migrationEntries: Number(row.entries), migrationHead: expectedMigration, migrationHashMatches: true };
}

async function assertPortFree() {
  await new Promise<void>((resolveListen, rejectListen) => {
    const server = createServer();
    server.once("error", () => rejectListen(new Error("Smoke server port is occupied.")));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? rejectListen(error) : resolveListen()));
  });
}

function createClockPreload(businessDate: string) {
  if (!/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(businessDate)) throw new Error("Harness business date must be an explicit ISO date.");
  const tempBase = resolve(tmpdir());
  const directory = mkdtempSync(join(tempBase, "karturt-f12-clock-"));
  if (!resolve(directory).startsWith(tempBase + sep)) throw new Error("Clock preload escaped its disposable temp directory.");
  const preload = resolve(directory, "freeze-business-date.cjs");
  const [year, month, day] = businessDate.split("-");
  const script = `const nativeParts = Intl.DateTimeFormat.prototype.formatToParts;\nconst fixedParts = [{type:"year",value:${JSON.stringify(year)}},{type:"month",value:${JSON.stringify(month)}},{type:"day",value:${JSON.stringify(day)}}];\nIntl.DateTimeFormat.prototype.formatToParts = function(date) { const options = this.resolvedOptions(); if (options.timeZone === "Asia/Jakarta" && options.year === "numeric" && options.month === "2-digit" && options.day === "2-digit" && !options.hour) return fixedParts; return nativeParts.call(this, date); };\n`;
  writeFileSync(preload, script, { encoding: "utf8", flag: "wx" });
  clockPreloadDir = directory;
  return preload;
}

function cleanupClockPreload() {
  const tempBase = resolve(tmpdir());
  const directory = clockPreloadDir ? resolve(clockPreloadDir) : "";
  clockPreloadDir = undefined;
  if (directory && directory.startsWith(tempBase + sep)) rmSync(directory, { recursive: true, force: true });
}

async function startServer(simulatedBusinessDate?: string) {
  if (simulatedBusinessDate) cleanupClockPreload();
  await assertPortFree();
  const preload = simulatedBusinessDate ? createClockPreload(simulatedBusinessDate) : undefined;
  const preloadPath = preload?.replaceAll("\\", "/");
  const nodeOptions = [process.env.NODE_OPTIONS, preloadPath ? "--require=" + JSON.stringify(preloadPath) : ""].filter(Boolean).join(" ");
  nextProcess = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}), NODE_ENV: "development", APP_ENV: "development", DATABASE_ENV: "development", NEXT_PUBLIC_APP_URL: baseUrl },
    stdio: "ignore",
    windowsHide: true,
  });
  nextProcess.on("error", () => undefined);
  let lastStatus: number | null = null;
  let failedRequests = 0;
  for (let i = 0; i < 120; i += 1) {
    if (nextProcess.exitCode !== null) {
      safeDiagnostics = { simulatedBusinessDate: simulatedBusinessDate ?? "live", serverExited: true, exitCode: nextProcess.exitCode };
      throw new Error("Local development server exited before becoming ready.");
    }
    try {
      const response = await fetch(baseUrl + "/login/pengurus", { cache: "no-store" });
      lastStatus = response.status;
      if (response.ok) return;
    } catch { failedRequests += 1; }
    await delay(500);
  }
  safeDiagnostics = { simulatedBusinessDate: simulatedBusinessDate ?? "live", serverExited: nextProcess.exitCode !== null, exitCode: nextProcess.exitCode, lastHttpStatus: lastStatus, failedRequestCount: failedRequests };
  throw new Error("Local development server readiness timed out.");
}

async function stopServer() {
  const child = nextProcess;
  nextProcess = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
    await Promise.race([once(child, "exit"), delay(5000)]);
  }
}

async function activeResidentSessionCount(authUserId: string) {
  const rows = await getDb().select({ id: authSession.id }).from(authSession).where(and(eq(authSession.userId, authUserId), gt(authSession.expiresAt, new Date())));
  return rows.length;
}

async function residentAuditState(residentAccountId: string, sensitiveValues: string[] = []) {
  const rows = await getDb().select({ action: auditEvents.action, context: auditEvents.context })
    .from(auditEvents).where(and(eq(auditEvents.entityType, "resident_account"), eq(auditEvents.entityId, residentAccountId)));
  const resetEvents = rows.filter((row) => row.action === "resident.pin.reset");
  const contextText = JSON.stringify(resetEvents.map((row) => row.context)).toLowerCase();
  const valueStrings: string[] = [];
  const collectStringValues = (value: unknown) => {
    if (typeof value === "string") valueStrings.push(value);
    else if (Array.isArray(value)) for (const item of value) collectStringValues(item);
    else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectStringValues(item);
  };
  for (const row of resetEvents) collectStringValues(row.context);
  return {
    resetActionCount: resetEvents.length,
    resetContextContainsSubmittedSecret: sensitiveValues.filter(Boolean).some((value) => contextText.includes(value.toLowerCase())),
    resetContextHasHashLikeValue: valueStrings.some((value) => /\b[a-f0-9]{64}\b/i.test(value)),
    resetContextHasTokenLikeValue: valueStrings.some((value) => /(?:^|[^a-z0-9_-])[a-z0-9_-]{48,}(?:$|[^a-z0-9_-])/i.test(value)),
    resetContextHasPinLikeKey: /\"(?:pin|password|token|hash|secret)[a-z]*\"\s*:/.test(contextText),
  };
}

async function currentResidentSessionCookie() {
  const response = await cdp("Network.getAllCookies");
  const result = response.result as { cookies?: Array<{ name: string; value: string; domain: string; path: string }> } | undefined;
  const cookies = (result?.cookies ?? []).filter((cookie) => cookie.domain.includes("127.0.0.1") && cookie.name.toLowerCase().includes("session_token"));
  if (cookies.length === 0) throw new Error("Local browser session cookie was not available.");
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function savedCookieGet(path: string, cookie: string) {
  const response = await fetch(baseUrl + path, { headers: { cookie }, cache: "no-store" });
  return response.status;
}

async function loginThroughBrowser(kind: "warga" | "pengurus", identifier: string, password: string) {
  await navigate("/login/" + kind, { width: 390, height: 844 });
  await setInput("#login-identifier", identifier);
  await setInput("#login-password", password);
  await click("button.login-submit");
}

async function reuseSyntheticChairmanFixture(rotateCredential = true) {
  const password = randomBytes(24).toString("base64url");
  stage = "read-only identify newest reusable synthetic Chairman fixture";
  const result = await getDb().execute(sql.raw("SELECT unit.id::text AS rt_unit_id, unit.code AS rt_code, unit.created_at, (SELECT h.id::text FROM public.houses h WHERE h.rt_unit_id = unit.id ORDER BY h.created_at LIMIT 1) AS house_id, (SELECT h.number FROM public.houses h WHERE h.rt_unit_id = unit.id ORDER BY h.created_at LIMIT 1) AS house_number, (SELECT hh.id::text FROM public.households hh WHERE hh.rt_unit_id = unit.id ORDER BY hh.created_at LIMIT 1) AS household_id, (SELECT p.id::text FROM public.people p WHERE p.rt_unit_id = unit.id ORDER BY p.created_at LIMIT 1) AS person_id, (SELECT a.id::text FROM public.app_accounts a JOIN public.official_assignments assignment ON assignment.app_account_id = a.id AND assignment.rt_unit_id = a.rt_unit_id WHERE a.rt_unit_id = unit.id AND a.account_type = 'official' AND a.status = 'active' AND assignment.role = 'rt_chairman' ORDER BY a.created_at LIMIT 1) AS account_id, (SELECT a.auth_user_id FROM public.app_accounts a JOIN public.official_assignments assignment ON assignment.app_account_id = a.id AND assignment.rt_unit_id = a.rt_unit_id WHERE a.rt_unit_id = unit.id AND a.account_type = 'official' AND a.status = 'active' AND assignment.role = 'rt_chairman' ORDER BY a.created_at LIMIT 1) AS auth_user_id, (SELECT a.login_identifier FROM public.app_accounts a JOIN public.official_assignments assignment ON assignment.app_account_id = a.id AND assignment.rt_unit_id = a.rt_unit_id WHERE a.rt_unit_id = unit.id AND a.account_type = 'official' AND a.status = 'active' AND assignment.role = 'rt_chairman' ORDER BY a.created_at LIMIT 1) AS login_identifier, (SELECT y.id::text FROM public.billing_years y WHERE y.rt_unit_id = unit.id AND y.year = 2026 AND y.status = 'open' LIMIT 1) AS billing_year_id, (SELECT count(*)::int FROM public.houses h WHERE h.rt_unit_id = unit.id) AS houses, (SELECT count(*)::int FROM public.households hh WHERE hh.rt_unit_id = unit.id) AS households, (SELECT count(*)::int FROM public.people p WHERE p.rt_unit_id = unit.id) AS people, (SELECT count(*)::int FROM public.app_accounts a WHERE a.rt_unit_id = unit.id) AS app_accounts, (SELECT count(*)::int FROM public.billing_years y WHERE y.rt_unit_id = unit.id) AS billing_years, (SELECT count(*)::int FROM public.fee_rates f WHERE f.rt_unit_id = unit.id) AS fee_rates, (SELECT count(*)::int FROM public.rt_settings s WHERE s.rt_unit_id = unit.id) AS settings, (SELECT count(*)::int FROM public.account credential WHERE credential.\"userId\" = (SELECT a.auth_user_id FROM public.app_accounts a JOIN public.official_assignments assignment ON assignment.app_account_id = a.id AND assignment.rt_unit_id = a.rt_unit_id WHERE a.rt_unit_id = unit.id AND a.account_type = 'official' AND assignment.role = 'rt_chairman' ORDER BY a.created_at LIMIT 1) AND credential.\"providerId\" = 'credential') AS credentials FROM public.rt_units unit WHERE unit.name LIKE 'F12 QA synthetic RT %' AND (SELECT count(*) FROM public.houses h WHERE h.rt_unit_id = unit.id) >= 1 AND (SELECT count(*) FROM public.households hh WHERE hh.rt_unit_id = unit.id) >= 1 AND (SELECT count(*) FROM public.people p WHERE p.rt_unit_id = unit.id) >= 1 AND (SELECT count(*) FROM public.app_accounts a WHERE a.rt_unit_id = unit.id) >= 1 AND (SELECT count(*) FROM public.billing_years y WHERE y.rt_unit_id = unit.id) = 1 AND (SELECT count(*) FROM public.fee_rates f WHERE f.rt_unit_id = unit.id) <= 1 ORDER BY unit.created_at DESC LIMIT 1"));
  const fixture = (result as unknown as Rows<{ rt_unit_id: string; rt_code: string; house_id: string; house_number: string; household_id: string; person_id: string; account_id: string; auth_user_id: string; login_identifier: string; billing_year_id: string; houses: number; households: number; people: number; app_accounts: number; billing_years: number; fee_rates: number; settings: number; credentials: number }>).rows?.[0];
  if (!fixture || !fixture.rt_unit_id || !fixture.household_id || !fixture.account_id || !fixture.auth_user_id || !fixture.billing_year_id ||
      [fixture.houses, fixture.households, fixture.people, fixture.app_accounts, fixture.billing_years, fixture.settings, fixture.credentials].some((value) => Number(value) < 1) ||
      Number(fixture.fee_rates) > 1) throw new Error("No complete partial synthetic Chairman fixture is available for safe reuse.");
  if (rotateCredential) {
    stage = "rotate credential for synthetic Chairman fixture only";
    const credentialRows = await getDb().update(authAccount).set({ password: await hashPassword(password) })
      .where(and(eq(authAccount.userId, fixture.auth_user_id), eq(authAccount.providerId, "credential")))
      .returning({ id: authAccount.id });
    if (credentialRows.length !== 1) throw new Error("Synthetic Chairman credential was not uniquely reusable.");
  }
  return {
    rtUnitId: fixture.rt_unit_id, rtCode: fixture.rt_code, householdId: fixture.household_id,
    houseId: fixture.house_id, houseNumber: fixture.house_number, personId: fixture.person_id,
    authUserId: fixture.auth_user_id, accountId: fixture.account_id, identifier: fixture.login_identifier,
    password, billingYearId: fixture.billing_year_id, existingFeeRateCount: Number(fixture.fee_rates), reusedExistingFixture: true,
  };
}

async function inspectExistingSyntheticFixtures() {
  stage = "read-only inspect prior synthetic fixture rows";
  const result = await getDb().execute(sql.raw("SELECT unit.id::text AS rt_unit_id, unit.code, (SELECT count(*)::int FROM public.houses h WHERE h.rt_unit_id = unit.id) AS houses, (SELECT count(*)::int FROM public.households hh WHERE hh.rt_unit_id = unit.id) AS households, (SELECT count(*)::int FROM public.people p WHERE p.rt_unit_id = unit.id) AS people, (SELECT count(*)::int FROM public.app_accounts a WHERE a.rt_unit_id = unit.id) AS app_accounts, (SELECT count(*)::int FROM public.billing_years y WHERE y.rt_unit_id = unit.id) AS billing_years, (SELECT count(*)::int FROM public.fee_rates f WHERE f.rt_unit_id = unit.id) AS fee_rates FROM public.rt_units unit WHERE unit.name LIKE 'F12 QA synthetic RT %' ORDER BY unit.created_at"));
  const rows = (result as unknown as Rows<{ rt_unit_id: string; code: string; houses: number; households: number; people: number; app_accounts: number; billing_years: number; fee_rates: number }>).rows ?? [];
  const normalized = rows.map((row) => ({ ...row, houses: Number(row.houses), households: Number(row.households), people: Number(row.people), app_accounts: Number(row.app_accounts), billing_years: Number(row.billing_years), fee_rates: Number(row.fee_rates) }));
  const evidence = writeEvidence("agent-a-" + runId + "-fixture-inspection.json", { runId, target: { projectId: target.projectId, branchId: target.branchId, database: target.database }, readOnly: true, fixtures: normalized });
  console.info(JSON.stringify({ outcome: "PASS", stage, syntheticFixtureCount: normalized.length, fixtures: normalized, evidence }));
}

async function cdp(method: string, params: Record<string, unknown> = {}) {
  const id = ++commandId;
  const response = new Promise<Record<string, unknown>>((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => { pending.delete(id); rejectMessage(new Error("Browser command timed out.")); }, method === "Page.navigate" ? 120000 : 30000);
    pending.set(id, (message) => { clearTimeout(timer); if (message.error) rejectMessage(new Error("Browser command failed.")); else resolveMessage(message); });
  });
  socket!.send(JSON.stringify({ id, method, params }));
  return response;
}

async function evaluate<T>(expression: string): Promise<T> {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const payload = result.result as { result?: { value?: T }; exceptionDetails?: unknown };
  if (payload?.exceptionDetails) throw new Error("Browser evaluation failed.");
  return payload?.result?.value as T;
}

async function waitFor(expression: string, message: string) {
  for (let i = 0; i < 240; i += 1) {
    if (await evaluate<boolean>(expression)) return;
    await delay(100);
  }
  throw new Error(message);
}

async function navigate(path: string, viewport: { width: number; height: number }) {
  await setViewport(viewport);
  const url = baseUrl + path;
  await cdp("Page.navigate", { url });
  await waitFor("location.href === " + JSON.stringify(url) + " && document.readyState === 'complete'", "Browser navigation did not complete.");
  await delay(150);
}

async function setViewport(viewport: { width: number; height: number }) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 430 });
  await cdp("Emulation.setTouchEmulationEnabled", viewport.width <= 768 ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
}

type UndersizedTarget = { selector: string; width: number; height: number };

async function inspectViewportTargets() {
  return evaluate<{ overflow: boolean; undersizedTargets: UndersizedTarget[] }>("(() => { const actionable=[...document.querySelectorAll('button,a[href],input,select,textarea,[role=button]')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'});const undersizedTargets=actionable.map(e=>{const r=e.getBoundingClientRect();return {selector:e.id?'#'+e.id:(e.getAttribute('role')==='button'?'[role=button]':e.tagName.toLowerCase()),width:Math.round(r.width),height:Math.round(r.height)}}).filter(t=>t.width<44||t.height<44);return {overflow:document.documentElement.scrollWidth>innerWidth+1,undersizedTargets}})()");
}

async function checkCurrentViewports(stateName: string) {
  const checks: Array<{ state: string; width: number; height: number; overflow: boolean; undersizedTargets: UndersizedTarget[] }> = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await setViewport(viewport);
    await delay(80);
    const view = await inspectViewportTargets();
    assert.equal(view.overflow, false, "Horizontal overflow in " + stateName + " at " + viewport.width + "px.");
    assert.equal(view.undersizedTargets.length, 0, "Visible actionable target under 44px in " + stateName + " at " + viewport.width + "px.");
    checks.push({ state: stateName, ...viewport, overflow: view.overflow, undersizedTargets: view.undersizedTargets });
  }
  await setViewport({ width: 390, height: 844 });
  return checks;
}

async function setInput(selector: string, value: string) {
  return evaluate<boolean>("(() => { const e = document.querySelector(" + JSON.stringify(selector) + "); if (!e) return false; const p = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(p, 'value')?.set; setter?.call(e, " + JSON.stringify(value) + "); e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true; })()");
}

async function pointFor(selector: string, text?: string) {
  const condition = text === undefined ? "true" : "e.textContent?.includes(" + JSON.stringify(text) + ")";
  const point = await evaluate<{ x: number; y: number; height: number } | null>("(() => { const e = [...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(e => " + condition + "); if (!e) return null; e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect(); return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2,height:r.height}:null; })()");
  if (!point) throw new Error("Expected browser control was not found.");
  return point;
}

async function click(selector: string, text?: string) {
  const point = await pointFor(selector, text);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return point.height;
}

async function screenshot(name: string) {
  const result = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const data = (result.result as { data?: string } | undefined)?.data;
  if (!data) throw new Error("Browser screenshot was unavailable.");
  const path = resolve(evidenceDir, "agent-a-" + runId + "-" + name + ".png");
  if (!path.startsWith(evidenceDir + sep)) throw new Error("Screenshot path escaped its evidence directory.");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path, Buffer.from(data, "base64"), { flag: "wx" });
  return path.slice(root.length + 1).replaceAll("\\", "/");
}

async function startBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
  ].filter((value): value is string => Boolean(value));
  const browser = candidates.find((value) => existsSync(value));
  if (!browser) throw new Error("Chrome or Edge was not found.");
  const tempBase = resolve(tmpdir());
  const profile = mkdtempSync(join(tempBase, "karturt-f12-qa-"));
  if (!resolve(profile).startsWith(tempBase + sep)) throw new Error("Temporary browser profile escaped its safe directory.");
  try {
    browserProcess = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--remote-allow-origins=*", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore", windowsHide: true });
    const activePort = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !existsSync(activePort); i += 1) await delay(100);
    if (!existsSync(activePort)) throw new Error("Browser DevTools did not open.");
    const debugPort = readFileSync(activePort, "utf8").split(/\r?\n/)[0];
    const targets = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((item) => item.type === "page");
    if (!page) throw new Error("Browser page target was not available.");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown> };
      if (message.method === "Network.requestWillBeSent") {
        const request = message.params?.request as { url?: string; method?: string; postData?: string } | undefined;
        if (request?.method === "POST" && request.url?.includes("/api/chairman/households") && !request.url.includes("/deactivate") && !request.url.includes("/replace")) mutationCounts.create += 1;
        if (request?.method === "PATCH" && request.url?.includes("/api/chairman/households/")) mutationCounts.edit += 1;
        if (request?.method === "POST" && request.url?.includes("/reset-pin")) mutationCounts.reset += 1;
        if (request?.method === "POST" && request.url?.includes("/deactivate")) mutationCounts.deactivate += 1;
        if (request?.method === "POST" && request.url?.includes("/replace")) mutationCounts.replace += 1;
        if (request?.method === "POST" && (request.url?.includes("/deactivate") || request.url?.includes("/replace"))) {
          let month: string | null = null;
          try {
            const body = JSON.parse(request.postData ?? "{}") as Record<string, unknown>;
            const candidate = request.url.includes("/replace") ? body.effectiveMonth : body.activeThroughMonth;
            if (typeof candidate === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) month = candidate;
          } catch {}
          lifecyclePayloadMonths.push({ path: new URL(request.url).pathname, month });
        }
      }
      if (message.method === "Network.responseReceived") {
        const response = message.params?.response as { url?: string; status?: number } | undefined;
        if (response?.url && typeof response.status === "number") {
          const path = new URL(response.url).pathname;
          if (path.startsWith("/api/")) (apiStatuses[path] ??= []).push(response.status);
          if (path.startsWith("/api/login/")) (authStatuses[path] ??= []).push(response.status);
        }
      }
      if (typeof message.id === "number") {
        const resolveMessage = pending.get(message.id);
        if (resolveMessage) { pending.delete(message.id); resolveMessage(message); }
      }
    });
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => rejectOpen(new Error("Browser DevTools connection failed.")), { once: true });
    });
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Network.enable");
    return profile;
  } catch (error) {
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) browserProcess.kill();
    const resolved = resolve(profile);
    if (resolved.startsWith(tempBase + sep)) rmSync(resolved, { recursive: true, force: true });
    throw error;
  }
}

async function stopBrowser(profile: string) {
  socket?.close();
  if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
    browserProcess.kill();
    await Promise.race([once(browserProcess, "exit"), delay(5000)]);
  }
  const tempBase = resolve(tmpdir());
  const resolved = resolve(profile);
  if (resolved.startsWith(tempBase + sep)) rmSync(resolved, { recursive: true, force: true });
}

async function collectNewHousehold(rtUnitId: string, houseNumber: string) {
  const rows = await getDb().select({ householdId: households.id, houseId: houses.id, startsOn: households.startsOn, status: households.status, houseNumber: houses.number })
    .from(households).innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
    .where(and(eq(households.rtUnitId, rtUnitId), eq(houses.number, houseNumber)));
  const household = rows[0];
  if (!household) throw new Error("UI-created synthetic household was not found.");
  const residentRows = await getDb().select({ personId: people.id, fullName: people.fullName, accountId: appAccounts.id, authUserId: appAccounts.authUserId })
    .from(people).leftJoin(appAccounts, and(eq(appAccounts.personId, people.id), eq(appAccounts.accountType, "resident")))
    .where(eq(people.householdId, household.householdId));
  const dueRows = await getDb().select({ id: monthlyDues.id, month: monthlyDues.month, amount: monthlyDues.amount, status: monthlyDues.status })
    .from(monthlyDues).where(eq(monthlyDues.householdId, household.householdId));
  return { ...household, resident: residentRows[0] ?? null, dues: dueRows.map((row) => ({ id: row.id, period: "2026-" + String(row.month).padStart(2, "0"), amount: row.amount, status: row.status })) };
}

async function createInitialFutureTariff(rtUnitId: string, billingYearId: string) {
  stage = "read existing synthetic tariff in reused RT";
  const existingRates = await getDb().select({ id: feeRates.id, billingYearId: feeRates.billingYearId, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
    .from(feeRates).where(eq(feeRates.rtUnitId, rtUnitId));
  if (existingRates.length === 1) {
    const existing = existingRates[0]!;
    if (existing.billingYearId !== billingYearId || existing.effectiveMonth !== 11 || existing.monthlyAmount !== 50000) {
      throw new Error("Reused synthetic tariff did not match the future period and amount.");
    }
    return existing.id;
  }
  if (existingRates.length > 1) throw new Error("Reused synthetic RT has multiple tariff rows.");
  stage = "create synthetic future tariff through authenticated Chairman API";
  const idempotencyKey = randomUUID();
  const expression = "(async()=>{const r=await fetch('/api/chairman/fee-rates',{method:'POST',headers:{'content-type':'application/json','idempotency-key':" + JSON.stringify(idempotencyKey) + "},body:JSON.stringify({billingYearId:" + JSON.stringify(billingYearId) + ",effectiveMonth:11,monthlyAmount:50000})});const j=await r.json().catch(()=>null);return {status:r.status,rateId:j?.rate?.id??null,billingYearId:j?.rate?.billingYearId??null};})()";
  const response = await evaluate<{ status: number; rateId: string | null; billingYearId: string | null }>(expression);
  if (response.status !== 200) throw new Error("Synthetic future tariff API returned an unexpected status.");
  if (!response.rateId || response.billingYearId !== billingYearId) throw new Error("Synthetic tariff API returned an unexpected sanitized result.");
  return response.rateId;
}

async function readQaSeedAttempts(reusedRtUnitId: string) {
  const result = await getDb().execute(sql.raw("SELECT id::text AS rt_unit_id FROM public.rt_units WHERE name LIKE 'F12 QA synthetic RT %' ORDER BY created_at"));
  const rows = (result as unknown as Rows<{ rt_unit_id: string }>).rows ?? [];
  return rows.map((row) => ({ rtUnitId: row.rt_unit_id, state: row.rt_unit_id === reusedRtUnitId ? "reused" : "leftover_partial" }));
}

const historyKinds = [
  "paymentRequests", "paymentRequestItems", "paymentRequestClaims", "payments", "paymentAllocations",
  "activeDueSettlements", "paymentReversals", "dueAdjustments", "waiverActions", "waiverItems",
] as const;
type HistoryKind = (typeof historyKinds)[number];
type OwnerRow = { key: string; rtUnitId: string; householdId: string };
type DueSnapshot = { id: string; billingYear: number; month: number; amount: number; dueDate: string; status: string; feeRateId: string | null; waivedReason: string | null };

async function readActiveQaHouseholds(rtUnitId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(rtUnitId)) throw new Error("Synthetic RT identity was invalid.");
  const result = await getDb().execute(sql.raw(`
    SELECT household.id::text AS household_id, house.id::text AS house_id, house.number AS house_number,
      household.starts_on::text AS starts_on, person.id::text AS person_id, account.id::text AS account_id,
      account.auth_user_id AS auth_user_id, account.login_identifier AS login_identifier
    FROM public.households household
    JOIN public.houses house ON house.rt_unit_id = household.rt_unit_id AND house.id = household.house_id
    JOIN LATERAL (
      SELECT person.id FROM public.people person
      WHERE person.rt_unit_id = household.rt_unit_id AND person.household_id = household.id AND person.is_active = true
      ORDER BY person.created_at LIMIT 1
    ) person ON true
    JOIN LATERAL (
      SELECT account.id, account.auth_user_id, account.login_identifier FROM public.app_accounts account
      WHERE account.rt_unit_id = household.rt_unit_id AND account.household_id = household.id
        AND account.person_id = person.id AND account.account_type = 'resident' AND account.status = 'active'
      ORDER BY account.created_at LIMIT 1
    ) account ON true
    WHERE household.rt_unit_id = '${rtUnitId}'::uuid AND house.number LIKE 'QA12-%'
      AND household.status = 'active' AND household.starts_on = '2026-11-01'::date
      AND EXISTS (
        SELECT 1 FROM public.monthly_dues due JOIN public.billing_years year
          ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
        WHERE due.rt_unit_id = household.rt_unit_id AND due.household_id = household.id
          AND year.year = 2026 AND due.month = 11 AND due.status = 'unpaid'
      )
      AND EXISTS (
        SELECT 1 FROM public.monthly_dues due JOIN public.billing_years year
          ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
        WHERE due.rt_unit_id = household.rt_unit_id AND due.household_id = household.id
          AND year.year = 2026 AND due.month = 12 AND due.status = 'unpaid'
      )
    ORDER BY household.created_at DESC, household.id
  `));
  return (result as unknown as Rows<{ household_id: string; house_id: string; house_number: string; starts_on: string; person_id: string; account_id: string; auth_user_id: string; login_identifier: string }>).rows ?? [];
}

async function readForeignQaHousehold(currentRtUnitId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(currentRtUnitId)) throw new Error("Synthetic RT identity was invalid.");
  const result = await getDb().execute(sql.raw(`
    SELECT household.id::text AS household_id, person.id::text AS person_id, person.full_name AS full_name,
      household.rt_unit_id::text AS rt_unit_id
    FROM public.households household
    JOIN public.houses house ON house.rt_unit_id = household.rt_unit_id AND house.id = household.house_id
    JOIN public.people person ON person.rt_unit_id = household.rt_unit_id AND person.household_id = household.id
    WHERE household.rt_unit_id <> '${currentRtUnitId}'::uuid AND house.number LIKE 'QA12-%'
      AND household.status = 'active' AND person.is_active = true
    ORDER BY household.created_at DESC, person.created_at LIMIT 1
  `));
  return (result as unknown as Rows<{ household_id: string; person_id: string; full_name: string; rt_unit_id: string }>).rows?.[0] ?? null;
}

async function readQaTreasurer(rtUnitId: string, businessDate: string) {
  if (!/^[0-9a-f-]{36}$/i.test(rtUnitId) || !/^20\d\d-\d\d-\d\d$/.test(businessDate)) throw new Error("Synthetic Treasurer lookup scope was invalid.");
  const result = await getDb().execute(sql.raw(`
    SELECT account.id::text AS account_id, account.auth_user_id AS auth_user_id,
      account.login_identifier AS login_identifier, assignment.starts_on::text AS starts_on,
      assignment.ends_on::text AS ends_on
    FROM public.app_accounts account
    JOIN public.official_assignments assignment
      ON assignment.rt_unit_id = account.rt_unit_id AND assignment.app_account_id = account.id
    WHERE account.rt_unit_id = '${rtUnitId}'::uuid AND account.account_type = 'official'
      AND account.status = 'active' AND assignment.role = 'treasurer'
      AND assignment.starts_on <= '${businessDate}'::date
      AND (assignment.ends_on IS NULL OR assignment.ends_on >= '${businessDate}'::date)
    ORDER BY account.created_at LIMIT 1
  `));
  return (result as unknown as Rows<{ account_id: string; auth_user_id: string; login_identifier: string; starts_on: string; ends_on: string | null }>).rows?.[0] ?? null;
}

async function createSyntheticTreasurer(rtUnitId: string, personId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(rtUnitId) || !/^[0-9a-f-]{36}$/i.test(personId)) throw new Error("Synthetic Treasurer identity scope was invalid.");
  const authUserId = randomUUID();
  const loginIdentifier = "F12QA-TREASURER-" + randomUUID().replaceAll("-", "").slice(0, 20);
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const accountId = await getDb().transaction(async (transaction) => {
    await transaction.insert(authUser).values({
      id: authUserId,
      name: "F12 QA synthetic Treasurer",
      email: randomUUID() + "@example.invalid",
      emailVerified: true,
    });
    const [account] = await transaction.insert(appAccounts).values({
      rtUnitId,
      authUserId,
      accountType: "official",
      loginIdentifier,
      personId,
      householdId: null,
    }).returning({ id: appAccounts.id });
    if (!account?.id) throw new Error("Synthetic Treasurer application account was not created.");
    await transaction.insert(authAccount).values({
      id: randomUUID(),
      accountId: authUserId,
      providerId: "credential",
      userId: authUserId,
      password: passwordHash,
    });
    await transaction.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account.id,
      role: "treasurer",
      startsOn: "2026-11-01",
    });
    return account.id;
  });
  return { accountId, authUserId, loginIdentifier, password };
}

async function readDueSnapshots(householdId: string): Promise<DueSnapshot[]> {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) throw new Error("Synthetic household identity was invalid.");
  const result = await getDb().execute(sql.raw(`
    SELECT due.id::text AS id, year.year::int AS billing_year, due.month::int AS month,
      due.amount::int AS amount, due.due_date::text AS due_date, due.status::text AS status,
      due.fee_rate_id::text AS fee_rate_id, due.waived_reason
    FROM public.monthly_dues due
    JOIN public.billing_years year ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
    WHERE due.household_id = '${householdId}'::uuid
    ORDER BY year.year, due.month
  `));
  const rows = (result as unknown as Rows<{ id: string; billing_year: number; month: number; amount: number; due_date: string; status: string; fee_rate_id: string | null; waived_reason: string | null }>).rows ?? [];
  return rows.map((row) => ({ id: row.id, billingYear: Number(row.billing_year), month: Number(row.month), amount: Number(row.amount), dueDate: row.due_date, status: row.status, feeRateId: row.fee_rate_id, waivedReason: row.waived_reason }));
}

async function readLifecycleState(householdId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) throw new Error("Synthetic household identity was invalid.");
  const result = await getDb().execute(sql.raw(`
    SELECT household.id::text AS household_id, household.rt_unit_id::text AS rt_unit_id,
      household.house_id::text AS house_id, household.status::text AS household_status,
      household.starts_on::text AS starts_on, household.ends_on::text AS ends_on,
      house.number AS house_number, person.id::text AS person_id, person.is_active AS person_is_active,
      account.id::text AS account_id, account.auth_user_id AS auth_user_id,
      account.status::text AS account_status, account.login_identifier AS login_identifier
    FROM public.households household
    JOIN public.houses house ON house.rt_unit_id = household.rt_unit_id AND house.id = household.house_id
    LEFT JOIN public.people person ON person.rt_unit_id = household.rt_unit_id AND person.household_id = household.id
    LEFT JOIN public.app_accounts account ON account.rt_unit_id = household.rt_unit_id
      AND account.household_id = household.id AND account.person_id = person.id AND account.account_type = 'resident'
    WHERE household.id = '${householdId}'::uuid
    ORDER BY person.created_at, account.created_at LIMIT 1
  `));
  const row = (result as unknown as Rows<{ household_id: string; rt_unit_id: string; house_id: string; household_status: string; starts_on: string; ends_on: string | null; house_number: string; person_id: string | null; person_is_active: boolean | null; account_id: string | null; auth_user_id: string | null; account_status: string | null; login_identifier: string | null }>).rows?.[0];
  if (!row) throw new Error("Expected synthetic household lifecycle row was not found.");
  return { householdId: row.household_id, rtUnitId: row.rt_unit_id, houseId: row.house_id, status: row.household_status, startsOn: row.starts_on, endsOn: row.ends_on, houseNumber: row.house_number, personId: row.person_id, personIsActive: row.person_is_active, accountId: row.account_id, authUserId: row.auth_user_id, accountStatus: row.account_status, loginIdentifier: row.login_identifier };
}

function householdScopeOwnerQueries(rtUnitId: string, householdId: string) {
  return [
    ["paymentRequests", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_requests WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["paymentRequestItems", `SELECT request_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_request_items WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["paymentRequestClaims", `SELECT claim.request_id::text || '/' || claim.monthly_due_id::text AS key, due.rt_unit_id::text AS \"rtUnitId\", due.household_id::text AS \"householdId\" FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id=claim.monthly_due_id WHERE due.rt_unit_id='${rtUnitId}'::uuid AND due.household_id='${householdId}'::uuid`],
    ["payments", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payments WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["paymentAllocations", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_allocations WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["activeDueSettlements", `SELECT allocation_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.active_due_settlements WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["paymentReversals", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_reversals WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["dueAdjustments", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.due_adjustments WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["waiverActions", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.waiver_actions WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
    ["waiverItems", `SELECT waiver_action_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.waiver_items WHERE rt_unit_id='${rtUnitId}'::uuid AND household_id='${householdId}'::uuid`],
  ] as const;
}

async function readFinancialOwnership(scope: { kind: "household"; rtUnitId: string; householdId: string } | { kind: "due"; dueId: string }): Promise<Record<HistoryKind, OwnerRow[]>> {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (scope.kind === "household" && (!uuid.test(scope.rtUnitId) || !uuid.test(scope.householdId))) throw new Error("Synthetic financial ownership scope was invalid.");
  if (scope.kind === "due" && !uuid.test(scope.dueId)) throw new Error("Synthetic due identity was invalid.");
  const queries = scope.kind === "household" ? householdScopeOwnerQueries(scope.rtUnitId, scope.householdId) : [
    ["paymentRequests", `SELECT DISTINCT request.id::text AS key, request.rt_unit_id::text AS \"rtUnitId\", request.household_id::text AS \"householdId\" FROM public.payment_requests request JOIN public.payment_request_items item ON item.request_id=request.id WHERE item.monthly_due_id='${scope.dueId}'::uuid`],
    ["paymentRequestItems", `SELECT request_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_request_items WHERE monthly_due_id='${scope.dueId}'::uuid`],
    ["paymentRequestClaims", `SELECT claim.request_id::text || '/' || claim.monthly_due_id::text AS key, due.rt_unit_id::text AS \"rtUnitId\", due.household_id::text AS \"householdId\" FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id=claim.monthly_due_id WHERE claim.monthly_due_id='${scope.dueId}'::uuid`],
    ["payments", `SELECT DISTINCT payment.id::text AS key, payment.rt_unit_id::text AS \"rtUnitId\", payment.household_id::text AS \"householdId\" FROM public.payments payment JOIN public.payment_allocations allocation ON allocation.payment_id=payment.id WHERE allocation.monthly_due_id='${scope.dueId}'::uuid`],
    ["paymentAllocations", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.payment_allocations WHERE monthly_due_id='${scope.dueId}'::uuid`],
    ["activeDueSettlements", `SELECT allocation_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.active_due_settlements WHERE monthly_due_id='${scope.dueId}'::uuid`],
    ["paymentReversals", `SELECT DISTINCT reversal.id::text AS key, reversal.rt_unit_id::text AS \"rtUnitId\", reversal.household_id::text AS \"householdId\" FROM public.payment_reversals reversal JOIN public.payment_allocations allocation ON allocation.payment_id=reversal.payment_id WHERE allocation.monthly_due_id='${scope.dueId}'::uuid`],
    ["dueAdjustments", `SELECT id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.due_adjustments WHERE monthly_due_id='${scope.dueId}'::uuid`],
    ["waiverActions", `SELECT DISTINCT action.id::text AS key, action.rt_unit_id::text AS \"rtUnitId\", action.household_id::text AS \"householdId\" FROM public.waiver_actions action JOIN public.waiver_items item ON item.waiver_action_id=action.id WHERE item.monthly_due_id='${scope.dueId}'::uuid`],
    ["waiverItems", `SELECT waiver_action_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS \"rtUnitId\", household_id::text AS \"householdId\" FROM public.waiver_items WHERE monthly_due_id='${scope.dueId}'::uuid`],
  ] as const;
  const grouped = Object.fromEntries(historyKinds.map((kind) => [kind, []])) as unknown as Record<HistoryKind, OwnerRow[]>;
  for (const [kind, query] of queries) {
    const result = await getDb().execute(sql.raw(query));
    const rows = (result as unknown as Rows<OwnerRow>).rows ?? [];
    grouped[kind as HistoryKind] = rows.map((row) => ({ key: row.key, rtUnitId: row.rtUnitId, householdId: row.householdId })).sort((a, b) => a.key.localeCompare(b.key));
  }
  return grouped;
}

type FinancialContentRow = { rowKey: string; content: Array<string | null> };

async function readFinancialContentRows(dueId: string): Promise<Record<HistoryKind, FinancialContentRow[]>> {
  if (!/^[0-9a-f-]{36}$/i.test(dueId)) throw new Error("Synthetic due identity was invalid.");
  const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')`;
  const row = (rowKey: string, fields: string[]) => `SELECT ${rowKey} AS \"rowKey\", ARRAY[${fields.join(", ")}]::text[] AS content`;
  const queries: Record<HistoryKind, string> = {
    paymentRequests: `${row("request.id::text", ["request.id::text", "request.rt_unit_id::text", "request.household_id::text", "request.status::text", "request.total_amount::text", "request.item_count::text", isoUtc("request.verified_at"), isoUtc("request.resolved_at"), isoUtc("request.created_at")])}
      FROM public.payment_requests request JOIN public.payment_request_items item ON item.request_id=request.id WHERE item.monthly_due_id='${dueId}'::uuid`,
    paymentRequestItems: `${row("item.request_id::text || '/' || item.monthly_due_id::text", ["item.request_id::text", "item.rt_unit_id::text", "item.household_id::text", "item.monthly_due_id::text", "item.period::text", "item.amount::text", isoUtc("item.created_at")])}
      FROM public.payment_request_items item WHERE item.monthly_due_id='${dueId}'::uuid`,
    paymentRequestClaims: `${row("claim.request_id::text || '/' || claim.monthly_due_id::text", ["claim.request_id::text", "claim.monthly_due_id::text", "due.rt_unit_id::text", "due.household_id::text", isoUtc("claim.claimed_at")])}
      FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id=claim.monthly_due_id WHERE claim.monthly_due_id='${dueId}'::uuid`,
    payments: `${row("payment.id::text", ["payment.id::text", "payment.rt_unit_id::text", "payment.household_id::text", "payment.payment_request_id::text", "payment.amount::text", "payment.method::text", isoUtc("payment.verified_at"), isoUtc("payment.created_at")])}
      FROM public.payments payment JOIN public.payment_allocations allocation ON allocation.payment_id=payment.id WHERE allocation.monthly_due_id='${dueId}'::uuid`,
    paymentAllocations: `${row("allocation.id::text", ["allocation.id::text", "allocation.rt_unit_id::text", "allocation.household_id::text", "allocation.payment_request_id::text", "allocation.payment_id::text", "allocation.monthly_due_id::text", "allocation.amount::text", isoUtc("allocation.created_at")])}
      FROM public.payment_allocations allocation WHERE allocation.monthly_due_id='${dueId}'::uuid`,
    activeDueSettlements: `${row("settlement.allocation_id::text", ["settlement.allocation_id::text", "settlement.rt_unit_id::text", "settlement.household_id::text", "settlement.payment_id::text", "settlement.monthly_due_id::text", "settlement.amount::text", isoUtc("settlement.created_at")])}
      FROM public.active_due_settlements settlement WHERE settlement.monthly_due_id='${dueId}'::uuid`,
    paymentReversals: `${row("reversal.id::text", ["reversal.id::text", "reversal.rt_unit_id::text", "reversal.household_id::text", "reversal.payment_id::text", isoUtc("reversal.reversed_at")])}
      FROM public.payment_reversals reversal JOIN public.payment_allocations allocation ON allocation.payment_id=reversal.payment_id WHERE allocation.monthly_due_id='${dueId}'::uuid`,
    dueAdjustments: `${row("adjustment.id::text", ["adjustment.id::text", "adjustment.rt_unit_id::text", "adjustment.household_id::text", "adjustment.monthly_due_id::text", "adjustment.amount_delta::text", "adjustment.effective_target_after::text", "adjustment.reason::text", "adjustment.adjusted_by_account_id::text", "adjustment.adjusted_by_account_type::text", "adjustment.idempotency_key::text", "adjustment.request_fingerprint::text", isoUtc("adjustment.created_at")])}
      FROM public.due_adjustments adjustment WHERE adjustment.monthly_due_id='${dueId}'::uuid`,
    waiverActions: `${row("action.id::text", ["action.id::text", "action.rt_unit_id::text", "action.household_id::text", "action.item_count::text", "action.total_amount::text", isoUtc("action.created_at")])}
      FROM public.waiver_actions action JOIN public.waiver_items item ON item.waiver_action_id=action.id WHERE item.monthly_due_id='${dueId}'::uuid`,
    waiverItems: `${row("item.waiver_action_id::text || '/' || item.monthly_due_id::text", ["item.waiver_action_id::text", "item.rt_unit_id::text", "item.household_id::text", "item.monthly_due_id::text", "item.period::text", "item.amount::text", isoUtc("item.created_at")])}
      FROM public.waiver_items item WHERE item.monthly_due_id='${dueId}'::uuid`,
  };
  const grouped = Object.fromEntries(historyKinds.map((kind) => [kind, []])) as unknown as Record<HistoryKind, FinancialContentRow[]>;
  for (const kind of historyKinds) {
    const result = await getDb().execute(sql.raw(queries[kind]));
    const rows = (result as unknown as Rows<FinancialContentRow>).rows ?? [];
    grouped[kind] = rows.map((item) => ({
      rowKey: item.rowKey,
      content: item.content.map((value) => value === null ? null : String(value)),
    })).sort((a, b) => a.rowKey.localeCompare(b.rowKey));
  }
  return grouped;
}

function financialContentFingerprint(rows: Record<HistoryKind, FinancialContentRow[]>) {
  const canonical = historyKinds.map((kind) => [kind, rows[kind].map((row) => row.content)]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function financialContentRowCount(rows: Record<HistoryKind, FinancialContentRow[]>) {
  return historyKinds.reduce((total, kind) => total + rows[kind].length, 0);
}

async function householdLifecycleAuditCount(householdId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) throw new Error("Synthetic household identity was invalid.");
  const result = await getDb().execute(sql.raw(`SELECT count(*)::int AS count FROM public.audit_events
    WHERE entity_type='household' AND entity_id='${householdId}'
      AND action IN ('household.deactivated','household.resident_replaced')`));
  return Number((result as unknown as Rows<{ count: number }>).rows?.[0]?.count ?? 0);
}

async function treasurerOverlapCount(rtUnitId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(rtUnitId)) throw new Error("Synthetic RT identity was invalid.");
  const result = await getDb().execute(sql.raw(`SELECT count(*)::int AS count FROM public.official_assignments
    WHERE rt_unit_id='${rtUnitId}'::uuid AND role='treasurer'
      AND (ends_on IS NULL OR ends_on >= '2026-11-01'::date)`));
  return Number((result as unknown as Rows<{ count: number }>).rows?.[0]?.count ?? 0);
}

function countOwnershipRows(owners: Record<HistoryKind, OwnerRow[]>) {
  return Object.fromEntries(historyKinds.map((kind) => [kind, owners[kind].length])) as Record<HistoryKind, number>;
}

function sourceProvenance() {
  const paths = [
    "scripts/phase-12-household-browser-smoke.ts",
    "src/components/chairman-household-management.tsx",
    "src/app/api/chairman/households/[householdId]/replace/route.ts",
    "src/app/api/chairman/households/[householdId]/deactivate/route.ts",
    "src/app/api/chairman/adjustments/route.ts",
  ];
  return Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")]));
}

function readPriorBrowserProof(expectedSourceHead: string) {
  const candidates = readdirSync(evidenceDir)
    .filter((name) => name.endsWith("-browser-smoke-results.json"))
    .map((name) => ({ name, mtimeMs: statSync(resolve(evidenceDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const requiredScenarios = ["chairmanLogin", "householdList", "search", "add", "edit", "residentLoginBeforeReset", "pinReset", "oldSessionRevoked", "oldPinRejected", "newPinLogin"];
  const requiredViewportSizes = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
  const expectedProvenance = sourceProvenance();
  for (const candidate of candidates) {
    const filePath = resolve(evidenceDir, candidate.name);
    let login: Record<string, unknown>;
    try { login = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>; } catch { continue; }
    const run = typeof login.runId === "string" ? login.runId : "";
    if (!run || existsSync(resolve(evidenceDir, "agent-a-" + run + "-failure.json"))) continue;
    const core = login.results as Record<string, unknown> | undefined;
    if (login.outcome !== "PASS" || !core || requiredScenarios.some((scenario) => core[scenario] !== "PASS") || core.mutationPosts !== 3) continue;
    const coreTarget = login.target as Record<string, unknown> | undefined;
    const preflight = login.preflight as Record<string, unknown> | undefined;
    const source = login.source as Record<string, unknown> | undefined;
    if (!coreTarget || coreTarget.projectId !== target.projectId || coreTarget.branchId !== target.branchId || coreTarget.database !== target.database ||
        login.migrationHead !== expectedMigration || !preflight || preflight.migrationHead !== expectedMigration ||
        preflight.migrationEntries !== 14 || preflight.migrationHashMatches !== true || !source || source.branch !== "fix/phase-12-1-acceptance-closure" ||
        source.baseline !== baselineSha || source.head !== expectedSourceHead || JSON.stringify(source.provenanceSha256) !== JSON.stringify(expectedProvenance)) continue;
    const coreViewports = login.viewportResults;
    if (!Array.isArray(coreViewports) || coreViewports.length !== requiredViewportSizes.length || requiredViewportSizes.some((required) => !coreViewports.some((item) => {
      if (typeof item !== "object" || item === null) return false;
      const viewport = item as Record<string, unknown>;
      return viewport.width === required.width && viewport.height === required.height && viewport.overflow === false && Array.isArray(viewport.undersizedTargets) && viewport.undersizedTargets.length === 0;
    }))) continue;
    const loginEvidenceName = "agent-a-" + run + "-resident-login-evidence.json";
    const loginEvidencePath = resolve(evidenceDir, loginEvidenceName);
    if (!existsSync(loginEvidencePath)) continue;
    let loginProof: Record<string, unknown>;
    try { loginProof = JSON.parse(readFileSync(loginEvidencePath, "utf8")) as Record<string, unknown>; } catch { continue; }
    if (loginProof.runId !== run || loginProof.newPinLoginStatus !== 200 || loginProof.oldPinRejectedStatus !== 401 || loginProof.residentApiStatus !== 200 ||
        loginProof.activeResidentSessionCount !== 1 || loginProof.editedNamePersistedInDatabase !== true) continue;
    const profile = loginProof.profile as Record<string, unknown> | undefined;
    if (profile?.residentAreaVisible !== true || profile.houseNumberVisible !== true || profile.editedNameVisible !== true) continue;
    const pinEvidenceName = "agent-a-" + run + "-pin-session-evidence.json";
    const pinPath = resolve(evidenceDir, pinEvidenceName);
    if (!existsSync(pinPath)) continue;
    let pin: Record<string, unknown>;
    try { pin = JSON.parse(readFileSync(pinPath, "utf8")) as Record<string, unknown>; } catch { continue; }
    if (pin.runId !== run || pin.sessionCountBeforeReset === 0 || pin.sessionCountAfterReset !== 0 ||
        pin.capturedOldSessionApiStatusAfterReset !== 401 || pin.resetAuditEventCount !== 1 ||
        pin.resetAuditContextHasCredentialLikeKey !== false || pin.resetAuditContextContainsSensitiveValue !== false ||
        pin.resetAuditContextHasHashLikeValue !== false || pin.resetAuditContextHasTokenLikeValue !== false || pin.doubleSubmitGuard !== true) continue;
    const required = [
      "390x844-chairman-list", "1440x900-chairman-list", "390x844-household-created",
      "1440x900-household-edited", "390x844-pin-reset-success", "390x844-resident-new-pin-login",
    ];
    const screenshotFiles = required.map((shot) => "agent-a-" + run + "-" + shot + ".png");
    if (!screenshotFiles.every((shot) => existsSync(resolve(evidenceDir, shot)))) continue;
    return {
      runId: run,
      coreSmokeEvidence: candidate.name,
      loginEvidence: loginEvidenceName,
      pinSessionEvidence: pinEvidenceName,
      screenshots: screenshotFiles,
      outcome: "PASS: create, edit persistence, PIN reset/session revocation, old PIN rejection, and new PIN resident login",
    };
  }
  throw new Error("No complete sanitized create/edit/PIN session proof was found to bind into the continuation manifest.");
}

async function continueHouseholdLifecycleSmoke(sourceHead: string) {
  await assertPortFree();
  const priorProof = readPriorBrowserProof(sourceHead);
  const fixture = await reuseSyntheticChairmanFixture(false);
  const candidates = await readActiveQaHouseholds(fixture.rtUnitId);
  if (candidates.length < 3) throw new Error("Fewer than three reusable active synthetic QA households are available; no lifecycle mutation was started.");
  const replacementCandidate = candidates[0]!;
  let conflictCandidate: (typeof candidates)[number] | undefined;
  let conflictDue: DueSnapshot | undefined;
  let conflictBeforeOwners: Record<HistoryKind, OwnerRow[]> | undefined;
  for (const candidate of candidates.slice(1)) {
    const dues = await readDueSnapshots(candidate.household_id);
    const decemberDue = dues.find((due) => due.month === 12 && due.status === "unpaid");
    if (!decemberDue) continue;
    const owners = await readFinancialOwnership({ kind: "due", dueId: decemberDue.id });
    if (Object.values(countOwnershipRows(owners)).reduce((sum, count) => sum + count, 0) === 0) {
      conflictCandidate = candidate;
      conflictDue = decemberDue;
      conflictBeforeOwners = owners;
      break;
    }
  }
  if (!conflictCandidate || !conflictDue || !conflictBeforeOwners) throw new Error("No untouched future synthetic QA due was available for the interaction-conflict scenario.");
  const deactivationCandidate = candidates.find((candidate) => candidate.household_id !== replacementCandidate.household_id && candidate.household_id !== conflictCandidate!.household_id);
  if (!deactivationCandidate) throw new Error("No separate synthetic QA household was available for deactivation.");
  const foreignTarget = await readForeignQaHousehold(fixture.rtUnitId);
  const treasurerOverlapBefore = await treasurerOverlapCount(fixture.rtUnitId);
  if (treasurerOverlapBefore !== 0) throw new Error("A Treasurer assignment overlaps the proposed QA date range; no Treasurer fixture mutation was started.");
  if (await readQaTreasurer(fixture.rtUnitId, "2026-11-11")) throw new Error("An active synthetic Treasurer already exists for the simulated business date; no credential was changed.");
  const screenshotNames: string[] = [];
  const formViewportResults: Array<{ state: string; width: number; height: number; overflow: boolean; undersizedTargets: UndersizedTarget[] }> = [];
  const results: Record<string, unknown> = {
    crossRtChairman: foreignTarget ? "PENDING" : "NOT_RUN: no active synthetic household exists in the other QA RT",
    treasurerManagementAndReset: "PENDING: isolated synthetic Treasurer will be created after read-only preflight",
  };
  const resetPin = String(randomInt(100000, 1000000));
  const replacementPin = String(randomInt(100000, 1000000));
  const deactivationPin = String(randomInt(100000, 1000000));
  const replacementName = "F12 QA replacement Resident " + runId.slice(0, 8).toUpperCase();
  const beforeConflictState = await readLifecycleState(conflictCandidate.household_id);
  const beforeReplacementState = await readLifecycleState(replacementCandidate.household_id);
  const beforeDeactivationState = await readLifecycleState(deactivationCandidate.household_id);
  if (!beforeConflictState.personId || !beforeConflictState.accountId || beforeConflictState.accountStatus !== "active" ||
      !beforeReplacementState.personId || !beforeReplacementState.accountId || beforeReplacementState.accountStatus !== "active" ||
      !beforeDeactivationState.personId || !beforeDeactivationState.accountId || beforeDeactivationState.accountStatus !== "active") {
    throw new Error("A reusable synthetic QA lifecycle fixture did not have one active resident account.");
  }
  if (beforeReplacementState.startsOn !== "2026-11-01" || beforeConflictState.startsOn !== "2026-11-01" || beforeDeactivationState.startsOn !== "2026-11-01") {
    throw new Error("A reusable synthetic QA household did not match the November lifecycle scenario.");
  }
  const replacementDuesBefore = await readDueSnapshots(replacementCandidate.household_id);
  const novemberArrearBefore = replacementDuesBefore.find((due) => due.month === 11);
  const decemberFutureBefore = replacementDuesBefore.find((due) => due.month === 12);
  const futureUntouchedDuesBefore = replacementDuesBefore.filter((due) => due.billingYear * 100 + due.month > 202611 && due.status === "unpaid");
  if (!novemberArrearBefore || novemberArrearBefore.status !== "unpaid" || novemberArrearBefore.amount <= 0 ||
      novemberArrearBefore.dueDate >= "2026-11-11" ||
      !decemberFutureBefore || decemberFutureBefore.status !== "unpaid" || decemberFutureBefore.amount <= 0 || decemberFutureBefore.dueDate <= "2026-11-30") {
    throw new Error("The reusable replacement household did not have the required November arrear and untouched December due.");
  }
  if (!futureUntouchedDuesBefore.some((due) => due.id === decemberFutureBefore.id)) throw new Error("December was not part of the complete future untouched due set.");
  for (const due of futureUntouchedDuesBefore) {
    const owners = await readFinancialOwnership({ kind: "due", dueId: due.id });
    if (Object.values(countOwnershipRows(owners)).some((count) => count !== 0)) throw new Error("A future due has financial interactions and cannot be safely classified as untouched.");
  }
  const futureUntouchedDueIds = futureUntouchedDuesBefore.map((due) => due.id);
  const oldHistoryBefore = await readFinancialOwnership({ kind: "household", rtUnitId: fixture.rtUnitId, householdId: replacementCandidate.household_id });
  const screenshotsForViewports: Array<{ width: number; height: number; overflow: boolean; undersizedTargets: UndersizedTarget[] }> = [];
  let profile = "";
  let treasurer: NonNullable<Awaited<ReturnType<typeof readQaTreasurer>>> | null = null;
  let treasurerPassword = "";
  try {
    stage = "start local app with synthetic November 1 business date for existing QA fixtures";
    await startServer("2026-11-01");
    stage = "launch isolated browser for lifecycle continuation";
    profile = await startBrowser();
    stage = "repeat Treasurer interval and assignment preflight immediately before writes";
    const treasurerOverlapAtMutation = await treasurerOverlapCount(fixture.rtUnitId);
    if (treasurerOverlapAtMutation !== 0 || await readQaTreasurer(fixture.rtUnitId, "2026-11-11")) {
      throw new Error("Treasurer assignment preflight changed before fixture setup; no credential or assignment write was started.");
    }
    stage = "rotate only the selected synthetic Chairman credential after all read-only prerequisites pass";
    const chairmanCredentialRows = await getDb().update(authAccount).set({ password: await hashPassword(fixture.password) })
      .where(and(eq(authAccount.userId, fixture.authUserId), eq(authAccount.providerId, "credential")))
      .returning({ id: authAccount.id });
    if (chairmanCredentialRows.length !== 1) throw new Error("Synthetic Chairman credential was not uniquely reusable after preflight.");
    stage = "create isolated synthetic Treasurer after proving no overlapping assignment";
    const createdTreasurer = await createSyntheticTreasurer(fixture.rtUnitId, fixture.personId);
    treasurerPassword = createdTreasurer.password;
    treasurer = await readQaTreasurer(fixture.rtUnitId, "2026-11-11");
    if (!treasurer || treasurer.account_id !== createdTreasurer.accountId || treasurer.auth_user_id !== createdTreasurer.authUserId || treasurer.login_identifier !== createdTreasurer.loginIdentifier) {
      throw new Error("Synthetic Treasurer assignment did not become valid for the simulated business date.");
    }
    stage = "Chairman login and household list for lifecycle continuation";
    await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
    await waitFor("location.pathname.startsWith('/app')", "Synthetic Chairman login did not complete.");
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      stage = "check lifecycle household list viewport " + viewport.width + "x" + viewport.height;
      await navigate("/app/rumah", viewport);
      await waitFor("Boolean(document.querySelector('.chairman-household-empty') || document.querySelector('.chairman-household-list'))", "Household list did not load at a required viewport.");
      const view = await inspectViewportTargets();
      assert.equal(view.overflow, false, "Horizontal overflow at " + viewport.width + "px.");
      assert.equal(view.undersizedTargets.length, 0, "Visible actionable targets under 44px at " + viewport.width + "px.");
      screenshotsForViewports.push({ ...viewport, overflow: view.overflow, undersizedTargets: view.undersizedTargets });
      if (viewport.width === 390) screenshotNames.push(await screenshot("390x844-lifecycle-household-list"));
      if (viewport.width === 1440) screenshotNames.push(await screenshot("1440x900-lifecycle-household-list"));
    }

    stage = "check add and resident edit form geometry at all five viewports without submitting";
    await click("button", "Tambah warga");
    await waitFor("Boolean(document.querySelector('#household-create-name'))", "Add resident form did not open for viewport inspection.");
    formViewportResults.push(...await checkCurrentViewports("add household form"));
    await click("button", "Batal");
    await setInput(".chairman-household-search input", replacementCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(replacementCandidate.house_number) + ")", "Replacement QA household search did not find the selected fixture.");
    await click("button", "Ubah data");
    await waitFor("Boolean(document.querySelector('#household-edit-name'))", "Resident edit form did not open for viewport inspection.");
    formViewportResults.push(...await checkCurrentViewports("resident edit form"));
    await click("button", "Batal");

    stage = "search reused replacement household and open PIN reset form";
    await setInput(".chairman-household-search input", replacementCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(replacementCandidate.house_number) + ")", "Replacement QA household search did not find the selected fixture.");
    const resetAuditBefore = await residentAuditState(beforeReplacementState.accountId);
    await click("button", "Atur PIN");
    await waitFor("Boolean(document.querySelector('#household-reset-pin'))", "PIN reset form did not open for the synthetic replacement resident.");
    formViewportResults.push(...await checkCurrentViewports("PIN reset form"));
    await setInput("#household-reset-pin", resetPin);
    await setInput("#household-reset-reason", "F12 QA synthetic lifecycle session proof");
    await click("button", "Tinjau perubahan PIN");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm')?.innerText.includes('sesi sebelumnya akan dicabut'))", "PIN reset confirmation was not visible.");
    formViewportResults.push(...await checkCurrentViewports("PIN reset confirmation"));
    const resetPostsBefore = mutationCounts.reset;
    const resetConfirmDisabledDuringSubmit = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Ya, atur PIN baru')); if(!button)return false; button.click(); button.click(); return true; })()");
    assert.equal(resetConfirmDisabledDuringSubmit, true, "PIN reset confirmation button was unavailable.");
    await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('PIN baru berhasil ditetapkan'))", "Synthetic resident PIN reset did not succeed.");
    assert.equal(mutationCounts.reset - resetPostsBefore, 1, "Rapid double submit sent multiple PIN reset requests.");
    const resetAuditAfter = await residentAuditState(beforeReplacementState.accountId, [resetPin]);
    assert.equal(resetAuditAfter.resetActionCount - resetAuditBefore.resetActionCount, 1, "PIN reset did not produce exactly one audit entry.");
    assert.equal(resetAuditAfter.resetContextHasPinLikeKey, false, "PIN reset audit uses a prohibited credential field key.");
    assert.equal(resetAuditAfter.resetContextContainsSubmittedSecret, false, "PIN reset audit contains the submitted PIN value.");
    assert.equal(resetAuditAfter.resetContextHasHashLikeValue, false, "PIN reset audit contains a hash-like value.");
    assert.equal(resetAuditAfter.resetContextHasTokenLikeValue, false, "PIN reset audit contains a token-like value.");
    const pinResetAuditEvidence = {
      auditDelta: resetAuditAfter.resetActionCount - resetAuditBefore.resetActionCount,
      hasCredentialLikeKey: resetAuditAfter.resetContextHasPinLikeKey,
      containsSubmittedPin: resetAuditAfter.resetContextContainsSubmittedSecret,
      hasHashLikeValue: resetAuditAfter.resetContextHasHashLikeValue,
      hasTokenLikeValue: resetAuditAfter.resetContextHasTokenLikeValue,
      rapidDoubleSubmitPrevented: mutationCounts.reset - resetPostsBefore === 1,
    };
    screenshotNames.push(await screenshot("390x844-lifecycle-pin-reset-success"));

    stage = "resident login and old session capture before replacement";
    await loginThroughBrowser("warga", replacementCandidate.house_number, resetPin);
    await waitFor("location.pathname.startsWith('/app') && Boolean(document.querySelector('.resident-area')) && (document.body.innerText||'').includes(" + JSON.stringify(replacementCandidate.house_number) + ")", "Synthetic replacement resident could not authenticate with its reset PIN.");
    const oldResidentCookie = await currentResidentSessionCookie();
    const oldSessionCountBeforeReplacement = await activeResidentSessionCount(beforeReplacementState.authUserId!);
    const oldResidentApiStatusBeforeReplacement = await savedCookieGet("/api/resident/monthly-dues", oldResidentCookie);
    assert.ok(oldSessionCountBeforeReplacement >= 1, "Resident login did not create a session before replacement.");
    assert.equal(oldResidentApiStatusBeforeReplacement, 200, "Pre-replacement resident session could not read the resident API.");
    screenshotNames.push(await screenshot("390x844-lifecycle-resident-before-replacement"));

    stage = "restart local app using November 11 business date for overdue and next-month lifecycle boundary";
    await stopServer();
    await startServer("2026-11-11");
    const priorSessionSurvivesClockRestart = await savedCookieGet("/api/resident/monthly-dues", oldResidentCookie);
    assert.equal(priorSessionSurvivesClockRestart, 200, "Resident session did not survive the business-date-only server restart.");
    stage = "Chairman login at simulated November 11 boundary";
    await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
    await waitFor("location.pathname.startsWith('/app')", "Chairman login did not complete at the November 11 boundary.");
    await navigate("/app/rumah", { width: 390, height: 844 });

    let crossRtEvidence: Record<string, unknown>;
    if (foreignTarget) {
      stage = "Chairman cross-RT household edit is denied generically";
      const crossRtResponse = await evaluate<{ status: number; genericError: boolean; internalLeak: boolean }>("(async()=>{const r=await fetch(" + JSON.stringify("/api/chairman/households/" + foreignTarget.household_id + "?personId=" + foreignTarget.person_id) + ",{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({fullName:'F12 QA unauthorized cross RT probe',phone:'',houseLabel:''})});const t=await r.text();return {status:r.status,genericError:/tidak ditemukan|tidak dapat|tidak diizinkan|tidak memiliki/i.test(t),internalLeak:/SQLSTATE|stack trace|DATABASE_URL|postgres|relation .* does not exist/i.test(t)}})()");
      const foreignAfter = await getDb().select({ fullName: people.fullName }).from(people).where(eq(people.id, foreignTarget.person_id)).limit(1);
      assert.ok([403, 404].includes(crossRtResponse.status), "Cross-RT edit was not denied with a generic 403/404.");
      assert.equal(crossRtResponse.genericError, true, "Cross-RT error body was not a generic denial/not-found response.");
      assert.equal(crossRtResponse.internalLeak, false, "Cross-RT error exposed SQL or internal details.");
      assert.equal(foreignAfter[0]?.fullName, foreignTarget.full_name, "Cross-RT denial changed the foreign resident.");
      crossRtEvidence = { status: crossRtResponse.status, genericError: crossRtResponse.genericError, noMutation: foreignAfter[0]?.fullName === foreignTarget.full_name, internalLeak: crossRtResponse.internalLeak };
      results.crossRtChairman = "PASS";
    } else crossRtEvidence = { status: "NOT_RUN", reason: "No active synthetic foreign-RT household was found." };

    let treasurerEvidence: Record<string, unknown>;
    if (treasurer) {
      stage = "verify synthetic Treasurer household and PIN reset authorization denials";
      const resetEventsBefore = await residentAuditState(beforeReplacementState.accountId);
      const residentSessionsBefore = await activeResidentSessionCount(beforeReplacementState.authUserId!);
      await loginThroughBrowser("pengurus", treasurer.login_identifier, treasurerPassword);
      await waitFor("location.pathname.startsWith('/app')", "Synthetic Treasurer login did not complete.");
      const treasurerAccess = await evaluate<{ householdStatus: number; householdGeneric: boolean; resetStatus: number; resetGeneric: boolean; responseLeak: boolean }>("(async()=>{const list=await fetch('/api/chairman/households',{cache:'no-store'});const reset=await fetch(" + JSON.stringify("/api/residents/" + beforeReplacementState.accountId + "/reset-pin") + ",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});const listBody=await list.text(),resetBody=await reset.text(),generic=/pengelolaan rumah|tidak memiliki|tidak berwenang|tidak diizinkan|akses|forbidden|unauthorized|silakan masuk/i;return {householdStatus:list.status,householdGeneric:generic.test(listBody),resetStatus:reset.status,resetGeneric:generic.test(resetBody),responseLeak:/SQLSTATE|stack trace|DATABASE_URL|postgres|relation .* does not exist/i.test(listBody+' '+resetBody)}})()");
      const resetEventsAfter = await residentAuditState(beforeReplacementState.accountId);
      const residentSessionsAfter = await activeResidentSessionCount(beforeReplacementState.authUserId!);
      assert.ok([401, 403].includes(treasurerAccess.householdStatus) && [401, 403].includes(treasurerAccess.resetStatus), "Treasurer access to household management or resident PIN reset was not denied.");
      assert.equal(treasurerAccess.householdGeneric, true, "Treasurer household denial was not generic.");
      assert.equal(treasurerAccess.resetGeneric, true, "Treasurer PIN reset denial was not generic.");
      assert.equal(treasurerAccess.responseLeak, false, "Treasurer authorization error exposed internal details.");
      assert.equal(resetEventsAfter.resetActionCount, resetEventsBefore.resetActionCount, "Denied Treasurer PIN reset wrote an audit event.");
      assert.equal(residentSessionsAfter, residentSessionsBefore, "Denied Treasurer requests changed resident sessions.");
      treasurerEvidence = { householdListStatus: treasurerAccess.householdStatus, householdGeneric: treasurerAccess.householdGeneric, resetStatus: treasurerAccess.resetStatus, resetGeneric: treasurerAccess.resetGeneric, noAuditMutation: resetEventsAfter.resetActionCount === resetEventsBefore.resetActionCount, noSessionMutation: residentSessionsAfter === residentSessionsBefore, internalLeak: treasurerAccess.responseLeak };
      results.treasurerManagementAndReset = "PASS";
      stage = "Chairman re-login after Treasurer denial proof";
      await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
      await waitFor("location.pathname.startsWith('/app')", "Chairman login did not complete after Treasurer denial proof.");
      await navigate("/app/rumah", { width: 390, height: 844 });
    } else treasurerEvidence = { status: "NOT_RUN", reason: "Synthetic Treasurer was not created after preflight." };

    stage = "create one adjustment interaction on the post-end December due";
    const dueOwnersBeforeAdjustment = await readFinancialOwnership({ kind: "due", dueId: conflictDue.id });
    assert.deepEqual(countOwnershipRows(dueOwnersBeforeAdjustment), countOwnershipRows(conflictBeforeOwners), "Conflict due history changed before the authorized synthetic adjustment.");
    const adjustmentKey = randomUUID();
    const adjustmentResponse = await evaluate<{ status: number; internalLeak: boolean }>("(async()=>{const r=await fetch('/api/chairman/adjustments',{method:'POST',headers:{'content-type':'application/json','idempotency-key':" + JSON.stringify(adjustmentKey) + "},body:JSON.stringify({monthlyDueId:" + JSON.stringify(conflictDue.id) + ",amountDelta:1,reason:'F12 QA synthetic lifecycle conflict interaction'})});const t=await r.text();return {status:r.status,internalLeak:/SQLSTATE|stack trace|DATABASE_URL|postgres|relation .* does not exist/i.test(t)}})()");
    assert.ok([200, 201].includes(adjustmentResponse.status), "Synthetic December due adjustment was not accepted.");
    assert.equal(adjustmentResponse.internalLeak, false, "Adjustment response exposed internal details.");
    const conflictOwnersBeforeLifecycle = await readFinancialOwnership({ kind: "due", dueId: conflictDue.id });
    const conflictCountsBeforeLifecycle = countOwnershipRows(conflictOwnersBeforeLifecycle);
    assert.equal(conflictCountsBeforeLifecycle.dueAdjustments, 1, "Conflict due did not retain exactly one adjustment interaction.");
    const conflictDueAfterAdjustment = (await readDueSnapshots(conflictCandidate.household_id)).find((due) => due.id === conflictDue.id);
    if (!conflictDueAfterAdjustment) throw new Error("Interacted December due disappeared after adjustment.");
    const conflictActiveSessionCountBefore = await activeResidentSessionCount(beforeConflictState.authUserId!);
    const conflictLifecycleAuditCountBefore = await householdLifecycleAuditCount(conflictCandidate.household_id);
    const conflictFinancialContentBefore = await readFinancialContentRows(conflictDue.id);
    const conflictFinancialContentProof = {
      fingerprint: financialContentFingerprint(conflictFinancialContentBefore),
      rowCount: financialContentRowCount(conflictFinancialContentBefore),
    };
    if (conflictFinancialContentProof.rowCount < 1) throw new Error("Interacted conflict due has no sanitized financial content rows to fingerprint.");
    const conflictBeforeManifest = {
      householdStatus: beforeConflictState.status,
      householdEndsOn: beforeConflictState.endsOn,
      personIsActive: beforeConflictState.personIsActive,
      residentAccountStatus: beforeConflictState.accountStatus,
      due: {
        billingYear: conflictDueAfterAdjustment.billingYear, month: conflictDueAfterAdjustment.month,
        amount: conflictDueAfterAdjustment.amount, dueDate: conflictDueAfterAdjustment.dueDate,
        status: conflictDueAfterAdjustment.status, feeRateId: conflictDueAfterAdjustment.feeRateId,
        waivedReason: conflictDueAfterAdjustment.waivedReason,
      },
      interactionCounts: conflictCountsBeforeLifecycle,
      ownershipRows: conflictOwnersBeforeLifecycle,
      activeSessionCount: conflictActiveSessionCountBefore,
      lifecycleAuditCount: conflictLifecycleAuditCountBefore,
      financialContent: conflictFinancialContentProof,
    };
    stage = "browser replacement safely rejects the post-end interacted due";
    await setInput(".chairman-household-search input", conflictCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(conflictCandidate.house_number) + ")", "Conflict QA household search did not find the selected fixture.");
    await click("button", "Ganti warga");
    await waitFor("Boolean(document.querySelector('#household-replace-month'))", "Conflict replacement form did not open.");
    formViewportResults.push(...await checkCurrentViewports("conflict replacement form"));
    await setInput("#household-replace-month", "2026-12");
    await setInput("#household-replace-name", "F12 QA conflict should remain unchanged");
    await setInput("#household-replace-pin", String(randomInt(100000, 1000000)));
    await setInput("#household-replace-reason", "F12 QA interaction conflict protection");
    await click("button", "Tinjau pergantian");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm')?.innerText.includes('warga baru mulai'))", "Conflict replacement review confirmation did not appear.");
    formViewportResults.push(...await checkCurrentViewports("conflict replacement confirmation"));
    screenshotNames.push(await screenshot("390x844-interacted-due-replacement-review"));
    const replaceRequestCountBeforeConflict = mutationCounts.replace;
    const conflictConfirmClicked = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Ya, ganti warga')); if(!button)return false; button.click(); button.click(); return true; })()");
    assert.equal(conflictConfirmClicked, true, "Conflict confirmation button was unavailable.");
    await waitFor("Boolean(document.querySelector('[role=alert]'))", "Conflict replacement did not show a safe rejection state.");
    await delay(200);
    assert.equal(mutationCounts.replace - replaceRequestCountBeforeConflict, 1, "Conflict replacement double submit sent multiple requests.");
    const conflictPath = "/api/chairman/households/" + conflictCandidate.household_id + "/replace";
    const conflictStatus = apiStatuses[conflictPath]?.at(-1) ?? null;
    assert.equal(conflictStatus, 409, "Interacted-due lifecycle operation did not return HTTP 409.");
    const conflictErrorFacts = await evaluate<{ errorVisible: boolean; internalErrorVisible: boolean; credentialVisible: boolean }>("(() => {const text=document.body.innerText||'';return {errorVisible:Boolean(document.querySelector('[role=alert]')),internalErrorVisible:/SQLSTATE|stack trace|DATABASE_URL|postgres|relation .* does not exist/i.test(text),credentialVisible:/\b\d{6}\b/.test(text)}})()");
    assert.equal(conflictErrorFacts.internalErrorVisible, false, "Conflict rejection showed a raw internal error.");
    assert.equal(conflictErrorFacts.credentialVisible, false, "Conflict rejection exposed a credential-like value.");
    screenshotNames.push(await screenshot("390x844-interacted-due-conflict-error"));
    await setViewport({ width: 1440, height: 900 });
    screenshotNames.push(await screenshot("1440x900-interacted-due-conflict-error"));
    await setViewport({ width: 390, height: 844 });
    const conflictStateAfter = await readLifecycleState(conflictCandidate.household_id);
    const conflictDueAfter = (await readDueSnapshots(conflictCandidate.household_id)).find((due) => due.id === conflictDue.id);
    const conflictOwnersAfter = await readFinancialOwnership({ kind: "due", dueId: conflictDue.id });
    const conflictActiveSessionCountAfter = await activeResidentSessionCount(beforeConflictState.authUserId!);
    const conflictLifecycleAuditCountAfter = await householdLifecycleAuditCount(conflictCandidate.household_id);
    const conflictFinancialContentAfter = await readFinancialContentRows(conflictDue.id);
    const conflictFinancialContentAfterProof = {
      fingerprint: financialContentFingerprint(conflictFinancialContentAfter),
      rowCount: financialContentRowCount(conflictFinancialContentAfter),
    };
    assert.deepEqual({ status: conflictStateAfter.status, endsOn: conflictStateAfter.endsOn, personIsActive: conflictStateAfter.personIsActive, accountStatus: conflictStateAfter.accountStatus, due: conflictDueAfter }, {
      status: beforeConflictState.status, endsOn: beforeConflictState.endsOn, personIsActive: beforeConflictState.personIsActive, accountStatus: beforeConflictState.accountStatus, due: conflictDueAfterAdjustment,
    }, "Rejected lifecycle operation partially changed the conflict household or due snapshot.");
    assert.deepEqual(conflictOwnersAfter, conflictOwnersBeforeLifecycle, "Rejected lifecycle operation changed financial history ownership.");
    assert.deepEqual(countOwnershipRows(conflictOwnersAfter), conflictCountsBeforeLifecycle, "Rejected lifecycle operation changed financial interaction counts.");
    assert.equal(conflictActiveSessionCountAfter, conflictActiveSessionCountBefore, "Rejected lifecycle operation changed unexpired resident session count.");
    assert.equal(conflictLifecycleAuditCountAfter, conflictLifecycleAuditCountBefore, "Rejected lifecycle operation wrote a lifecycle audit event.");
    assert.deepEqual(conflictFinancialContentAfterProof, conflictFinancialContentProof, "Rejected lifecycle operation changed financial interaction content.");
    results.interactedDueConflict = "PASS";

    stage = "review and confirm same-house replacement at the December 1 boundary";
    await setInput(".chairman-household-search input", replacementCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(replacementCandidate.house_number) + ")", "Replacement QA household was not found at the November 11 boundary.");
    await click("button", "Ganti warga");
    await waitFor("Boolean(document.querySelector('#household-replace-month'))", "Same-house replacement form did not open.");
    formViewportResults.push(...await checkCurrentViewports("same-house replacement form"));
    await setInput("#household-replace-month", "2026-12");
    await setInput("#household-replace-name", replacementName);
    await setInput("#household-replace-phone", "");
    await setInput("#household-replace-pin", replacementPin);
    await setInput("#household-replace-reason", "F12 QA same-house boundary replacement");
    await click("button", "Tinjau pergantian");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm')?.innerText.includes('tunggakan dan pembayaran lama tidak dipindahkan'))", "Same-house replacement confirmation did not explain debt preservation.");
    formViewportResults.push(...await checkCurrentViewports("same-house replacement confirmation"));
    const replacementReviewFacts = await evaluate<{ confirmationVisible: boolean; monthVisible: boolean; doubleClickButtonVisible: boolean; internalErrorVisible: boolean }>("(() => {const text=document.querySelector('.chairman-household-confirm')?.innerText||'';const page=document.body.innerText||'';return {confirmationVisible:Boolean(document.querySelector('.chairman-household-confirm')),monthVisible:/Desember 2026|December 2026/i.test(text),doubleClickButtonVisible:[...document.querySelectorAll('button')].some(e=>e.textContent?.includes('Ya, ganti warga')),internalErrorVisible:/SQLSTATE|stack trace|DATABASE_URL|postgres/i.test(page)}})()");
    assert.equal(replacementReviewFacts.confirmationVisible, true, "Replacement review confirmation is not visible.");
    assert.equal(replacementReviewFacts.doubleClickButtonVisible, true, "Replacement confirmation action is missing.");
    assert.equal(replacementReviewFacts.internalErrorVisible, false, "Replacement review displayed an internal error.");
    screenshotNames.push(await screenshot("390x844-same-house-replacement-review"));
    const replacementPostsBefore = mutationCounts.replace;
    const replacementConfirmed = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Ya, ganti warga')); if(!button)return false; button.click(); button.click(); return true; })()");
    assert.equal(replacementConfirmed, true, "Replacement confirmation button was unavailable.");
    await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('Pergantian warga berhasil dicatat'))", "Same-house replacement did not return its browser success state.");
    await delay(250);
    assert.equal(mutationCounts.replace - replacementPostsBefore, 1, "Rapid double submit sent multiple replacement requests.");
    const replacementPath = "/api/chairman/households/" + replacementCandidate.household_id + "/replace";
    const replacementStatus = apiStatuses[replacementPath]?.at(-1) ?? null;
    assert.equal(replacementStatus, 200, "Same-house replacement endpoint did not return HTTP 200.");
    assert.equal(lifecyclePayloadMonths.filter((item) => item.path === replacementPath).at(-1)?.month, "2026-12", "Replacement did not send the required December 2026 effective month.");
    const newHouseholdResult = await getDb().execute(sql.raw(`SELECT id::text AS id FROM public.households WHERE rt_unit_id='${fixture.rtUnitId}'::uuid AND house_id='${replacementCandidate.house_id}'::uuid AND starts_on='2026-12-01'::date AND status='active' ORDER BY created_at DESC LIMIT 1`));
    const newHouseholdId = (newHouseholdResult as unknown as Rows<{ id: string }>).rows?.[0]?.id;
    if (!newHouseholdId) throw new Error("Replacement did not create an active December household for the same house.");
    const oldReplacementAfter = await readLifecycleState(replacementCandidate.household_id);
    const newReplacementAfter = await readLifecycleState(newHouseholdId);
    const oldDueRowsAfter = await readDueSnapshots(replacementCandidate.household_id);
    const newDueRowsAfter = await readDueSnapshots(newHouseholdId);
    const futureDueIdSet = new Set(futureUntouchedDueIds);
    const expectedOldDueRowsAfter = replacementDuesBefore.map((due) => futureDueIdSet.has(due.id)
      ? { ...due, amount: 0, status: "not_due", feeRateId: null, waivedReason: null }
      : due);
    assert.deepEqual(oldDueRowsAfter, expectedOldDueRowsAfter, "Complete old-household due set did not match preserved and future NOT_DUE partition.");
    const preservedNovemberDue = oldDueRowsAfter.find((due) => due.id === novemberArrearBefore.id);
    const transitionedDecemberDue = oldDueRowsAfter.find((due) => due.id === decemberFutureBefore.id);
    assert.equal(oldReplacementAfter.status, "inactive", "Old replacement household remained active.");
    assert.equal(oldReplacementAfter.endsOn, "2026-11-30", "Old replacement household did not end at November 30.");
    assert.equal(oldReplacementAfter.personIsActive, false, "Old resident remained active after replacement.");
    assert.equal(oldReplacementAfter.accountStatus, "disabled", "Old resident account remained enabled after replacement.");
    assert.deepEqual(preservedNovemberDue, novemberArrearBefore, "The overdue November debt snapshot changed during replacement.");
    assert.equal(transitionedDecemberDue?.status, "not_due", "Untouched future December due did not become NOT_DUE.");
    assert.equal(transitionedDecemberDue?.amount, 0, "Transitioned December due retained an amount.");
    assert.equal(transitionedDecemberDue?.feeRateId, null, "Transitioned December due retained a fee rate.");
    assert.equal(newReplacementAfter.status, "active", "New replacement household is not active.");
    assert.equal(newReplacementAfter.startsOn, "2026-12-01", "New replacement household did not begin December 1.");
    assert.equal(newReplacementAfter.houseId, replacementCandidate.house_id, "Replacement household is not linked to the same physical house.");
    assert.equal(newReplacementAfter.personIsActive, true, "New replacement person is not active.");
    assert.equal(newReplacementAfter.accountStatus, "active", "New replacement account is not active.");
    assert.equal(newReplacementAfter.loginIdentifier?.toLowerCase(), replacementCandidate.house_number.toLowerCase(), "Same-house resident login identifier did not use the house number.");
    const newPreStartDueRows = newDueRowsAfter.filter((due) => due.dueDate < newReplacementAfter.startsOn);
    assert.ok(newPreStartDueRows.length > 0, "New household did not contain expected pre-start dues for the audit snapshot.");
    assert.equal(newPreStartDueRows.some((due) => due.status !== "not_due" || due.amount !== 0 || due.feeRateId !== null || due.waivedReason !== null), false, "New household contains a billable or nonzero pre-start due.");
    const replacementSessionCountAfter = await activeResidentSessionCount(beforeReplacementState.authUserId!);
    const oldSessionApiAfterReplacement = await savedCookieGet("/api/resident/monthly-dues", oldResidentCookie);
    assert.equal(replacementSessionCountAfter, 0, "Old resident still has an active session after replacement.");
    assert.equal(oldSessionApiAfterReplacement, 401, "Captured old resident session remained valid after replacement.");
    const replacementOldHistoryAfter = await readFinancialOwnership({ kind: "household", rtUnitId: fixture.rtUnitId, householdId: replacementCandidate.household_id });
    assert.deepEqual(replacementOldHistoryAfter, oldHistoryBefore, "Replacement moved or changed financial history ownership.");
    const replacementNewHistory = await readFinancialOwnership({ kind: "household", rtUnitId: fixture.rtUnitId, householdId: newHouseholdId });
    assert.equal(Object.values(countOwnershipRows(replacementNewHistory)).reduce((sum, count) => sum + count, 0), 0, "New replacement household inherited financial rows.");
    const oldResidentLoginAfterReplacement = await evaluate<{ status: number; genericError: boolean }>("(async()=>{const r=await fetch('/api/login/resident',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:" + JSON.stringify(replacementCandidate.house_number) + ",password:" + JSON.stringify(resetPin) + "})});const t=await r.text();return {status:r.status,genericError:/belum cocok|periksa kembali|tidak ditemukan/i.test(t)}})()");
    assert.equal(oldResidentLoginAfterReplacement.status, 401, "Old resident authentication was not rejected after replacement.");
    results.sameHouseReplacementAtBoundary = "PASS";
    await setViewport({ width: 1440, height: 900 });
    screenshotNames.push(await screenshot("1440x900-same-house-replacement-success"));
    await setViewport({ width: 390, height: 844 });
    screenshotNames.push(await screenshot("390x844-same-house-replacement-success"));

    stage = "restart local app at December 1 and prove the new same-house resident can log in";
    await stopServer();
    await startServer("2026-12-01");
    await loginThroughBrowser("warga", replacementCandidate.house_number, replacementPin);
    await waitFor("location.pathname.startsWith('/app') && Boolean(document.querySelector('.resident-area')) && (document.body.innerText||'').includes(" + JSON.stringify(replacementCandidate.house_number) + ") && (document.body.innerText||'').includes(" + JSON.stringify(replacementName) + ")", "New replacement resident did not authenticate with the same house-number login at the start-date boundary.");
    const newResidentApiStatus = await evaluate<number>("(async()=>{const r=await fetch('/api/resident/monthly-dues',{cache:'no-store'});return r.status;})()");
    assert.equal(newResidentApiStatus, 200, "New same-house resident session could not read monthly dues.");
    const newResidentSessionCount = await activeResidentSessionCount(newReplacementAfter.authUserId!);
    assert.equal(newResidentSessionCount, 1, "New resident login did not create exactly one active session.");
    const currentLoginCountResult = await getDb().execute(sql.raw(`SELECT count(*)::int AS count FROM public.app_accounts WHERE rt_unit_id='${fixture.rtUnitId}'::uuid AND account_type='resident' AND status <> 'disabled' AND lower(login_identifier)=lower('${replacementCandidate.house_number.replaceAll("'", "''")}')`));
    const currentLoginCount = Number((currentLoginCountResult as unknown as Rows<{ count: number }>).rows?.[0]?.count ?? 0);
    assert.equal(currentLoginCount, 1, "Same house number does not resolve to exactly one current resident login in this RT.");
    const replacementNewHistoryAfterLogin = await readFinancialOwnership({ kind: "household", rtUnitId: fixture.rtUnitId, householdId: newHouseholdId });
    assert.equal(Object.values(countOwnershipRows(replacementNewHistoryAfterLogin)).reduce((sum, count) => sum + count, 0), 0, "New household inherited old financial history after authentication.");
    screenshotNames.push(await screenshot("390x844-same-house-new-resident-login"));

    stage = "capture a separate current session and deactivate an isolated synthetic household";
    await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
    await waitFor("location.pathname.startsWith('/app')", "Chairman login did not complete before the separate deactivation flow.");
    await navigate("/app/rumah", { width: 390, height: 844 });
    await setInput(".chairman-household-search input", deactivationCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(deactivationCandidate.house_number) + ")", "Deactivation QA household search did not find the separate fixture.");
    await click("button", "Atur PIN");
    await waitFor("Boolean(document.querySelector('#household-reset-pin'))", "Separate deactivation resident PIN form did not open.");
    formViewportResults.push(...await checkCurrentViewports("deactivation resident PIN reset form"));
    const deactivationResetAuditBefore = await residentAuditState(beforeDeactivationState.accountId);
    await setInput("#household-reset-pin", deactivationPin);
    await setInput("#household-reset-reason", "F12 QA synthetic deactivation session proof");
    await click("button", "Tinjau perubahan PIN");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm'))", "Separate deactivation resident PIN confirmation did not appear.");
    formViewportResults.push(...await checkCurrentViewports("deactivation resident PIN confirmation"));
    const deactivationResetPostsBefore = mutationCounts.reset;
    const deactivationResetClick = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Ya, atur PIN baru')); if(!button)return false; button.click(); button.click(); return true; })()");
    assert.equal(deactivationResetClick, true, "Separate deactivation resident PIN confirmation button was unavailable.");
    await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('PIN baru berhasil ditetapkan'))", "Separate deactivation resident PIN reset did not succeed.");
    assert.equal(mutationCounts.reset - deactivationResetPostsBefore, 1, "Separate resident PIN reset was submitted more than once.");
    const deactivationResetAuditAfter = await residentAuditState(beforeDeactivationState.accountId, [deactivationPin]);
    assert.equal(deactivationResetAuditAfter.resetActionCount - deactivationResetAuditBefore.resetActionCount, 1, "Separate resident PIN reset did not write exactly one audit entry.");
    assert.equal(deactivationResetAuditAfter.resetContextHasPinLikeKey || deactivationResetAuditAfter.resetContextContainsSubmittedSecret || deactivationResetAuditAfter.resetContextHasHashLikeValue || deactivationResetAuditAfter.resetContextHasTokenLikeValue, false, "Separate PIN reset audit context contains credential material.");
    await loginThroughBrowser("warga", deactivationCandidate.house_number, deactivationPin);
    await waitFor("location.pathname.startsWith('/app') && Boolean(document.querySelector('.resident-area'))", "Separate synthetic resident could not authenticate before deactivation.");
    const deactivationOldCookie = await currentResidentSessionCookie();
    const deactivationSessionCountBefore = await activeResidentSessionCount(beforeDeactivationState.authUserId!);
    const deactivationResidentApiBefore = await savedCookieGet("/api/resident/monthly-dues", deactivationOldCookie);
    assert.ok(deactivationSessionCountBefore >= 1, "Separate resident login did not create an active session before deactivation.");
    assert.equal(deactivationResidentApiBefore, 200, "Separate resident session could not read the resident API before deactivation.");
    screenshotNames.push(await screenshot("390x844-deactivation-resident-before"));

    await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
    await waitFor("location.pathname.startsWith('/app')", "Chairman login did not complete before household deactivation.");
    await navigate("/app/rumah", { width: 390, height: 844 });
    await setInput(".chairman-household-search input", deactivationCandidate.house_number);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(deactivationCandidate.house_number) + ")", "Deactivation QA household was not found for lifecycle action.");
    await click("button", "Tutup masa tinggal");
    await waitFor("Boolean(document.querySelector('#household-deactivate-month'))", "Household deactivation form did not open.");
    formViewportResults.push(...await checkCurrentViewports("household deactivation form"));
    await setInput("#household-deactivate-month", "2026-12");
    await setInput("#household-deactivate-reason", "F12 QA synthetic separate household deactivation");
    await click("button", "Tinjau penutupan");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm'))", "Household deactivation confirmation did not appear.");
    formViewportResults.push(...await checkCurrentViewports("household deactivation confirmation"));
    screenshotNames.push(await screenshot("390x844-household-deactivation-review"));
    const deactivatePostsBefore = mutationCounts.deactivate;
    const deactivateConfirmed = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Ya, tutup masa tinggal')); if(!button)return false; button.click(); button.click(); return true; })()");
    assert.equal(deactivateConfirmed, true, "Household deactivation confirmation button was unavailable.");
    await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('Masa rumah warga berhasil ditutup'))", "Household deactivation did not return a success state.");
    await delay(200);
    assert.equal(mutationCounts.deactivate - deactivatePostsBefore, 1, "Rapid double submit sent multiple deactivation requests.");
    const deactivationPath = "/api/chairman/households/" + deactivationCandidate.household_id + "/deactivate";
    const deactivationStatus = apiStatuses[deactivationPath]?.at(-1) ?? null;
    assert.equal(deactivationStatus, 200, "Household deactivation endpoint did not return HTTP 200.");
    assert.equal(lifecyclePayloadMonths.filter((item) => item.path === deactivationPath).at(-1)?.month, "2026-12", "Household deactivation did not send December 2026 as the final active month.");
    const deactivatedState = await readLifecycleState(deactivationCandidate.household_id);
    assert.equal(deactivatedState.status, "inactive", "Deactivated synthetic household remains active.");
    assert.equal(deactivatedState.endsOn, "2026-12-31", "Deactivated synthetic household did not end on December 31.");
    assert.equal(deactivatedState.personIsActive, false, "Deactivated synthetic resident person remains active.");
    assert.equal(deactivatedState.accountStatus, "disabled", "Deactivated synthetic resident account remains enabled.");
    const deactivationSessionCountAfter = await activeResidentSessionCount(beforeDeactivationState.authUserId!);
    const deactivationOldSessionStatus = await savedCookieGet("/api/resident/monthly-dues", deactivationOldCookie);
    assert.equal(deactivationSessionCountAfter, 0, "Deactivation left an active resident session.");
    assert.equal(deactivationOldSessionStatus, 401, "Captured resident session remained valid after deactivation.");
    results.deactivation = "PASS";
    await setViewport({ width: 390, height: 844 });
    screenshotNames.push(await screenshot("390x844-household-deactivation-success"));
    await setViewport({ width: 1440, height: 900 });
    screenshotNames.push(await screenshot("1440x900-household-deactivation-success"));

    const qaSeedAttempts = await readQaSeedAttempts(fixture.rtUnitId);
    if (qaSeedAttempts.length !== 2 || qaSeedAttempts.filter((item) => item.state === "reused").length !== 1 || qaSeedAttempts.filter((item) => item.state === "leftover_partial").length !== 1) {
      throw new Error("Sanitized QA seed attempt inventory did not contain the expected two synthetic RT attempts.");
    }
    const postSmokeAudit = {
      qaSeedAttempts,
      replacement: {
        oldHouseholdId: replacementCandidate.household_id,
        newHouseholdId,
        oldPersonId: beforeReplacementState.personId!,
        oldResidentAccountId: beforeReplacementState.accountId!,
        newResidentAccountId: newReplacementAfter.accountId!,
        oldEndsOn: oldReplacementAfter.endsOn!,
        newStartsOn: newReplacementAfter.startsOn,
        oldHouseholdDueRowsBefore: replacementDuesBefore,
        oldHouseholdDueRowsAfter: oldDueRowsAfter,
        newHouseholdDueRowsAfter: newDueRowsAfter,
        preservedDueRows: replacementDuesBefore.filter((due) => !futureDueIdSet.has(due.id)),
        futureUntouchedDueIds,
        oldHistoryCounts: countOwnershipRows(replacementOldHistoryAfter),
        oldHistoryOwnerRows: replacementOldHistoryAfter,
      },
      conflict: {
        householdId: conflictCandidate.household_id,
        personId: beforeConflictState.personId!,
        residentAccountId: beforeConflictState.accountId!,
        dueId: conflictDue.id,
        before: {
          householdStatus: conflictBeforeManifest.householdStatus,
          householdEndsOn: conflictBeforeManifest.householdEndsOn,
          personIsActive: conflictBeforeManifest.personIsActive,
          residentAccountStatus: conflictBeforeManifest.residentAccountStatus,
          due: {
            billingYear: conflictBeforeManifest.due.billingYear,
            month: conflictBeforeManifest.due.month,
            amount: conflictBeforeManifest.due.amount,
            dueDate: conflictBeforeManifest.due.dueDate,
            status: conflictBeforeManifest.due.status,
            feeRateId: conflictBeforeManifest.due.feeRateId,
            waivedReason: conflictBeforeManifest.due.waivedReason,
          },
          interactionCounts: conflictBeforeManifest.interactionCounts,
          ownershipRows: conflictBeforeManifest.ownershipRows,
          activeSessionCount: conflictBeforeManifest.activeSessionCount,
          lifecycleAuditCount: conflictBeforeManifest.lifecycleAuditCount,
          financialContent: conflictBeforeManifest.financialContent,
        },
      },
    };
    const priorRunScreenshots = priorProof.screenshots.map((name) => "docs/phase-12-1-acceptance-evidence/" + name);
    const manifestPath = writeEvidence("agent-a-" + runId + "-fixture-manifest.json", {
      runId,
      outcome: "PASS",
      source: { branch: "fix/phase-12-1-acceptance-closure", baseline: baselineSha, head: sourceHead, provenanceSha256: sourceProvenance() },
      target: { projectId: target.projectId, branchId: target.branchId, endpointId: target.endpointId, database: target.database },
      simulatedBusinessDates: ["2026-11-01", "2026-11-11", "2026-12-01"],
      migrationHead: expectedMigration,
      priorBrowserProof: priorProof,
      scenarios: {
        chairmanLoginListSearch: "PASS",
        addResident: "PASS; bound to prior proof " + priorProof.runId,
        editResidentAndDatabasePersistence: "PASS; bound to prior proof " + priorProof.runId,
        pinResetAndOldSessionRevocation: "PASS; bound to prior proof " + priorProof.runId,
        oldPinRejectedAndNewPinResidentLogin: "PASS; bound to prior proof " + priorProof.runId,
        sameHouseReplacementAndDebtPreservation: results.sameHouseReplacementAtBoundary,
        interactedDueConflictNoPartialMutation: results.interactedDueConflict,
        deactivationAndSessionRevocation: results.deactivation,
        crossRtChairman: results.crossRtChairman,
        treasurerManagementAndPinReset: results.treasurerManagementAndReset,
      },
      viewportChecks: { list: screenshotsForViewports, activeFormsAndConfirmations: formViewportResults },
      replacementEvidence: {
        sameHouse: newReplacementAfter.houseId === replacementCandidate.house_id,
        oldHouseholdStatus: oldReplacementAfter.status,
        newHouseholdStatus: newReplacementAfter.status,
        oldResidentDisabled: oldReplacementAfter.accountStatus === "disabled",
        oldSessionCountAfterReplacement: replacementSessionCountAfter,
        capturedOldSessionApiStatusAfterReplacement: oldSessionApiAfterReplacement,
        oldPinRejectedStatus: oldResidentLoginAfterReplacement.status,
        oldArrearUnchanged: JSON.stringify(preservedNovemberDue) === JSON.stringify(novemberArrearBefore),
        futureUntouchedDueBecameNotDue: transitionedDecemberDue?.status === "not_due" && transitionedDecemberDue.amount === 0 && transitionedDecemberDue.feeRateId === null,
        newHouseholdHistoryRowCount: Object.values(countOwnershipRows(replacementNewHistoryAfterLogin)).reduce((sum, count) => sum + count, 0),
        newLoginStatus: newResidentApiStatus,
        newResidentSessionCount,
        uniqueCurrentSameHouseResidentLoginCount: currentLoginCount,
        effectiveMonthSent: "2026-12",
      },
      deactivationEvidence: {
        status: deactivationStatus,
        householdStatus: deactivatedState.status,
        endsOn: deactivatedState.endsOn,
        personActive: deactivatedState.personIsActive,
        residentAccountStatus: deactivatedState.accountStatus,
        residentSessionCountBefore: deactivationSessionCountBefore,
        residentSessionCountAfter: deactivationSessionCountAfter,
        oldSessionApiStatusAfter: deactivationOldSessionStatus,
        resetAuditDelta: deactivationResetAuditAfter.resetActionCount - deactivationResetAuditBefore.resetActionCount,
        resetAuditHasCredentialLikeData: deactivationResetAuditAfter.resetContextHasPinLikeKey || deactivationResetAuditAfter.resetContextContainsSubmittedSecret || deactivationResetAuditAfter.resetContextHasHashLikeValue || deactivationResetAuditAfter.resetContextHasTokenLikeValue,
      },
      conflictEvidence: {
        status: conflictStatus,
        errorVisible: conflictErrorFacts.errorVisible,
        internalErrorVisible: conflictErrorFacts.internalErrorVisible,
        credentialVisible: conflictErrorFacts.credentialVisible,
        activeSessionCountBefore: conflictActiveSessionCountBefore,
        activeSessionCountAfter: conflictActiveSessionCountAfter,
        activeSessionCountUnchanged: conflictActiveSessionCountAfter === conflictActiveSessionCountBefore,
        lifecycleAuditCountBefore: conflictLifecycleAuditCountBefore,
        lifecycleAuditCountAfter: conflictLifecycleAuditCountAfter,
        lifecycleAuditCountUnchanged: conflictLifecycleAuditCountAfter === conflictLifecycleAuditCountBefore,
        financialContentRowCountBefore: conflictFinancialContentProof.rowCount,
        financialContentUnchanged: JSON.stringify(conflictFinancialContentAfterProof) === JSON.stringify(conflictFinancialContentProof),
        unchanged: true,
      },
      authorizationEvidence: { crossRt: crossRtEvidence, treasurer: treasurerEvidence },
      viewportScreenshotFiles: [...priorRunScreenshots, ...screenshotNames.map((name) => "docs/phase-12-1-acceptance-evidence/" + name)],
      postSmokeAudit,
      credentialSafety: "PINs, passwords, cookies, tokens, credential hashes, and connection values stayed in process memory only; evidence stores sanitized statuses, booleans, synthetic IDs, due snapshots, ownership keys, and aggregate counts.",
    });
    const resultPath = writeEvidence("agent-a-" + runId + "-browser-smoke-results.json", {
      runId, outcome: "PASS", manifest: manifestPath, scenarios: results,
      screenshotCount: priorRunScreenshots.length + screenshotNames.length,
      viewportStateCount: formViewportResults.length,
      target: target.projectId + "/" + target.branchId + "/" + target.database,
    });
    console.info(JSON.stringify({ outcome: "PASS", stage: "authenticated F12 household lifecycle smoke complete", manifest: manifestPath, result: resultPath, scenarios: results, screenshots: priorRunScreenshots.length + screenshotNames.length }));
  } finally {
    if (profile) await stopBrowser(profile);
    await stopServer();
    cleanupClockPreload();
    await closeDb();
  }
}



async function main() {
  loadEnvConfig(sourceRoot);
  const sourceHead = assertSource();
  const verifiedTarget = assertTarget();
  if (process.argv.includes("--preflight-only")) {
    stage = "read-only exact development target and migration verification";
    const db = await readOnlyPreflight();
    writeEvidence("agent-a-" + runId + "-preflight.json", {
      runId, outcome: "PASS", source: { branch: "fix/phase-12-1-acceptance-closure", baseline: baselineSha, head: sourceHead },
      target: { projectId: target.projectId, branchId: target.branchId, database: target.database, directEndpointVerified: verifiedTarget.directEndpointVerified },
      database: db, action: "Read-only preflight; no synthetic fixtures created."
    });
    console.info(JSON.stringify({ outcome: "PASS", stage, evidence: "preflight saved", target: target.projectId + "/" + target.branchId + "/" + target.database }));
    return;
  }
  requireAuthEnvironment();
  stage = "read-only exact development target and migration verification";
  const db = await readOnlyPreflight();
  const clockServerOnly = process.argv.find((argument) => argument.startsWith("--clock-server-only="))?.slice("--clock-server-only=".length);
  if (clockServerOnly) {
    await assertPortFree();
    stage = "read-only simulated local server readiness check";
    await startServer(clockServerOnly);
    console.info(JSON.stringify({ outcome: "PASS", stage, simulatedBusinessDate: clockServerOnly, action: "Local development server only; no fixture mutation." }));
    return;
  }
  if (process.argv.includes("--inspect-synthetic-fixtures-only")) {
    await inspectExistingSyntheticFixtures();
    return;
  }
  if (process.argv.includes("--inspect-reusable-fixture-only")) {
    const fixture = await reuseSyntheticChairmanFixture(false);
    const rates = await getDb().select({ billingYearId: feeRates.billingYearId, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
      .from(feeRates).where(eq(feeRates.rtUnitId, fixture.rtUnitId));
    if (rates.length !== 1 || rates[0]?.billingYearId !== fixture.billingYearId) throw new Error("Reusable fixture tariff was not unique for its open year.");
    console.info(JSON.stringify({ outcome: "PASS", stage: "read-only reusable synthetic Chairman fixture selection", rtUnitId: fixture.rtUnitId, existingTariff: { year: 2026, effectiveMonth: rates[0]!.effectiveMonth, monthlyAmount: rates[0]!.monthlyAmount }, target: target.projectId + "/" + target.branchId + "/" + target.database }));
    return;
  }
  if (process.argv.includes("--continue-lifecycle-only")) {
    stage = "continue authenticated F12 lifecycle smoke using existing synthetic fixtures";
    await continueHouseholdLifecycleSmoke(sourceHead);
    return;
  }
  await assertPortFree();
  const restartAuthDate = process.argv.find((argument) => argument.startsWith("--clock-restart-auth-only="))?.slice("--clock-restart-auth-only=".length);
  if (restartAuthDate) {
    const fixture = await reuseSyntheticChairmanFixture();
    let profile = "";
    try {
      stage = "start local app for cross-restart session diagnostic";
      await startServer();
      profile = await startBrowser();
      stage = "Chairman login before local clock restart diagnostic";
      await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
      await waitFor("location.pathname === '/app'", "Chairman login did not complete for restart diagnostic.");
      await stopServer();
      stage = "start local app with synthetic business date for auth diagnostic";
      await startServer(restartAuthDate);
      stage = "verify Chairman browser session across local server restart";
      try {
        await navigate("/app/rumah", { width: 390, height: 844 });
      } catch {
        safeDiagnostics = await evaluate<Record<string, unknown>>("(() => ({path:location.pathname,titleVisible:Boolean(document.querySelector('#chairman-household-title')),loginFormVisible:Boolean(document.querySelector('#login-identifier'),),loginAlert:Boolean(document.querySelector('[role=alert]')),bodyHasHouseholdText:(document.body.innerText||'').includes('Rumah dan warga')}))()");
        throw new Error("Chairman session did not survive the local server restart.");
      }
      const pageState = await evaluate<Record<string, unknown>>("(() => ({path:location.pathname,titleVisible:Boolean(document.querySelector('#chairman-household-title')),loginFormVisible:Boolean(document.querySelector('#login-identifier'))}))()");
      if (pageState.path !== "/app/rumah" || pageState.titleVisible !== true) throw new Error("Chairman session did not reach the authenticated household page after restart.");
      console.info(JSON.stringify({ outcome: "PASS", stage, simulatedBusinessDate: restartAuthDate, action: "Session continuity diagnostic; no household or financial fixture mutation." }));
    } finally {
      if (profile) await stopBrowser(profile);
      await stopServer();
    }
    return;
  }
  stage = "create synthetic Chairman fixture in verified development database";
  const fixture = await reuseSyntheticChairmanFixture(false);
  writeEvidence("agent-a-" + runId + "-chairman-fixture.json", {
    runId, target: { projectId: target.projectId, branchId: target.branchId, database: target.database }, migrationHead: expectedMigration,
    fixture: {
      rtUnitId: fixture.rtUnitId, chairmanHouseholdId: fixture.householdId, chairmanHouseId: fixture.houseId,
      chairmanPersonId: fixture.personId, chairmanAccountId: fixture.accountId, billingYearId: fixture.billingYearId,
      rtCode: fixture.rtCode, syntheticHouseNumber: fixture.houseNumber, reusedExistingFixture: fixture.reusedExistingFixture
    }, note: "Synthetic QA-only IDs; no names, PINs, passwords, tokens, hashes, or connection values."
  });
  stage = "start local authenticated app";
    await startServer("2026-11-01");
  let profile = "";
  try {
    stage = "launch isolated local browser";
    profile = await startBrowser();
    stage = "rotate only the selected synthetic Chairman credential after local app/browser readiness";
    const chairmanCredentialRows = await getDb().update(authAccount).set({ password: await hashPassword(fixture.password) })
      .where(and(eq(authAccount.userId, fixture.authUserId), eq(authAccount.providerId, "credential")))
      .returning({ id: authAccount.id });
    if (chairmanCredentialRows.length !== 1) throw new Error("Synthetic Chairman credential was not uniquely reusable after local browser readiness.");
    stage = "Chairman login and household list";
    stage = "render synthetic Chairman login page";
    await navigate("/login/pengurus", { width: 390, height: 844 });
    stage = "submit synthetic Chairman credentials through browser";
    await setInput("#login-identifier", fixture.identifier);
    await setInput("#login-password", fixture.password);
    await click("button.login-submit");
    await waitFor("location.pathname === '/app' || location.pathname.startsWith('/app/')", "Chairman login did not complete.");
    stage = "record or reuse future synthetic tariff through Chairman API";
    const feeRateId = await createInitialFutureTariff(fixture.rtUnitId, fixture.billingYearId);
    stage = "verify Chairman household list HTTP API session";
    const listApi = await evaluate<{ status: number }>("(async()=>{const r=await fetch('/api/chairman/households',{cache:'no-store'});return {status:r.status};})()");
    safeDiagnostics = { listApiStatus: listApi.status, browserPath: await evaluate<string>("location.pathname"), chairmanListTitleVisible: await evaluate<boolean>("Boolean(document.querySelector('#chairman-household-title'))") };
    assert.equal(listApi.status, 200, "Authenticated Chairman household list API did not return HTTP 200.");
    stage = "navigate to authenticated Chairman household page";
    await cdp("Network.emulateNetworkConditions", { offline: false, latency: 900, downloadThroughput: 750000, uploadThroughput: 500000, connectionType: "cellular3g" });
    await navigate("/app/rumah", { width: 390, height: 844 });
    const householdLoadingObserved = await evaluate<boolean>("[...document.querySelectorAll('[role=status]')].some(e=>/memuat/i.test(e.innerText||''))");
    assert.equal(householdLoadingObserved, true, "The household page loading state was not observed during the throttled browser navigation.");
    await screenshot("390x844-household-loading");
    await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "none" });
    stage = "wait for household page and list data";
    try {
      await waitFor("Boolean(document.querySelector('#chairman-household-title') && (document.querySelector('.chairman-household-empty') || document.querySelector('.chairman-household-list')))", "Household page data did not finish loading.");
    } catch {
      safeDiagnostics = await evaluate<Record<string, unknown>>("(() => { const text=document.body.innerText||''; return {path:location.pathname,titleVisible:Boolean(document.querySelector('#chairman-household-title')),listVisible:Boolean(document.querySelector('.chairman-household-list')),emptyVisible:Boolean(document.querySelector('.chairman-household-empty')),loadingVisible:Boolean([...document.querySelectorAll('[role=status]')].some(e=>e.innerText.includes('Memuat'))),friendlyErrorVisible:Boolean(document.querySelector('.chairman-household-alert')),loginFormVisible:Boolean(document.querySelector('#login-identifier')),internalErrorPattern:/SQLSTATE|relation .* does not exist|stack trace|DATABASE_URL|postgres/i.test(text)}; })()");
      throw new Error("Household page data did not finish loading.");
    }
    const viewports = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
    for (const viewport of viewports) {
      stage = "check household list viewport " + viewport.width + "x" + viewport.height;
      await navigate("/app/rumah", viewport);
      await waitFor("Boolean(document.querySelector('.chairman-household-empty') || document.querySelector('.chairman-household-list'))", "Household list was not ready at a requested viewport.");
      const view = await inspectViewportTargets();
      assert.equal(view.overflow, false, "Horizontal overflow at " + viewport.width + "px.");
      assert.equal(view.undersizedTargets.length, 0, "Visible actionable target is under 44px at " + viewport.width + "px.");
      viewportResults.push({ ...viewport, overflow: view.overflow, undersizedTargets: view.undersizedTargets });
      if (viewport.width === 390) await screenshot("390x844-chairman-list");
      if (viewport.width === 1440) await screenshot("1440x900-chairman-list");
    }
    stage = "search for exact synthetic Chairman household";
    await setInput(".chairman-household-search input", fixture.houseNumber);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(fixture.houseNumber) + ")", "Household search did not find the exact synthetic Chairman fixture.");
    stage = "open Chairman add-household form";
    await click("button.chairman-household-primary", "Tambah warga");
    await waitFor("Boolean(document.querySelector('#household-new-number'))", "Create household form did not open.");
    const newHouseNumber = "QA12-" + randomBytes(5).toString("hex").toUpperCase();
    const syntheticResidentName = "F12 QA synthetic Resident " + runId.slice(0, 8).toUpperCase();
    const newPin = String(randomInt(100000, 1000000));
    stage = "fill synthetic household and resident fields";
    await setInput("#household-new-number", newHouseNumber);
    await setInput("#household-new-label", "F12 QA disposable");
    const startsOn = "2026-11-01";
    await setInput("#household-starts-on", startsOn);
    await setInput("#household-create-name", syntheticResidentName);
    await setInput("#household-create-phone", "");
    await setInput("#household-create-pin", newPin);
    stage = "click household creation action in browser UI";
    await click("button", "Buat rumah dan warga");
    stage = "wait for household create API and UI success";
    try {
      await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('berhasil'))", "Household create did not return success.");
    } catch {
      safeDiagnostics = await evaluate<Record<string, unknown>>("(() => { const form=document.querySelector('.chairman-household-form'); const invalid=form?[...form.querySelectorAll('input,select,textarea')].filter(e=>!e.checkValidity()).map(e=>e.id||e.tagName):[]; const text=document.body.innerText||''; return {path:location.pathname,formValid:form?.checkValidity()??null,invalidFields:invalid,createFormVisible:Boolean(document.querySelector('#household-create-pin')),maskedPinFieldHasValue:Boolean(document.querySelector('#household-create-pin')?.value),feedbackStatus:Boolean([...document.querySelectorAll('[role=status]')].some(e=>e.innerText.includes('berhasil'))),friendlyAlertVisible:Boolean(document.querySelector('[role=alert]')),rawInternalErrorVisible:/SQLSTATE|stack trace|DATABASE_URL|postgres/i.test(text)}; })()");
      safeDiagnostics = { ...safeDiagnostics, createPosts: mutationCounts.create, householdApiStatuses: apiStatuses };
      throw new Error("Household create did not return success.");
    }
    await delay(300);
    assert.equal(mutationCounts.create, 1, "Household create did not send exactly one POST.");
    const newHouse = await collectNewHousehold(fixture.rtUnitId, newHouseNumber);
    if (!newHouse.resident?.accountId || !newHouse.resident.personId) throw new Error("Created household resident records are incomplete.");
    await setViewport({ width: 390, height: 844 });
    await screenshot("390x844-household-created");
    stage = "open resident edit form";
    const rename = "F12 QA synthetic Resident updated " + runId.slice(0, 8).toUpperCase();
    await setInput(".chairman-household-search input", newHouseNumber);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(newHouseNumber) + ")", "New synthetic household was not found for resident edit.");
    await click("button", "Ubah data");
    await waitFor("Boolean(document.querySelector('#household-edit-name'))", "Resident edit form did not open.");
    await setInput("#household-edit-name", rename);
    await setInput("#household-edit-phone", "0000000000");
    await setInput("#household-edit-label", "F12 QA edited");
    stage = "submit resident edit through browser UI";
    await click("button", "Simpan perubahan");
    await waitFor("document.querySelector('[role=status]')?.innerText.includes('Perubahan data warga berhasil')", "Resident edit did not return success.");
    await delay(300);
    assert.equal(mutationCounts.edit, 1, "Resident edit did not send exactly one PATCH.");
    await waitFor("Boolean(document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(rename) + "))", "Edited synthetic resident did not appear in the refreshed household list.");
    await setViewport({ width: 1440, height: 900 });
    await screenshot("1440x900-household-edited");
    const postHouse = await collectNewHousehold(fixture.rtUnitId, newHouseNumber);
    const editPersistedInDatabase = postHouse.resident?.fullName === rename;
    assert.equal(editPersistedInDatabase, true, "Resident edit did not persist the synthetic resident name in the development database.");
    stage = "resident authenticates with original PIN in browser";
    await loginThroughBrowser("warga", newHouseNumber, newPin);
    await waitFor("location.pathname === '/app'", "Synthetic resident login with the original PIN did not complete.");
    const oldResidentCookie = await currentResidentSessionCookie();
    const oldSessionCountBeforeReset = await activeResidentSessionCount(postHouse.resident.authUserId!);
    const oldSessionStatusBeforeReset = await savedCookieGet("/api/resident/monthly-dues", oldResidentCookie);
    assert.equal(oldSessionStatusBeforeReset, 200, "Original resident session could not read the resident API before PIN reset.");
    assert.ok(oldSessionCountBeforeReset >= 1, "Original resident login did not create an active session.");
    stage = "Chairman re-authenticates after resident session proof";
    await loginThroughBrowser("pengurus", fixture.identifier, fixture.password);
    await waitFor("location.pathname === '/app'", "Chairman re-login did not complete after resident session proof.");
    await navigate("/app/rumah", { width: 390, height: 844 });
    await setInput(".chairman-household-search input", newHouseNumber);
    await waitFor("document.querySelector('.chairman-household-list')?.innerText.includes(" + JSON.stringify(newHouseNumber) + ")", "Synthetic household was not found for PIN reset.");
    const resetAuditBefore = await residentAuditState(postHouse.resident.accountId!);
    const newResidentPin = String(randomInt(100000, 1000000));
    stage = "open Chairman PIN reset form";
    await click("button", "Atur PIN");
    await waitFor("Boolean(document.querySelector('#household-reset-pin'))", "Chairman PIN reset form did not open.");
    await setInput("#household-reset-pin", newResidentPin);
    await setInput("#household-reset-reason", "F12 QA synthetic credential rotation");
    await click("button", "Tinjau perubahan PIN");
    await waitFor("Boolean(document.querySelector('.chairman-household-confirm')?.innerText.includes('sesi sebelumnya akan dicabut'))", "PIN reset confirmation did not appear.");
    stage = "confirm Chairman PIN reset with a rapid double submit";
    const resetPostsBeforeConfirm = mutationCounts.reset;
    const doubleClickDispatched = await evaluate<boolean>("(() => { const button=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('Ya, atur PIN baru')); if(!button) return false; button.click(); button.click(); return true; })()");
    assert.equal(doubleClickDispatched, true, "PIN reset confirmation action was not available.");
    await waitFor("Boolean(document.querySelector('[role=status]')?.innerText.includes('PIN baru berhasil ditetapkan'))", "PIN reset did not return its success state.");
    await delay(250);
    assert.equal(mutationCounts.reset - resetPostsBeforeConfirm, 1, "Rapid double submit sent more than one PIN reset request.");
    const sessionCountAfterReset = await activeResidentSessionCount(postHouse.resident.authUserId!);
    const oldSessionStatusAfterReset = await savedCookieGet("/api/resident/monthly-dues", oldResidentCookie);
    const resetAuditAfter = await residentAuditState(postHouse.resident.accountId!, [newPin, newResidentPin, oldResidentCookie]);
    assert.equal(sessionCountAfterReset, 0, "PIN reset left an active prior resident session.");
    assert.equal(oldSessionStatusAfterReset, 401, "The captured prior resident session remained authorized after PIN reset.");
    assert.equal(resetAuditAfter.resetActionCount - resetAuditBefore.resetActionCount, 1, "PIN reset did not write exactly one resident.pin.reset audit event.");
    assert.equal(resetAuditAfter.resetContextHasPinLikeKey, false, "PIN reset audit context contains a prohibited credential-like key.");
    assert.equal(resetAuditAfter.resetContextContainsSubmittedSecret, false, "PIN reset audit context contains the submitted PIN or captured session cookie.");
    assert.equal(resetAuditAfter.resetContextHasHashLikeValue, false, "PIN reset audit context contains a hash-like value.");
    assert.equal(resetAuditAfter.resetContextHasTokenLikeValue, false, "PIN reset audit context contains a token-like value.");
    await setViewport({ width: 390, height: 844 });
    await screenshot("390x844-pin-reset-success");
    const pinSessionEvidence = {
      runId, target: { projectId: target.projectId, branchId: target.branchId, database: target.database },
      clock: "Local dev server business date is simulated as 2026-11-01 through its Asia/Jakarta business-date helper; real Date and session expiry remain unchanged.",
      householdId: postHouse.householdId, residentAccountId: postHouse.resident.accountId,
      residentLoginBeforeReset: "PASS", sessionCountBeforeReset: oldSessionCountBeforeReset,
      residentApiStatusBeforeReset: oldSessionStatusBeforeReset,
      resetUiConfirmation: "PASS", doubleSubmitGuard: mutationCounts.reset - resetPostsBeforeConfirm === 1,
      sessionCountAfterReset, capturedOldSessionApiStatusAfterReset: oldSessionStatusAfterReset,
      resetAuditEventCount: resetAuditAfter.resetActionCount - resetAuditBefore.resetActionCount,
      resetAuditContextHasCredentialLikeKey: resetAuditAfter.resetContextHasPinLikeKey,
      resetAuditContextContainsSensitiveValue: resetAuditAfter.resetContextContainsSubmittedSecret,
      resetAuditContextHasHashLikeValue: resetAuditAfter.resetContextHasHashLikeValue,
      resetAuditContextHasTokenLikeValue: resetAuditAfter.resetContextHasTokenLikeValue,
      screenshotsSaved: ["390x844-pin-reset-success"],
      credentialSafety: "PINs and session cookie were kept only in process memory; evidence contains no credential values or hashes."
    };
    writeEvidence("agent-a-" + runId + "-pin-session-evidence.json", pinSessionEvidence);
    stage = "old PIN is rejected after reset";
    await loginThroughBrowser("warga", newHouseNumber, newPin);
    await waitFor("Boolean(document.querySelector('.login-form [role=alert]'))", "Old resident PIN unexpectedly succeeded after reset.");
    const oldPinErrorIsGeneric = await evaluate<boolean>("/belum cocok|periksa kembali/i.test(document.querySelector('.login-form [role=alert]')?.innerText||'')");
    assert.equal(oldPinErrorIsGeneric, true, "Old PIN rejection did not use a generic safe login error.");
    stage = "new PIN authenticates resident through browser";
    await loginThroughBrowser("warga", newHouseNumber, newResidentPin);
    try {
      await waitFor("location.pathname === '/app' && Boolean(document.querySelector('.resident-area')) && (document.body.innerText||'').includes(" + JSON.stringify(newHouseNumber) + ") && (document.body.innerText||'').includes(" + JSON.stringify(rename) + ")", "Resident did not authenticate with the newly reset PIN and show the edited same-house profile.");
    } catch {
      safeDiagnostics = await evaluate<Record<string, unknown>>("(() => {const text=document.body.innerText||'';return {path:location.pathname,loginFormVisible:Boolean(document.querySelector('#login-identifier')),genericLoginAlert:Boolean(document.querySelector('.login-form [role=alert]')),appHeading:(document.querySelector('h1')?.innerText||'').slice(0,100),residentAreaVisible:Boolean(document.querySelector('.resident-area')),syntheticHouseNumberVisible:text.includes(" + JSON.stringify(newHouseNumber) + "),editedSyntheticNameVisible:text.includes(" + JSON.stringify(rename) + "),originalSyntheticNameVisible:text.includes(" + JSON.stringify(syntheticResidentName) + "),loadingState:Boolean(document.querySelector('[role=status]'))}})()");
      safeDiagnostics = { ...safeDiagnostics, authStatuses };
      throw new Error("Resident did not authenticate with the newly reset PIN.");
    }
    const newPinResidentApiStatus = await evaluate<number>("(async()=>{const r=await fetch('/api/resident/monthly-dues',{cache:'no-store'});return r.status;})()");
    assert.equal(newPinResidentApiStatus, 200, "New PIN session could not read resident dues.");
    const newResidentSessionCount = await activeResidentSessionCount(postHouse.resident.authUserId!);
    assert.equal(newResidentSessionCount, 1, "New PIN login did not create exactly one current resident session.");
    const newPinProfileEvidence = await evaluate<{ residentAreaVisible: boolean; houseNumberVisible: boolean; editedNameVisible: boolean; originalNameVisible: boolean }>("(() => {const text=document.body.innerText||'';return {residentAreaVisible:Boolean(document.querySelector('.resident-area')),houseNumberVisible:text.includes(" + JSON.stringify(newHouseNumber) + "),editedNameVisible:text.includes(" + JSON.stringify(rename) + "),originalNameVisible:text.includes(" + JSON.stringify(syntheticResidentName) + ")}})()");
    assert.equal(newPinProfileEvidence.residentAreaVisible, true, "New PIN login did not render the resident profile area.");
    assert.equal(newPinProfileEvidence.houseNumberVisible, true, "New PIN login did not render the resident's same house number.");
    assert.equal(newPinProfileEvidence.editedNameVisible, true, "New PIN login did not render the edited synthetic resident name.");
    writeEvidence("agent-a-" + runId + "-resident-login-evidence.json", {
      runId, target: { projectId: target.projectId, branchId: target.branchId, database: target.database },
      newPinLoginStatus: authStatuses["/api/login/resident"]?.at(-1) ?? null,
      oldPinRejectedStatus: authStatuses["/api/login/resident"]?.at(-2) ?? null,
      residentApiStatus: newPinResidentApiStatus, activeResidentSessionCount: newResidentSessionCount,
      profile: newPinProfileEvidence, editedNamePersistedInDatabase: editPersistedInDatabase,
      credentialSafety: "No PIN, password, session cookie/token, credential hash, or database connection value is included."
    });
    await setViewport({ width: 390, height: 844 });
    await screenshot("390x844-resident-new-pin-login");
    const manifest = {
      runId, outcome: "PASS", target: { projectId: target.projectId, branchId: target.branchId, database: target.database }, migrationHead: expectedMigration,
      source: { branch: "fix/phase-12-1-acceptance-closure", baseline: baselineSha, head: sourceHead, provenanceSha256: sourceProvenance() },
      preflight: db,
      loadingStateObserved: householdLoadingObserved,
      syntheticChairman: { rtUnitId: fixture.rtUnitId, householdId: fixture.householdId, personId: fixture.personId, accountId: fixture.accountId },
      supportingFutureTariffId: feeRateId,
      createdResident: {
        houseNumber: newHouseNumber, householdId: newHouse.householdId, houseId: newHouse.houseId,
        personId: newHouse.resident.personId, accountId: newHouse.resident.accountId,
        startsOn: newHouse.startsOn, status: newHouse.status,
        dues: newHouse.dues, postEditNameIsSynthetic: true, accountStatus: "active"
      },
      results: { chairmanLogin: "PASS", householdList: "PASS", search: "PASS", add: "PASS", edit: "PASS", residentLoginBeforeReset: "PASS", pinReset: "PASS", oldSessionRevoked: "PASS", oldPinRejected: "PASS", newPinLogin: "PASS", mutationPosts: mutationCounts.create + mutationCounts.edit + mutationCounts.reset },
      pinSession: { sessionCountBeforeReset: oldSessionCountBeforeReset, sessionCountAfterReset, oldSessionApiStatusBeforeReset: oldSessionStatusBeforeReset, oldSessionApiStatusAfterReset: oldSessionStatusAfterReset, resetAuditActionCount: resetAuditAfter.resetActionCount, resetAuditContextHasCredentialLikeKey: resetAuditAfter.resetContextHasPinLikeKey, resetAuditContextContainsSensitiveValue: resetAuditAfter.resetContextContainsSubmittedSecret, resetAuditContextHasHashLikeValue: resetAuditAfter.resetContextHasHashLikeValue, resetAuditContextHasTokenLikeValue: resetAuditAfter.resetContextHasTokenLikeValue, newPinSessionCount: newResidentSessionCount },
      postSmokeAudit: { qaSeedAttempts: await readQaSeedAttempts(fixture.rtUnitId) },
      viewportResults, screenshotsSaved: ["390x844-chairman-list", "1440x900-chairman-list", ...(householdLoadingObserved ? ["390x844-household-loading"] : []), "390x844-household-created", "1440x900-household-edited", "390x844-pin-reset-success", "390x844-resident-new-pin-login"],
      credentialSafety: "No PIN, password, session cookie/token, credential hash, database URL, or user-supplied identity is included."
    };
    writeEvidence("agent-a-" + runId + "-fixture-manifest.json", { ...manifest, evidenceType: "fixture-manifest" });
    writeEvidence("agent-a-" + runId + "-browser-smoke-results.json", { ...manifest, evidenceType: "browser-smoke-results" });
    console.info(JSON.stringify({ outcome: "PASS", stage: "Chairman login/list/search/add/edit", createdHouseholdId: newHouse.householdId, screenshots: 4, viewportWidths: viewportResults.map((v) => v.width) }));
  } finally {
    if (profile) await stopBrowser(profile);
    await stopServer();
  }
}

async function entry() {
  try {
    await main();
  } catch {
    try { writeEvidence("agent-a-" + runId + "-failure.json", { runId, outcome: "FAIL", stage, diagnostics: safeDiagnostics, note: "Sanitized failure record; underlying error details suppressed." }); } catch {}
    console.error(JSON.stringify({ outcome: "FAIL", stage, evidence: "sanitized failure record saved" }));
    process.exitCode = 1;
  } finally {
    try { await closeDb(); } catch {}
    await stopServer();
    cleanupClockPreload();
  }
}

void entry();
