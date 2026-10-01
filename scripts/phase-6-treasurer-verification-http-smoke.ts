import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  houses,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
  people,
  rtSettings,
  rtUnits,
} from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { dueToken, duesSummary, residentStatusLabels } from "@/lib/billing/resident-card";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
  databaseName: "neondb",
};
const root = process.cwd();
const expectedPort = 3199;
const browserViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const userIds: string[] = [];
let nextProcess: ChildProcess | undefined;
let chromeProcess: ChildProcess | undefined;
let devtoolsSocket: WebSocket | undefined;
let browserProfile: string | undefined;
let currentSmokeStage = "initialization";

type FixturePerson = {
  accountId: string;
  userId: string;
  householdId: string;
  personId: string;
};

function assertDevelopmentTarget() {
  const env = requireDatabaseEnvironment();
  if (env.appEnv !== "development" || env.databaseEnv !== "development") {
    throw new Error("Phase 6 smoke requires APP_ENV and DATABASE_ENV to both be development.");
  }
  const expected = {
    KARTURT_NEON_DEV_PROJECT_ID: target.projectId,
    KARTURT_NEON_DEV_BRANCH_ID: target.branchId,
    KARTURT_NEON_DEV_ENDPOINT_ID: target.endpointId,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new Error(`The verified development target is required in ${key}.`);
  }
  const databaseUrl = new URL(env.databaseUrl);
  if (
    databaseUrl.hostname.split(".")[0] !== target.endpointId ||
    databaseUrl.hostname.includes("pooler") ||
    databaseUrl.pathname !== `/${target.databaseName}`
  ) {
    throw new Error("DATABASE_URL must use the direct karturt-development endpoint and neondb database.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL must point to the local smoke server.");
  const parsedAppUrl = new URL(appUrl);
  if (parsedAppUrl.hostname !== "127.0.0.1" || Number(parsedAppUrl.port) !== expectedPort) {
    throw new Error(`NEXT_PUBLIC_APP_URL must use http://127.0.0.1:${expectedPort} for this smoke.`);
  }
  return { baseUrl: parsedAppUrl.origin, databaseHost: databaseUrl.hostname };
}

function getChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
  ].filter((value): value is string => Boolean(value));
  const browser = candidates.find((candidate) => existsSync(candidate));
  if (!browser) throw new Error("Chrome or Edge was not found. Set CHROME_PATH to its executable.");
  return browser;
}

async function startNext(baseUrl: string) {
  const appUrl = new URL(baseUrl);
  nextProcess = spawn(process.execPath, [
    resolve(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(expectedPort),
  ], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: appUrl.origin },
    stdio: "ignore",
    windowsHide: true,
  });
  nextProcess.once("error", (error) => { throw error; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (nextProcess.exitCode !== null) throw new Error("Next development server exited before becoming ready.");
    try {
      const response = await fetch(`${baseUrl}/login/pengurus`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await delay(500);
  }
  throw new Error("Next development server did not become ready.");
}

async function createPerson(
  db: ReturnType<typeof getDb>,
  rtUnitId: string,
  options: { houseNumber: string; name: string; loginIdentifier: string; accountType: "resident" | "official"; phone?: string },
): Promise<FixturePerson> {
  const [house] = await db.insert(houses).values({ rtUnitId, number: options.houseNumber }).returning({ id: houses.id });
  const [household] = await db.insert(households).values({
    rtUnitId,
    houseId: house!.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [person] = await db.insert(people).values({
    rtUnitId,
    householdId: household!.id,
    fullName: options.name,
    phone: options.phone ?? null,
  }).returning({ id: people.id });
  const userId = randomUUID();
  await db.insert(authUser).values({
    id: userId,
    name: options.name,
    email: `${options.loginIdentifier.toLowerCase()}@example.invalid`,
    emailVerified: true,
  });
  const [account] = await db.insert(appAccounts).values({
    rtUnitId,
    authUserId: userId,
    accountType: options.accountType,
    loginIdentifier: options.loginIdentifier,
    personId: person!.id,
    householdId: options.accountType === "resident" ? household!.id : null,
  }).returning({ id: appAccounts.id });
  userIds.push(userId);
  return { accountId: account!.id, userId, householdId: household!.id, personId: person!.id };
}

async function signIn(baseUrl: string, type: "resident" | "official", identifier: string, password: string) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${baseUrl}/api/login/${type}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ identifier, password }),
    });
    if (response.status !== 429 || attempt > 0) break;
    const retryAfter = response.headers.get("retry-after");
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : retryAfter
        ? Date.parse(retryAfter) - Date.now()
        : 60_000;
    await delay(Math.min(Math.max(retryDelay, 1000), 65_000));
  }
  assert.ok(response);
  const message = await response.clone().text();
  assert.equal(response.status, 200, `Normal ${type} sign-in must issue a session: ${message}`);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie, `Normal ${type} sign-in must return a session cookie.`);
  return cookie;
}

function cookiePairs(cookie: string) {
  return cookie.split("; ").map((part) => {
    const separator = part.indexOf("=");
    return { name: part.slice(0, separator), value: part.slice(separator + 1) };
  });
}

async function postJson(url: string, cookie: string | undefined, origin: string | undefined, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  if (new URL(url).pathname === "/api/resident/payment-requests") headers.set("idempotency-key", randomUUID());
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
}

async function createRequestOverHttp(baseUrl: string, residentCookie: string, period: string) {
  const response = await postJson(`${baseUrl}/api/resident/payment-requests`, residentCookie, baseUrl, { period });
  assert.equal(response.status, 200, `Resident must be able to request ${period} over HTTP.`);
  const result = await response.json() as { requestCode: string; status: string; periods: string[]; totalAmount: number };
  assert.equal(result.status, "pending");
  assert.ok(result.requestCode);
  return result;
}

async function readRequestArtifacts(db: ReturnType<typeof getDb>, requestCode: string) {
  const [request] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, requestCode));
  assert.ok(request, `Request ${requestCode} must exist in Neon development.`);
  const items = await db.select().from(paymentRequestItems)
    .where(eq(paymentRequestItems.requestId, request.id));
  const [paymentRows, allocationRows, claimRows, auditRows] = await Promise.all([
    db.select().from(payments).where(eq(payments.paymentRequestId, request.id)),
    db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentRequestId, request.id)),
    db.select().from(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, request.id)),
    db.select().from(auditEvents).where(and(
      eq(auditEvents.entityType, "payment_request"),
      eq(auditEvents.entityId, request.id),
      inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
    )),
  ]);
  const dueRows = items.length
    ? await db.select().from(monthlyDues).where(inArray(monthlyDues.id, items.map((item) => item.monthlyDueId)))
    : [];
  return { request, items, payments: paymentRows, allocations: allocationRows, claims: claimRows, audits: auditRows, dues: dueRows };
}

function assertNoPaymentResolution(
  artifacts: Awaited<ReturnType<typeof readRequestArtifacts>>,
  status: "rejected" | "cancelled",
  action: "payment_request.rejected" | "payment_request.cancelled",
  reason: string | null,
) {
  assert.equal(artifacts.request.status, status);
  assert.equal(artifacts.items.length, artifacts.request.itemCount, "Terminal request item history must be retained.");
  assert.equal(artifacts.payments.length, 0);
  assert.equal(artifacts.allocations.length, 0);
  assert.equal(artifacts.claims.length, 0);
  assert.ok(artifacts.dues.every((due) => due.status === "unpaid"));
  assert.equal(artifacts.audits.length, 1);
  assert.equal(artifacts.audits[0]!.action, action);
  assert.equal(artifacts.audits[0]!.reason, reason);
  assert.deepEqual(artifacts.audits[0]!.context, {
    itemCount: artifacts.request.itemCount,
    totalAmount: artifacts.request.totalAmount,
  });
}

async function assertRaceWinner(
  db: ReturnType<typeof getDb>,
  requestCode: string,
  winningAction: "payment_request.verified" | "payment_request.rejected" | "payment_request.cancelled",
  rejectReason: string,
) {
  const artifacts = await readRequestArtifacts(db, requestCode);
  assert.equal(artifacts.audits.length, 1, "Exactly one terminal audit event may win a race.");
  assert.equal(artifacts.audits[0]!.action, winningAction);
  assert.equal(artifacts.items.length, artifacts.request.itemCount, "Race must preserve request item history.");
  assert.equal(artifacts.claims.length, 0, "Race winner must release all claims.");
  if (winningAction === "payment_request.verified") {
    assert.equal(artifacts.request.status, "verified");
    assert.equal(artifacts.payments.length, 1);
    assert.equal(artifacts.allocations.length, artifacts.items.length);
    assert.equal(artifacts.allocations.reduce((sum, allocation) => sum + allocation.amount, 0), artifacts.request.totalAmount);
    assert.ok(artifacts.dues.every((due) => due.status === "paid"));
    assert.equal(artifacts.audits[0]!.reason, null);
  } else {
    const status = winningAction === "payment_request.rejected" ? "rejected" : "cancelled";
    assertNoPaymentResolution(
      artifacts,
      status,
      winningAction,
      winningAction === "payment_request.rejected" ? rejectReason : null,
    );
  }
  return artifacts.request.status;
}

async function runBrowserSmoke(
  baseUrl: string,
  treasurerCookie: string,
  secondTreasurerCookie: string,
  residentCookie: string,
  firstCode: string,
  secondCode: string,
  phase7: {
    residentCookie: string;
    treasurerCookie: string;
    pendingCode: string;
    cancelledCode: string;
    rejectedCode: string;
  },
) {
  const tempRoot = resolve(tmpdir());
  browserProfile = mkdtempSync(join(tempRoot, "karturt-phase-6-chrome-"));
  const resolvedProfile = resolve(browserProfile);
  if (!resolvedProfile.startsWith(`${tempRoot}${sep}`)) throw new Error("Chrome profile escaped the temp directory.");
  chromeProcess = spawn(getChromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${resolvedProfile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const activePortPath = join(resolvedProfile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(activePortPath); attempt += 1) {
    if (chromeProcess.exitCode !== null) throw new Error("Chrome exited before its debug port opened.");
    await delay(100);
  }
  if (!existsSync(activePortPath)) throw new Error("Chrome debug port did not open.");
  const debugPort = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const pageTarget = targets.find((item) => item.type === "page");
  if (!pageTarget) throw new Error("Chrome did not provide a page target.");
  devtoolsSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const requestedVerifyUrls: string[] = [];
  const requestedCancelUrls: string[] = [];
  const requestedRejectUrls: string[] = [];
  const pageErrors: string[] = [];
  let commandId = 0;
  devtoolsSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown> };
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request as { url?: string } | undefined;
      if (request?.url?.includes("/api/treasurer/payment-requests/") && request.url.endsWith("/verify")) requestedVerifyUrls.push(request.url);
      if (request?.url?.includes("/api/resident/payment-requests/") && request.url.endsWith("/cancel")) requestedCancelUrls.push(request.url);
      if (request?.url?.includes("/api/treasurer/payment-requests/") && request.url.endsWith("/reject")) requestedRejectUrls.push(request.url);
    }
    if (message.method === "Runtime.exceptionThrown") pageErrors.push("Uncaught browser exception");
    if (message.method === "Log.entryAdded") {
      const entry = (message.params?.entry ?? {}) as { level?: string };
      if (entry.level === "error") pageErrors.push("Browser console error");
    }
    if (typeof message.id !== "number") return;
    const resolveMessage = pending.get(message.id);
    if (!resolveMessage) return;
    pending.delete(message.id);
    resolveMessage(message);
  });
  await new Promise<void>((resolveOpen, rejectOpen) => {
    devtoolsSocket!.addEventListener("open", () => resolveOpen(), { once: true });
    devtoolsSocket!.addEventListener("error", () => rejectOpen(new Error("Chrome DevTools connection failed.")), { once: true });
  });
  const command = (method: string, params: Record<string, unknown> = {}) => {
    const id = ++commandId;
    const promise = new Promise<Record<string, unknown>>((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectMessage(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 30000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) rejectMessage(new Error(`Chrome DevTools command failed: ${method}`));
        else resolveMessage(message);
      });
    });
    devtoolsSocket!.send(JSON.stringify({ id, method, params }));
    return promise;
  };
  const evaluate = async <T,>(expression: string): Promise<T> => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const result = response.result as { result?: { value?: T }; exceptionDetails?: unknown };
    if (result?.exceptionDetails) throw new Error(`Browser page evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    return result?.result?.value as T;
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
      mobile: false,
    });
  };
  const navigate = async (url: string, viewport: { width: number; height: number }) => {
    await setViewport(viewport);
    const currentUrl = await evaluate<string>("location.href");
    if (currentUrl === url) {
      await command("Page.reload", { ignoreCache: true });
      await delay(200);
    } else {
      await command("Page.navigate", { url });
    }
    await waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, "Browser navigation did not finish loading the requested URL.");
    await delay(200);
  };
  const capture = async (name: string) => {
    const response = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    const data = (response.result as { data?: unknown } | undefined)?.data;
    assert.equal(typeof data, "string", "Chrome did not return screenshot evidence.");
    const directory = resolve(root, "docs", "phase-6-evidence");
    mkdirSync(directory, { recursive: true });
    const imagePath = join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.png`);
    writeFileSync(imagePath, Buffer.from(data as string, "base64"), { flag: "wx" });
  };
  const capturePhase7 = async (name: string) => {
    const response = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    const data = (response.result as { data?: unknown } | undefined)?.data;
    assert.equal(typeof data, "string", "Chrome did not return Phase 7 screenshot evidence.");
    const directory = resolve(root, "docs", "phase-7-evidence");
    mkdirSync(directory, { recursive: true });
    const imagePath = join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.png`);
    writeFileSync(imagePath, Buffer.from(data as string, "base64"), { flag: "wx" });
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Network.enable");
  for (const { name, value } of cookiePairs(treasurerCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }

  await navigate(`${baseUrl}/app`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser Treasurer queue at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.treasurer-queue') !== null", "Treasurer queue did not render in the browser.");
    const queue = await evaluate<{ count: number; codes: string[]; overflow: boolean }>(`(() => ({
      count: Number(document.querySelector('.treasurer-count')?.textContent),
      codes: [...document.querySelectorAll('.treasurer-request-code')].map(item => item.textContent.trim()),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))()`);
    assert.equal(queue.count, 3);
    assert.deepEqual(queue.codes, [firstCode, secondCode, phase7.pendingCode], "Visible HTTP queue must preserve oldest-first ordering.");
    assert.equal(queue.overflow, false, `Queue has horizontal overflow at ${viewport.width}px.`);
    if (viewport.width === 390) await capture("treasurer-queue-390x844");
  }

  await navigate(`${baseUrl}/app/bendahara/${firstCode}`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser Treasurer pending detail at ${viewport.width}px`;
    await setViewport(viewport);
    try {
      await waitFor("document.querySelector('.treasurer-confirm-button') !== null", "Pending request detail did not render.");
    } catch {
      const page = await evaluate<{ href: string; title: string; body: string }>(`({
        href: location.href,
        title: document.title,
        body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
      })`);
      throw new Error(`Pending request detail did not render: ${JSON.stringify(page)}`);
    }
    const detail = await evaluate<{ warning: boolean; buttonHeight: number; visibleCode: boolean; items: string[]; total: string; overflow: boolean; technicalCopy: boolean }>(`(() => {
      const button = document.querySelector('.treasurer-confirm-button');
      const text = document.body?.innerText ?? '';
      return {
        warning: text.includes('Pastikan transfer sudah diterima sebelum mengonfirmasi.'),
        buttonHeight: Math.round(button.getBoundingClientRect().height),
        visibleCode: text.includes('${firstCode}'),
        items: [...document.querySelectorAll('.treasurer-detail-items li')].map(item => item.innerText.replace(/\\s+/g, ' ').trim()),
        total: document.querySelector('.treasurer-detail-total')?.innerText.replace(/\\s+/g, ' ').trim(),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        technicalCopy: /SQLSTATE|undefined|null|internal server error/i.test(text),
      };
    })()`);
    assert.equal(detail.warning, true);
    assert.ok(detail.buttonHeight >= 44, `Verify control is below 44px at ${viewport.width}px.`);
    assert.equal(detail.visibleCode, true);
    assert.equal(detail.items.length, 3);
    assert.ok(detail.items.every((item) => item.includes("Rp 18.000")));
    assert.ok(detail.total?.includes("Rp 54.000"));
    assert.equal(detail.overflow, false, `Detail has horizontal overflow at ${viewport.width}px.`);
    assert.equal(detail.technicalCopy, false);
    if (viewport.width === 390) await capture("treasurer-detail-pending-390x844");
  }

  const verifyUrl = `${baseUrl}/api/treasurer/payment-requests/${firstCode}/verify`;
  const concurrentResponses = await Promise.all([
    fetch(verifyUrl, { method: "POST", headers: { cookie: treasurerCookie, origin: baseUrl, "content-type": "application/json" }, body: "{}" }),
    fetch(verifyUrl, { method: "POST", headers: { cookie: secondTreasurerCookie, origin: baseUrl, "content-type": "application/json" }, body: "{}" }),
  ]);
  assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [200, 409]);
  const conflictResponse = concurrentResponses.find((response) => response.status === 409)!;
  assert.equal((await conflictResponse.json() as { code?: string }).code, "already_processed");
  const successResponse = concurrentResponses.find((response) => response.status === 200)!;
  assert.equal((await successResponse.json() as { status?: string }).status, "verified");

  await navigate(`${baseUrl}/app/bendahara/${firstCode}`, { width: 390, height: 844 });
  try {
    await waitFor("document.querySelector('.treasurer-status--done') !== null", "Already-processed detail state did not render.");
  } catch {
    const page = await evaluate<{ href: string; title: string; body: string }>(`({
      href: location.href,
      title: document.title,
      body: document.body?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? '',
    })`);
    throw new Error(`Already-processed detail state did not render: ${JSON.stringify(page)}`);
  }
  assert.equal(await evaluate<boolean>(`document.body.innerText.includes('Sudah dikonfirmasi') && !document.querySelector('.treasurer-confirm-button')`), true);
  await capture("treasurer-detail-processed-390x844");

  await navigate(`${baseUrl}/app/bendahara/${secondCode}`, { width: 390, height: 844 });
  await waitFor("document.querySelector('.treasurer-confirm-button') !== null", "Second pending request detail did not render.");
  const verifyCountBefore = requestedVerifyUrls.length;
  await evaluate(`(() => {
    const button = document.querySelector('.treasurer-confirm-button');
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await waitFor("document.body.innerText.includes('Pembayaran berhasil dikonfirmasi.')", "Browser verify button did not reach success state.");
  assert.equal(requestedVerifyUrls.length - verifyCountBefore, 1, "Rapid duplicate browser clicks must issue one verify request.");
  await capture("treasurer-detail-confirmed-by-browser-390x844");

  await navigate(`${baseUrl}/app/bendahara/${secondCode}`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser Treasurer processed detail at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.treasurer-status--done') !== null", "Processed state did not render at every viewport.");
    const detail = await evaluate<{ overflow: boolean; noAction: boolean }>(`(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      noAction: !document.querySelector('.treasurer-confirm-button'),
    }))()`);
    assert.equal(detail.overflow, false, `Processed detail has horizontal overflow at ${viewport.width}px.`);
    assert.equal(detail.noAction, true);
  }

  for (const { name, value } of cookiePairs(residentCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await navigate(`${baseUrl}/app`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser resident paid summary at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.resident-summary') !== null", "Resident card did not render after verification.");
    const resident = await evaluate<{ summary: string[]; summaryAmounts: string[]; paidMonths: number; pendingMonths: number; noArrears: boolean; overflow: boolean }>(`(() => ({
      summary: [...document.querySelectorAll('.resident-summary span')].map(item => item.textContent.trim()),
      summaryAmounts: [...document.querySelectorAll('.resident-summary strong')].map(item => item.textContent.trim()),
      paidMonths: [...document.querySelectorAll('.due-status.status-paid')].length,
      pendingMonths: document.querySelectorAll('.due-status.status-pending').length,
      noArrears: !document.body.innerText.includes('Tunggakan'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))()`);
    assert.deepEqual(resident.summary, ["Belum bayar", "Menunggu konfirmasi", "Sudah bayar"]);
    assert.equal(resident.paidMonths, 3);
    assert.equal(resident.summaryAmounts[1], "Rp 0");
    assert.equal(resident.pendingMonths, 0);
    assert.equal(resident.noArrears, true);
    assert.equal(resident.overflow, false, `Resident card has horizontal overflow at ${viewport.width}px.`);
    if (viewport.width === 390) await capture("resident-paid-390x844");
  }
  await navigate(`${baseUrl}/app`, { width: 390, height: 844 });
  await waitFor("document.querySelector('.resident-summary') !== null", "Resident card did not render before history check.");
  await evaluate(`(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Riwayat')?.click())()`);
  await waitFor("document.querySelector('.dues-history') !== null", "Resident payment history did not render.");
  const history = await evaluate<{ rows: string[]; overflow: boolean }>(`(() => ({
    rows: [...document.querySelectorAll('.dues-history li')].map(item => item.innerText.replace(/\\s+/g, ' ').trim()),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  assert.equal(history.rows.length, 3);
  assert.ok(history.rows.every((row) => row.includes("Sudah bayar")));
  assert.equal(history.overflow, false);
  await capture("resident-paid-history-390x844");

  for (const { name, value } of cookiePairs(phase7.residentCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await evaluate(`localStorage.setItem("karturt:resident-tab", "card")`);
  await navigate(`${baseUrl}/app`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser resident request history at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor(`(() => {
      const text = document.body.innerText;
      const cancelButton = [...document.querySelectorAll('.payment-request-history-list button')]
        .some(button => button.textContent.trim() === 'Batalkan permintaan');
      return document.querySelector('.payment-request-history') !== null &&
        text.includes('${phase7.cancelledCode}') && text.includes('${phase7.rejectedCode}') &&
        text.includes('${phase7.pendingCode}') && text.includes('Bukti transfer belum terbaca.') && cancelButton;
    })()`, "Resident payment-request history and terminal labels did not finish rendering in the browser.");
    const panel = await evaluate<{
      cancelled: boolean;
      rejected: boolean;
      reason: boolean;
      pending: boolean;
      cancelButtonHeight: number;
      overflow: boolean;
      technicalCopy: boolean;
    }>(`(() => {
      const text = document.body.innerText;
      const cancelButton = [...document.querySelectorAll('.payment-request-history-list button')]
        .find(button => button.textContent.trim() === 'Batalkan permintaan');
      return {
        cancelled: text.includes('${phase7.cancelledCode}') && text.includes('Dibatalkan'),
        rejected: text.includes('${phase7.rejectedCode}') && text.includes('Ditolak'),
        reason: text.includes('Bukti transfer belum terbaca.'),
        pending: text.includes('${phase7.pendingCode}') && Boolean(cancelButton),
        cancelButtonHeight: cancelButton ? Math.round(cancelButton.getBoundingClientRect().height) : 0,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        technicalCopy: /SQLSTATE|undefined|null|internal server error/i.test(text),
      };
    })()`);
    assert.equal(panel.cancelled, true, `Cancelled history item missing at ${viewport.width}px.`);
    assert.equal(panel.rejected, true, `Rejected history item missing at ${viewport.width}px.`);
    assert.equal(panel.reason, true, `Rejection reason missing at ${viewport.width}px.`);
    assert.equal(panel.pending, true, `Pending history item or cancel control missing at ${viewport.width}px.`);
    assert.ok(panel.cancelButtonHeight >= 44, `Resident cancel control is below 44px at ${viewport.width}px.`);
    assert.equal(panel.overflow, false, `Resident payment-request history has horizontal overflow at ${viewport.width}px.`);
    assert.equal(panel.technicalCopy, false);
    if (viewport.width === 390) await capturePhase7("resident-request-history-pending-390x844");
  }

  await setViewport({ width: 390, height: 844 });
  const cancelCountBefore = requestedCancelUrls.length;
  await evaluate(`(() => [...document.querySelectorAll('.payment-request-history-list button')]
    .find(button => button.textContent.trim() === 'Batalkan permintaan')?.click())()`);
  await waitFor("document.querySelector('.payment-request-cancel-confirm') !== null", "Resident cancel confirmation did not render.");
  assert.equal(await evaluate<boolean>("document.body.innerText.includes('Setelah dibatalkan, bulan kembali menjadi Belum bayar dan bisa diajukan lagi.')"), true);
  await evaluate(`(() => [...document.querySelectorAll('.payment-request-cancel-confirm button')]
    .find(button => button.textContent.trim() === 'Ya, batalkan permintaan')?.click())()`);
  await waitFor("document.querySelector('.payment-request-cancel-feedback')?.textContent.includes('Permintaan dibatalkan')", "Resident cancel action did not reach success state.");
  assert.equal(requestedCancelUrls.length - cancelCountBefore, 1, "Resident cancel action must issue one request.");
  await waitFor("document.querySelectorAll('.due-status.status-pending').length === 0", "Cancelled resident request remained pending on the due card.");
  assert.equal(await evaluate<boolean>("document.querySelector('.resident-summary')?.innerText.includes('Rp 18.000')"), true);
  assert.equal(await evaluate<boolean>(`[...document.querySelectorAll('.payment-request-history-list li')]
    .some(item => item.innerText.includes('${phase7.pendingCode}') && item.innerText.includes('Dibatalkan'))`), true);
  await capturePhase7("resident-request-cancelled-390x844");

  await evaluate(`(() => {
    const select = document.querySelector('#payment-request-period');
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setValue.call(select, '2026-08');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.payment-request-action') && !document.querySelector('.payment-request-action').disabled", "Cancelled month could not be selected for a new request.");
  await evaluate(`document.querySelector('.payment-request-action').click()`);
  await waitFor("[...document.querySelectorAll('.payment-request-confirm-actions button')].some(button => button.textContent.includes('Konfirmasi dan ajukan'))", "New resident request confirmation did not render.");
  await evaluate(`([...document.querySelectorAll('.payment-request-confirm-actions button')].find(button => button.textContent.includes('Konfirmasi dan ajukan'))).click()`);
  await waitFor("document.querySelector('.payment-request-success')?.innerText.includes('Nomor pengajuan')", "Resident re-request after cancellation did not succeed in the browser.");
  const uiRequestCode = await evaluate<string>(`document.querySelector('.payment-request-success')?.innerText.match(/KRT-[A-F0-9]{16}/)?.[0] ?? ''`);
  assert.match(uiRequestCode, /^KRT-[A-F0-9]{16}$/);
  assert.notEqual(uiRequestCode, phase7.pendingCode);
  assert.notEqual(uiRequestCode, phase7.cancelledCode);
  assert.notEqual(uiRequestCode, phase7.rejectedCode);

  for (const { name, value } of cookiePairs(phase7.treasurerCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  const uiRejectReason = "Bukti transfer belum terbaca.";
  await navigate(`${baseUrl}/app/bendahara/${uiRequestCode}`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser Treasurer reject form at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.treasurer-reject-form textarea') !== null", "Treasurer reject form did not render in the browser.");
    const form = await evaluate<{ required: boolean; disabled: boolean; verify: boolean; overflow: boolean }>(`(() => ({
      required: document.querySelector('.treasurer-reject-form textarea').required,
      disabled: document.querySelector('.treasurer-reject-button').disabled,
      verify: Boolean(document.querySelector('.treasurer-confirm-button')),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))()`);
    assert.equal(form.required, true);
    assert.equal(form.disabled, true, "Reject control must remain disabled until a reason is entered.");
    assert.equal(form.verify, true);
    assert.equal(form.overflow, false, `Treasurer reject form has horizontal overflow at ${viewport.width}px.`);
    if (viewport.width === 390) await capturePhase7("treasurer-reject-required-390x844");
  }
  await setViewport({ width: 390, height: 844 });
  await evaluate("document.querySelector('.treasurer-reject-form textarea').focus()");
  await command("Input.insertText", { text: uiRejectReason });
  await waitFor("!document.querySelector('.treasurer-reject-button').disabled", "Treasurer reject reason was not accepted by the browser form.");
  const rejectCountBefore = requestedRejectUrls.length;
  await evaluate("document.querySelector('.treasurer-reject-button').click()");
  await waitFor("document.body.innerText.includes('Permintaan ditolak. Bulan iuran kembali Belum bayar dan dapat diajukan lagi.')", "Treasurer reject form did not reach its success state.");
  await waitFor("document.querySelector('.treasurer-status--done') && document.body.innerText.includes('Ditolak')", "Rejected status did not refresh in the browser detail.");
  assert.equal(requestedRejectUrls.length - rejectCountBefore, 1, "Treasurer reject action must issue one request.");
  assert.equal(await evaluate<boolean>(`document.body.innerText.includes('${uiRejectReason}') &&
    !document.querySelector('.treasurer-confirm-button') && !document.querySelector('.treasurer-reject-form')`), true);
  await capturePhase7("treasurer-request-rejected-390x844");
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser rejected Treasurer detail at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.treasurer-status--done') !== null", "Rejected processed state did not render at every viewport.");
    const detail = await evaluate<{ reason: boolean; noActions: boolean; overflow: boolean; forbiddenDate: boolean; uuid: boolean }>(`(() => {
      const text = document.body.innerText;
      return {
        reason: text.includes('${uiRejectReason}'),
        noActions: !document.querySelector('.treasurer-confirm-button') && !document.querySelector('.treasurer-reject-form'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        forbiddenDate: /\b10 (Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\b/i.test(text),
        uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text),
      };
    })()`);
    assert.equal(detail.reason, true);
    assert.equal(detail.noActions, true);
    assert.equal(detail.overflow, false, `Rejected detail has horizontal overflow at ${viewport.width}px.`);
    assert.equal(detail.forbiddenDate, false);
    assert.equal(detail.uuid, false);
  }
  for (const { name, value } of cookiePairs(phase7.residentCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await navigate(`${baseUrl}/app`, browserViewports[0]!);
  for (const viewport of browserViewports) {
    currentSmokeStage = `browser resident rejected history at ${viewport.width}px`;
    await setViewport(viewport);
    await waitFor("document.querySelector('.payment-request-history') && document.body.innerText.includes('Ditolak')", "Resident did not see the rejected request after a browser rejection.");
    const residentFinal = await evaluate<{ latestRequest: boolean; reason: boolean; noPending: boolean; unpaid: boolean; cancelButton: boolean; overflow: boolean }>(`(() => {
      const text = document.body.innerText;
      const latest = [...document.querySelectorAll('.payment-request-history-list li')][0];
      return {
        latestRequest: Boolean(latest?.innerText.includes('${uiRequestCode}') && latest.innerText.includes('Ditolak')),
        reason: Boolean(latest?.innerText.includes('${uiRejectReason}')),
        noPending: document.querySelectorAll('.due-status.status-pending').length === 0,
        unpaid: document.querySelector('.resident-summary')?.innerText.includes('Rp 18.000') ?? false,
        cancelButton: [...document.querySelectorAll('.payment-request-history-list button')].some(button => button.textContent.trim() === 'Batalkan permintaan'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`);
    assert.equal(residentFinal.latestRequest, true);
    assert.equal(residentFinal.reason, true);
    assert.equal(residentFinal.noPending, true);
    assert.equal(residentFinal.unpaid, true);
    assert.equal(residentFinal.cancelButton, false);
    assert.equal(residentFinal.overflow, false, `Resident rejected history has horizontal overflow at ${viewport.width}px.`);
    if (viewport.width === 390) await capturePhase7("resident-request-rejected-history-390x844");
  }
  assert.deepEqual(pageErrors, [], "Browser page and console errors must remain clear.");
  devtoolsSocket.close();
  devtoolsSocket = undefined;
  return {
    verifyStatuses: concurrentResponses.map((response) => response.status),
    phase7RejectedRequestCode: uiRequestCode,
  };
}

async function main() {
  loadEnvConfig(root);
  const { baseUrl, databaseHost } = assertDevelopmentTarget();
  currentSmokeStage = "starting local Next server";
  await startNext(baseUrl);
  const db = getDb();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const residentName = `Phase 6 smoke resident ${suffix}`;
  const residentHouseNumber = `P6-${suffix}`;
  const residentPin = String(randomInt(100000, 1000000));
  const [unit] = await db.insert(rtUnits).values({
    code: `P6-${suffix}`,
    rwCode: `P6-${suffix}`,
    name: `Phase 6 synthetic unit ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  const rtUnitId = unit!.id;
  await db.insert(rtSettings).values({ rtUnitId });

  const primaryResident = await createPerson(db, rtUnitId, {
    houseNumber: residentHouseNumber,
    name: residentName,
    loginIdentifier: residentHouseNumber,
    accountType: "resident",
  });
  await db.insert(authAccount).values({
    id: randomUUID(),
    accountId: primaryResident.userId,
    providerId: "credential",
    userId: primaryResident.userId,
    password: await hashPassword(residentPin),
  });

  const treasurerPassword = randomBytes(16).toString("base64url");
  const treasurerIdentifier = `p6-treasurer-${suffix.toLowerCase()}`;
  const treasurer = await createPerson(db, rtUnitId, {
    houseNumber: `P6B-${suffix}`,
    name: `Phase 6 smoke Treasurer ${suffix}`,
    loginIdentifier: treasurerIdentifier,
    accountType: "official",
    phone: "08123456789",
  });
  await db.insert(authAccount).values({
    id: randomUUID(),
    accountId: treasurer.userId,
    providerId: "credential",
    userId: treasurer.userId,
    password: await hashPassword(treasurerPassword),
  });
  await db.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: treasurer.accountId,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const [billingYear] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
    .returning({ id: billingYears.id });
  const [feeRate] = await db.insert(feeRates).values({
    rtUnitId,
    billingYearId: billingYear!.id,
    effectiveMonth: 1,
    monthlyAmount: 18000,
  }).returning({ id: feeRates.id });
  await db.insert(monthlyDues).values([4, 5, 6].map((month) => ({
    rtUnitId,
    householdId: primaryResident.householdId,
    billingYearId: billingYear!.id,
    feeRateId: feeRate!.id,
    month,
    amount: 18000,
    dueDate: `2026-${String(month).padStart(2, "0")}-10`,
    status: "unpaid" as const,
  })));

  currentSmokeStage = "signing in Gate B resident";
  const residentCookie = await signIn(baseUrl, "resident", residentHouseNumber, residentPin);
  const initialDues = await fetch(`${baseUrl}/api/resident/monthly-dues`, { headers: { cookie: residentCookie }, cache: "no-store" });
  assert.equal(initialDues.status, 200);
  const before = await initialDues.json() as { dues: Array<{ month: number; status: string; paymentRequestStatus: string | null }> };
  assert.deepEqual(before.dues.map(({ month, status, paymentRequestStatus }) => ({ month, status, paymentRequestStatus })), [
    { month: 4, status: "unpaid", paymentRequestStatus: null },
    { month: 5, status: "unpaid", paymentRequestStatus: null },
    { month: 6, status: "unpaid", paymentRequestStatus: null },
  ]);

  const primaryRequestResponse = await fetch(`${baseUrl}/api/resident/payment-requests`, {
    method: "POST",
    headers: {
      cookie: residentCookie,
      origin: baseUrl,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ period: "2026-06" }),
  });
  assert.equal(primaryRequestResponse.status, 200, "The real resident request route should create a request.");
  const primaryRequest = await primaryRequestResponse.json() as {
    requestCode: string;
    status: string;
    periods: string[];
    totalAmount: number;
    whatsappUrl: string | null;
  };
  assert.equal(primaryRequest.status, "pending");
  assert.deepEqual(primaryRequest.periods, ["2026-04", "2026-05", "2026-06"]);
  assert.equal(primaryRequest.totalAmount, 54000);
  assert.match(primaryRequest.whatsappUrl ?? "", /^https:\/\/wa\.me\/628123456789\?text=/);
  const whatsappText = decodeURIComponent(new URL(primaryRequest.whatsappUrl!).searchParams.get("text") ?? "");
  assert.ok(whatsappText.includes(primaryRequest.requestCode));

  await delay(60);
  const secondResident = await createPerson(db, rtUnitId, {
    houseNumber: `P6C-${suffix}`,
    name: `Phase 6 queue resident ${suffix}`,
    loginIdentifier: `p6-queue-${suffix.toLowerCase()}`,
    accountType: "resident",
  });
  await db.insert(monthlyDues).values({
    rtUnitId,
    householdId: secondResident.householdId,
    billingYearId: billingYear!.id,
    feeRateId: feeRate!.id,
    month: 7,
    amount: 18000,
    dueDate: "2026-07-10",
    status: "unpaid",
  });
  const secondResidentPrincipal: Principal = {
    authUserId: secondResident.userId,
    appAccountId: secondResident.accountId,
    role: "resident",
    rtUnitId,
    householdId: secondResident.householdId,
    personId: secondResident.personId,
  };
  const secondRequest = await createResidentPaymentRequest(db, secondResidentPrincipal, {
    period: "2026-07",
    idempotencyKey: randomUUID(),
  });

  const phase7Password = String(randomInt(100000, 1000000));
  const phase7HouseNumber = `P7-${suffix}`;
  const phase7Resident = await createPerson(db, rtUnitId, {
    houseNumber: phase7HouseNumber,
    name: `Phase 7 smoke resident ${suffix}`,
    loginIdentifier: phase7HouseNumber,
    accountType: "resident",
  });
  await db.insert(authAccount).values({
    id: randomUUID(),
    accountId: phase7Resident.userId,
    providerId: "credential",
    userId: phase7Resident.userId,
    password: await hashPassword(phase7Password),
  });
  await db.insert(monthlyDues).values({
    rtUnitId,
    householdId: phase7Resident.householdId,
    billingYearId: billingYear!.id,
    feeRateId: feeRate!.id,
    month: 8,
    amount: 18000,
    dueDate: "2026-08-10",
    status: "unpaid",
  });
  currentSmokeStage = "signing in Phase 7 resident";
  const phase7ResidentCookie = await signIn(baseUrl, "resident", phase7HouseNumber, phase7Password);

  currentSmokeStage = "signing in Treasurer sessions";
  const treasurerCookie = await signIn(baseUrl, "official", treasurerIdentifier, treasurerPassword);
  const secondTreasurerCookie = await signIn(baseUrl, "official", treasurerIdentifier, treasurerPassword);
  const queueResponse = await fetch(`${baseUrl}/api/treasurer/payment-requests`, {
    headers: { cookie: treasurerCookie },
    cache: "no-store",
  });
  assert.equal(queueResponse.status, 200, "The active Treasurer session should read the pending queue.");
  const queue = await queueResponse.json() as { pendingCount: number; requests: Array<{ requestCode: string; items: Array<{ period: string; amount: number }>; totalAmount: number }> };
  assert.equal(queue.pendingCount, 2);
  assert.deepEqual(queue.requests.map((request) => request.requestCode), [primaryRequest.requestCode, secondRequest.requestCode]);
  assert.deepEqual(queue.requests[0]?.items.map((item) => item.period), primaryRequest.periods);
  assert.equal(queue.requests[0]?.totalAmount, primaryRequest.totalAmount);
  assert.equal("id" in queue.requests[0]!, false);
  assert.equal("rtUnitId" in queue.requests[0]!, false);

  const detailResponse = await fetch(`${baseUrl}/api/treasurer/payment-requests/${primaryRequest.requestCode}`, {
    headers: { cookie: treasurerCookie },
    cache: "no-store",
  });
  assert.equal(detailResponse.status, 200);
  const detailBody = await detailResponse.json() as { request: { requestCode: string; items: Array<{ period: string; amount: number }>; totalAmount: number } };
  assert.equal(detailBody.request.requestCode, primaryRequest.requestCode);
  assert.deepEqual(detailBody.request.items, [
    { period: "2026-04", amount: 18000 },
    { period: "2026-05", amount: 18000 },
    { period: "2026-06", amount: 18000 },
  ]);
  assert.equal(detailBody.request.totalAmount, 54000);
  assert.equal("id" in detailBody.request, false);

  const residentQueueRefusal = await fetch(`${baseUrl}/api/treasurer/payment-requests`, {
    headers: { cookie: residentCookie },
    cache: "no-store",
  });
  assert.equal(residentQueueRefusal.status, 403);
  const residentVerifyRefusal = await fetch(`${baseUrl}/api/treasurer/payment-requests/${primaryRequest.requestCode}/verify`, {
    method: "POST",
    headers: { cookie: residentCookie, origin: baseUrl, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(residentVerifyRefusal.status, 403);
  const crossOriginVerifyRefusal = await fetch(`${baseUrl}/api/treasurer/payment-requests/${primaryRequest.requestCode}/verify`, {
    method: "POST",
    headers: { cookie: treasurerCookie, origin: "https://example.invalid", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(crossOriginVerifyRefusal.status, 403);
  const massAssignmentRefusal = await fetch(`${baseUrl}/api/treasurer/payment-requests/${primaryRequest.requestCode}/verify`, {
    method: "POST",
    headers: { cookie: treasurerCookie, origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ amount: 1, periods: ["2026-06"], rtUnitId }),
  });
  assert.equal(massAssignmentRefusal.status, 400);

  currentSmokeStage = "Phase 7 cancel and reject HTTP flows";
  const initialPhase7Request = await createRequestOverHttp(baseUrl, phase7ResidentCookie, "2026-08");
  assert.deepEqual(initialPhase7Request.periods, ["2026-08"]);
  assert.equal(initialPhase7Request.totalAmount, 18000);
  const initialHistoryResponse = await fetch(`${baseUrl}/api/resident/payment-requests`, {
    headers: { cookie: phase7ResidentCookie },
    cache: "no-store",
  });
  assert.equal(initialHistoryResponse.status, 200);
  const initialHistory = await initialHistoryResponse.json() as {
    requests: Array<{ requestCode: string; status: string; createdAt: string; resolvedAt: string | null; items: Array<{ period: string; amount: number }>; totalAmount: number; resolutionReason: string | null }>;
    nextCursor: string | null;
  };
  assert.equal(initialHistory.requests.length, 1);
  assert.deepEqual(Object.keys(initialHistory.requests[0]!).sort(), [
    "createdAt", "items", "requestCode", "resolutionReason", "resolvedAt", "status", "totalAmount",
  ]);
  assert.deepEqual(Object.keys(initialHistory.requests[0]!.items[0]!).sort(), ["amount", "period"]);
  assert.equal(initialHistory.requests[0]!.requestCode, initialPhase7Request.requestCode);
  assert.equal(initialHistory.requests[0]!.status, "pending");
  assert.doesNotMatch(JSON.stringify(initialHistory), /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);

  const initialCancelUrl = `${baseUrl}/api/resident/payment-requests/${initialPhase7Request.requestCode}/cancel`;
  assert.equal((await postJson(initialCancelUrl, undefined, baseUrl, {})).status, 401, "Unauthenticated residents must not cancel requests.");
  assert.equal((await postJson(initialCancelUrl, residentCookie, baseUrl, {})).status, 404, "Another resident must not learn that a request exists.");
  assert.equal((await postJson(initialCancelUrl, treasurerCookie, baseUrl, {})).status, 403, "Treasurer must not use resident cancellation.");
  assert.equal((await postJson(initialCancelUrl, phase7ResidentCookie, "https://example.invalid", {})).status, 403);
  assert.equal((await postJson(initialCancelUrl, phase7ResidentCookie, baseUrl, { reason: "mass assignment" })).status, 400);
  const initialCancelResponse = await postJson(initialCancelUrl, phase7ResidentCookie, baseUrl, {});
  assert.equal(initialCancelResponse.status, 200);
  assert.equal((await initialCancelResponse.json() as { status: string }).status, "cancelled");
  const cancelledArtifacts = await readRequestArtifacts(db, initialPhase7Request.requestCode);
  assertNoPaymentResolution(cancelledArtifacts, "cancelled", "payment_request.cancelled", null);
  const duplicateCancel = await postJson(initialCancelUrl, phase7ResidentCookie, baseUrl, {});
  assert.equal(duplicateCancel.status, 409);
  assert.equal((await duplicateCancel.json() as { code?: string }).code, "already_processed");
  const cancelledDuesResponse = await fetch(`${baseUrl}/api/resident/monthly-dues`, {
    headers: { cookie: phase7ResidentCookie },
    cache: "no-store",
  });
  assert.equal(cancelledDuesResponse.status, 200);
  const cancelledDues = await cancelledDuesResponse.json() as { dues: Array<{ month: number; status: string; paymentRequestStatus: string | null }> };
  assert.deepEqual(cancelledDues.dues.filter((due) => due.month === 8).map(({ status, paymentRequestStatus }) => ({ status, paymentRequestStatus })), [
    { status: "unpaid", paymentRequestStatus: null },
  ]);

  const phase7RequestAfterCancel = await createRequestOverHttp(baseUrl, phase7ResidentCookie, "2026-08");
  assert.notEqual(phase7RequestAfterCancel.requestCode, initialPhase7Request.requestCode);
  const secondCancelUrl = `${baseUrl}/api/resident/payment-requests/${phase7RequestAfterCancel.requestCode}/cancel`;
  const rejectUrl = `${baseUrl}/api/treasurer/payment-requests/${phase7RequestAfterCancel.requestCode}/reject`;
  const rejectReason = "Bukti transfer belum terbaca.";
  assert.equal((await postJson(rejectUrl, undefined, baseUrl, { reason: rejectReason })).status, 401);
  assert.equal((await postJson(rejectUrl, phase7ResidentCookie, baseUrl, { reason: rejectReason })).status, 403);
  assert.equal((await postJson(rejectUrl, residentCookie, baseUrl, { reason: rejectReason })).status, 403);
  assert.equal((await postJson(rejectUrl, treasurerCookie, "https://example.invalid", { reason: rejectReason })).status, 403);
  assert.equal((await postJson(rejectUrl, treasurerCookie, baseUrl, { reason: "   " })).status, 400);
  assert.equal((await postJson(rejectUrl, treasurerCookie, baseUrl, { reason: "x".repeat(501) })).status, 400);
  assert.equal((await postJson(rejectUrl, treasurerCookie, baseUrl, { reason: rejectReason, actorId: treasurer.accountId, rtUnitId })).status, 400);
  const treasurerCancelRefusal = await postJson(secondCancelUrl, treasurerCookie, baseUrl, {});
  assert.equal(treasurerCancelRefusal.status, 403);
  const crossOriginRejectRefusal = await postJson(rejectUrl, treasurerCookie, "https://example.invalid", { reason: rejectReason });
  assert.equal(crossOriginRejectRefusal.status, 403);
  const rejectionResponse = await postJson(rejectUrl, treasurerCookie, baseUrl, { reason: rejectReason });
  assert.equal(rejectionResponse.status, 200);
  assert.equal((await rejectionResponse.json() as { status: string }).status, "rejected");
  const rejectedArtifacts = await readRequestArtifacts(db, phase7RequestAfterCancel.requestCode);
  assertNoPaymentResolution(rejectedArtifacts, "rejected", "payment_request.rejected", rejectReason);

  const phase7RequestAfterReject = await createRequestOverHttp(baseUrl, phase7ResidentCookie, "2026-08");
  assert.notEqual(phase7RequestAfterReject.requestCode, phase7RequestAfterCancel.requestCode);
  assert.notEqual(phase7RequestAfterReject.requestCode, initialPhase7Request.requestCode);
  const finalPhase7HistoryResponse = await fetch(`${baseUrl}/api/resident/payment-requests`, {
    headers: { cookie: phase7ResidentCookie },
    cache: "no-store",
  });
  assert.equal(finalPhase7HistoryResponse.status, 200);
  const finalPhase7History = await finalPhase7HistoryResponse.json() as {
    requests: Array<{ requestCode: string; status: string; resolutionReason: string | null }>;
  };
  assert.deepEqual(finalPhase7History.requests.map(({ status }) => status), ["pending", "rejected", "cancelled"]);
  assert.equal(finalPhase7History.requests[0]!.requestCode, phase7RequestAfterReject.requestCode);
  assert.equal(finalPhase7History.requests[1]!.requestCode, phase7RequestAfterCancel.requestCode);
  assert.equal(finalPhase7History.requests[1]!.resolutionReason, rejectReason);
  assert.equal(finalPhase7History.requests[2]!.requestCode, initialPhase7Request.requestCode);
  const otherResidentHistoryResponse = await fetch(`${baseUrl}/api/resident/payment-requests`, {
    headers: { cookie: residentCookie },
    cache: "no-store",
  });
  assert.equal(otherResidentHistoryResponse.status, 200);
  const otherResidentHistory = await otherResidentHistoryResponse.json() as { requests: Array<{ requestCode: string }> };
  const phase7RequestCodes = new Set([
    initialPhase7Request.requestCode,
    phase7RequestAfterCancel.requestCode,
    phase7RequestAfterReject.requestCode,
  ]);
  assert.equal(otherResidentHistory.requests.some(({ requestCode }) => phase7RequestCodes.has(requestCode)), false);

  const racePassword = String(randomInt(100000, 1000000));
  const createRaceFixture = async (label: string, month: number) => {
    const houseNumber = `${label}-${suffix}`;
    const resident = await createPerson(db, rtUnitId, {
      houseNumber,
      name: `Phase 7 ${label} race resident ${suffix}`,
      loginIdentifier: houseNumber,
      accountType: "resident",
    });
    await db.insert(authAccount).values({
      id: randomUUID(),
      accountId: resident.userId,
      providerId: "credential",
      userId: resident.userId,
      password: await hashPassword(racePassword),
    });
    await db.insert(monthlyDues).values({
      rtUnitId,
      householdId: resident.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: 18000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid",
    });
    const cookie = await signIn(baseUrl, "resident", houseNumber, racePassword);
    const request = await createRequestOverHttp(baseUrl, cookie, `2026-${String(month).padStart(2, "0")}`);
    return { cookie, request };
  };

  currentSmokeStage = "Phase 7 HTTP concurrency races";
  const raceCases = [
    { name: "cancel-vs-verify", fixture: await createRaceFixture("P7A", 8), rejectReason: "Race cancellation review reason." },
    { name: "reject-vs-verify", fixture: await createRaceFixture("P7B", 9), rejectReason: "Race rejection review reason." },
    { name: "cancel-vs-reject", fixture: await createRaceFixture("P7C", 10), rejectReason: "Race terminal review reason." },
  ];
  const concurrencyResults: Array<{ name: string; requestCode: string; winnerAction: string; finalStatus: string; statuses: number[] }> = [];
  const runRace = async (
    name: string,
    fixture: (typeof raceCases)[number]["fixture"],
    rejectReasonForRace: string,
    operations: Array<{ action: "payment_request.verified" | "payment_request.rejected" | "payment_request.cancelled"; url: string; cookie: string; body: unknown }>,
  ) => {
    const responses = await Promise.all(operations.map((operation) => postJson(operation.url, operation.cookie, baseUrl, operation.body)));
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409], `${name} must serialize to one winner and one already-processed loser.`);
    const loserIndex = responses.findIndex((response) => response.status === 409);
    const loserBody = await responses[loserIndex]!.json() as { code?: string };
    assert.equal(loserBody.code, "already_processed", `${name} loser must receive safe already-processed feedback.`);
    const winnerIndex = responses.findIndex((response) => response.status === 200);
    const winnerBody = await responses[winnerIndex]!.json() as { status?: string };
    const winningAction = operations[winnerIndex]!.action;
    const expectedStatus = winningAction === "payment_request.verified"
      ? "verified"
      : winningAction === "payment_request.rejected"
        ? "rejected"
        : "cancelled";
    assert.equal(winnerBody.status, expectedStatus);
    const finalStatus = await assertRaceWinner(db, fixture.request.requestCode, winningAction, rejectReasonForRace);
    assert.equal(finalStatus, expectedStatus);
    concurrencyResults.push({
      name,
      requestCode: fixture.request.requestCode,
      winnerAction: winningAction,
      finalStatus,
      statuses,
    });
  };

  await runRace("cancel-vs-verify", raceCases[0]!.fixture, raceCases[0]!.rejectReason, [
    { action: "payment_request.cancelled", url: `${baseUrl}/api/resident/payment-requests/${raceCases[0]!.fixture.request.requestCode}/cancel`, cookie: raceCases[0]!.fixture.cookie, body: {} },
    { action: "payment_request.verified", url: `${baseUrl}/api/treasurer/payment-requests/${raceCases[0]!.fixture.request.requestCode}/verify`, cookie: treasurerCookie, body: {} },
  ]);
  await runRace("reject-vs-verify", raceCases[1]!.fixture, raceCases[1]!.rejectReason, [
    { action: "payment_request.rejected", url: `${baseUrl}/api/treasurer/payment-requests/${raceCases[1]!.fixture.request.requestCode}/reject`, cookie: treasurerCookie, body: { reason: raceCases[1]!.rejectReason } },
    { action: "payment_request.verified", url: `${baseUrl}/api/treasurer/payment-requests/${raceCases[1]!.fixture.request.requestCode}/verify`, cookie: secondTreasurerCookie, body: {} },
  ]);
  await runRace("cancel-vs-reject", raceCases[2]!.fixture, raceCases[2]!.rejectReason, [
    { action: "payment_request.cancelled", url: `${baseUrl}/api/resident/payment-requests/${raceCases[2]!.fixture.request.requestCode}/cancel`, cookie: raceCases[2]!.fixture.cookie, body: {} },
    { action: "payment_request.rejected", url: `${baseUrl}/api/treasurer/payment-requests/${raceCases[2]!.fixture.request.requestCode}/reject`, cookie: treasurerCookie, body: { reason: raceCases[2]!.rejectReason } },
  ]);

  currentSmokeStage = "browser viewport and UI smoke";
  const browserSmoke = await runBrowserSmoke(
    baseUrl,
    treasurerCookie,
    secondTreasurerCookie,
    residentCookie,
    primaryRequest.requestCode,
    secondRequest.requestCode,
    {
      residentCookie: phase7ResidentCookie,
      treasurerCookie,
      pendingCode: phase7RequestAfterReject.requestCode,
      cancelledCode: initialPhase7Request.requestCode,
      rejectedCode: phase7RequestAfterCancel.requestCode,
    },
  );
  assert.deepEqual(browserSmoke.verifyStatuses.sort(), [200, 409]);
  const browserRejectedArtifacts = await readRequestArtifacts(db, browserSmoke.phase7RejectedRequestCode);
  assertNoPaymentResolution(browserRejectedArtifacts, "rejected", "payment_request.rejected", "Bukti transfer belum terbaca.");

  const refreshedResponse = await fetch(`${baseUrl}/api/resident/monthly-dues`, {
    headers: { cookie: residentCookie },
    cache: "no-store",
  });
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json() as { dues: Array<{ billingYear: number; month: number; amount: number; dueDate: string; status: "paid" | "unpaid" | "waived" | "not_due"; paymentRequestStatus: "pending" | null }> };
  const primaryDues = refreshed.dues.filter((due) => [4, 5, 6].includes(due.month));
  assert.equal(primaryDues.length, 3);
  assert.ok(primaryDues.every((due) => due.status === "paid" && due.paymentRequestStatus === null));
  assert.equal(duesSummary(primaryDues).paid, 54000);
  assert.ok(primaryDues.every((due) => residentStatusLabels[dueToken(due)] === "Sudah bayar"));

  const [requestRow] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, primaryRequest.requestCode));
  const requestItems = await db.select().from(paymentRequestItems)
    .where(eq(paymentRequestItems.requestId, requestRow!.id));
  const paymentRows = await db.select().from(payments)
    .where(eq(payments.paymentRequestId, requestRow!.id));
  const allocations = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentRequestId, requestRow!.id));
  const claims = await db.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.requestId, requestRow!.id));
  const auditRows = await db.select().from(auditEvents)
    .where(and(
      eq(auditEvents.action, "payment_request.verified"),
      eq(auditEvents.entityId, requestRow!.id),
    ));
  const dueRows = await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, requestItems.map((item) => item.monthlyDueId)));
  assert.equal(requestRow!.status, "verified");
  assert.equal(requestRow!.itemCount, 3);
  assert.equal(requestRow!.totalAmount, 54000);
  assert.equal(paymentRows.length, 1);
  assert.equal(paymentRows[0]!.amount, 54000);
  assert.equal(allocations.length, 3);
  assert.equal(allocations.reduce((sum, allocation) => sum + allocation.amount, 0), 54000);
  assert.equal(claims.length, 0);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]!.actorAppAccountId, treasurer.accountId);
  assert.equal(requestItems.length, 3, "Verified request item history must remain intact.");
  assert.ok(dueRows.every((due) => due.status === "paid"));

  const secondaryRequestRow = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, secondRequest.requestCode));
  assert.equal(secondaryRequestRow.length, 1);
  const secondaryPayments = await db.select().from(payments)
    .where(eq(payments.paymentRequestId, secondaryRequestRow[0]!.id));
  const secondaryAllocations = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentRequestId, secondaryRequestRow[0]!.id));
  const secondaryClaims = await db.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.requestId, secondaryRequestRow[0]!.id));
  const secondaryAudit = await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment_request.verified"),
    eq(auditEvents.entityId, secondaryRequestRow[0]!.id),
  ));
  assert.equal(secondaryPayments.length, 1, "The browser double-click must not create a duplicate payment.");
  assert.equal(secondaryAllocations.length, 1);
  assert.equal(secondaryClaims.length, 0);
  assert.equal(secondaryAudit.length, 1);

  console.info(JSON.stringify({
    event: "phase_7.real_http_browser_and_gate_b_smoke",
    environment: "development",
    projectId: target.projectId,
    branchName: "karturt-development",
    branchId: target.branchId,
    endpointId: target.endpointId,
    databaseHost,
    migrationHead: "0007_phase_7_reject_cancel",
    authentication: "Normal Better Auth resident and active same-RT Treasurer sessions; no bypass sessions.",
    realHttp: "Gate B resident request -> WhatsApp -> Treasurer verify; Phase 7 resident request -> cancel -> same-period re-request -> reject -> re-request; pairwise HTTP races.",
    requestSnapshot: { itemCount: requestItems.length, totalAmount: requestRow!.totalAmount },
    gateBVerifyRace: browserSmoke.verifyStatuses,
    phase7: {
      cancelledRequest: { status: cancelledArtifacts.request.status, claims: cancelledArtifacts.claims.length, payments: cancelledArtifacts.payments.length, allocations: cancelledArtifacts.allocations.length, audits: cancelledArtifacts.audits.length },
      rejectedRequest: { status: rejectedArtifacts.request.status, reasonRecorded: rejectedArtifacts.audits[0]?.reason === rejectReason, claims: rejectedArtifacts.claims.length, payments: rejectedArtifacts.payments.length, allocations: rejectedArtifacts.allocations.length, audits: rejectedArtifacts.audits.length },
      reRequestAfterBoth: { distinctCodes: new Set([initialPhase7Request.requestCode, phase7RequestAfterCancel.requestCode, phase7RequestAfterReject.requestCode]).size === 3, finalBrowserRequestRejected: browserRejectedArtifacts.request.status === "rejected" },
      pairwiseRaces: concurrencyResults,
    },
    ledger: { payments: paymentRows.length, allocations: allocations.length, claimsRemaining: claims.length, verifiedAuditEvents: auditRows.length, dueStatusesPaid: dueRows.every((due) => due.status === "paid") },
    residentStatus: { summary: "Sudah bayar", paidMonths: primaryDues.length, pendingMonths: primaryDues.filter((due) => due.paymentRequestStatus === "pending").length },
    browser: { actualNextRoutesAndNeonDevelopment: true, viewports: browserViewports, doubleClickVerifyRequests: 1, cancelAndReRequestVerified: true, requiredReasonAndProcessedStateVerified: true, evidenceDirectories: ["docs/phase-6-evidence", "docs/phase-7-evidence"] },
    syntheticFinancialFixtures: "Retained on development to preserve payment and audit history; only smoke authentication sessions are removed.",
  }));
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), delay(2000)]);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected Phase 6 smoke failure.";
    console.error(`Phase 7 development smoke failed during ${currentSmokeStage}: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    devtoolsSocket?.close();
    await stopChild(chromeProcess);
    await stopChild(nextProcess);
    if (userIds.length) {
      try {
        await getDb().delete(authSession).where(inArray(authSession.userId, userIds));
      } catch {
        // Keep synthetic domain and financial fixtures; only remove temporary login sessions.
      }
    }
    await closeDb();
    if (browserProfile) {
      const tempRoot = resolve(tmpdir());
      const resolvedProfile = resolve(browserProfile);
      if (resolvedProfile.startsWith(`${tempRoot}${sep}`) && resolvedProfile.includes("karturt-phase-6-chrome-")) {
        rmSync(resolvedProfile, { recursive: true, force: true });
      }
    }
  });
