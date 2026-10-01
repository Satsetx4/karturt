import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  activeDueSettlements,
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
  paymentReversals,
  paymentRequestClaims,
  paymentRequests,
  payments,
  people,
  rtSettings,
  rtUnits,
} from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
  databaseName: "neondb",
};
const root = process.cwd();
const expectedPort = 3200;
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
  houseNumber: string;
  identifier: string;
  password: string;
};

function assertDevelopmentTarget() {
  const env = requireDatabaseEnvironment();
  if (env.appEnv !== "development" || env.databaseEnv !== "development") {
    throw new Error("Phase 9 smoke requires APP_ENV and DATABASE_ENV to both be development.");
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
  if (!appUrl) throw new Error("The local browser smoke URL is required.");
  const parsedAppUrl = new URL(appUrl);
  if (parsedAppUrl.hostname !== "127.0.0.1" || Number(parsedAppUrl.port) !== expectedPort) {
    throw new Error(`The HTTP smoke must use http://127.0.0.1:${expectedPort}.`);
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
  if (!browser) throw new Error("Chrome or Edge was not found for the real-browser smoke.");
  return browser;
}

async function startNext(baseUrl: string) {
  const appUrl = new URL(baseUrl);
  nextProcess = spawn(process.execPath, [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(expectedPort),
  ], {
    cwd: root,
      // Keep the optimized local smoke server on the test label while it
      // connects to the development Neon URL validated by this parent process.
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_ENV: "test",
        DATABASE_ENV: "test",
        NEXT_PUBLIC_APP_URL: appUrl.origin,
      },
    stdio: "ignore",
    windowsHide: true,
  });
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
  options: { houseNumber: string; accountType: "resident" | "official"; name: string },
): Promise<FixturePerson> {
  const [house] = await db.insert(houses).values({ rtUnitId, number: options.houseNumber })
    .returning({ id: houses.id });
  const [household] = await db.insert(households).values({
    rtUnitId,
    houseId: house!.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [person] = await db.insert(people).values({
    rtUnitId,
    householdId: household!.id,
    fullName: options.name,
  }).returning({ id: people.id });
  const userId = randomUUID();
  const identifier = options.accountType === "official"
    ? `p8-treasurer-${randomUUID().slice(0, 8)}`
    : options.houseNumber;
  const password = options.accountType === "official"
    ? randomBytes(18).toString("base64url")
    : String(randomInt(100000, 1000000));
  await db.insert(authUser).values({
    id: userId,
    name: options.name,
    email: `${randomUUID()}@example.invalid`,
    emailVerified: true,
  });
  const [account] = await db.insert(appAccounts).values({
    rtUnitId,
    authUserId: userId,
    accountType: options.accountType,
    loginIdentifier: identifier,
    personId: person!.id,
    householdId: options.accountType === "resident" ? household!.id : null,
  }).returning({ id: appAccounts.id });
  await db.insert(authAccount).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  });
  userIds.push(userId);
  return {
    accountId: account!.id,
    userId,
    householdId: household!.id,
    personId: person!.id,
    houseNumber: options.houseNumber,
    identifier,
    password,
  };
}

async function signIn(baseUrl: string, type: "resident" | "official", person: FixturePerson) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${baseUrl}/api/login/${type}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ identifier: person.identifier, password: person.password }),
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
  assert.equal(response.status, 200, `Normal ${type} sign-in must issue a session.`);
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

async function getJson<T>(url: string, cookie: string): Promise<T> {
  const response = await fetch(url, { headers: { cookie }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  assert.equal(response.status, 200, `GET ${new URL(url).pathname} must return 200: ${body.message ?? ""}`);
  return body;
}

async function postJson(url: string, cookie: string, baseUrl: string, body: unknown, idempotencyKey?: string) {
  const headers = new Headers({ "content-type": "application/json", origin: baseUrl });
  headers.set("cookie", cookie);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  if (new URL(url).pathname === "/api/resident/payment-requests" && idempotencyKey) {
    headers.set("idempotency-key", idempotencyKey);
  }
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
}

async function readPostJson<T>(response: Response): Promise<T & { message?: string; code?: string }> {
  return response.json() as Promise<T & { message?: string; code?: string }>;
}

async function addDues(
  db: ReturnType<typeof getDb>,
  rtUnitId: string,
  householdId: string,
  yearIds: Map<number, { billingYearId: string; feeRateId: string; amount: number }>,
  periods: string[],
) {
  return db.insert(monthlyDues).values(periods.map((period) => {
    const [year, month] = period.split("-").map(Number);
    const fee = yearIds.get(year!)!;
    return {
      rtUnitId,
      householdId,
      billingYearId: fee.billingYearId,
      feeRateId: fee.feeRateId,
      month: month!,
      amount: fee.amount,
      dueDate: `${period}-10`,
      status: "unpaid" as const,
    };
  })).returning({ id: monthlyDues.id });
}

async function testBrowserFlow(
  baseUrl: string,
  treasurerCookie: string,
  residentCookie: string,
  mainHouse: string,
  pendingHouse: string,
  targetPeriod: string,
  pendingPeriod: string,
) {
  const tempRoot = resolve(tmpdir());
  browserProfile = mkdtempSync(join(tempRoot, "karturt-phase-9-chrome-"));
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
  const cashPostUrls: string[] = [];
  const reversalPostUrls: string[] = [];
  const pageErrors: string[] = [];
  let commandId = 0;
  devtoolsSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown> };
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request as { url?: string; method?: string } | undefined;
      if (request?.url?.endsWith("/api/treasurer/cash-payments") && request.method === "POST") cashPostUrls.push(request.url);
      if (request?.url?.includes("/api/treasurer/payments/") && request.url.endsWith("/reverse") && request.method === "POST") {
        reversalPostUrls.push(request.url);
      }
    }
    if (message.method === "Runtime.exceptionThrown") pageErrors.push("browser runtime exception");
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry as { level?: string } | undefined;
      if (entry?.level === "error") pageErrors.push("browser console error");
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
      const timeoutMs = method === "Page.navigate" ? 120000 : 30000;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectMessage(new Error(`Chrome DevTools command timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) {
          const protocolError = message.error as { code?: number; message?: string; data?: string };
          rejectMessage(new Error(
            `Chrome DevTools command failed: ${method} (${protocolError.code ?? "unknown"}): ${protocolError.message ?? "unknown protocol error"}`,
          ));
        }
        else resolveMessage(message);
      });
    });
    devtoolsSocket!.send(JSON.stringify({ id, method, params }));
    return promise;
  };
  const evaluate = async <T,>(expression: string): Promise<T> => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const result = response.result as { result?: { value?: T }; exceptionDetails?: unknown };
    if (result?.exceptionDetails) throw new Error("Browser page evaluation failed.");
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
      mobile: viewport.width <= 430,
    });
    await command(
      "Emulation.setTouchEmulationEnabled",
      viewport.width <= 768 ? { enabled: true, maxTouchPoints: 1 } : { enabled: false },
    );
  };
  const navigate = async (url: string, viewport: { width: number; height: number }) => {
    await setViewport(viewport);
    await command("Page.navigate", { url });
    await waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, "Cash payment screen did not finish loading.");
    await delay(200);
  };
  const capture = async (name: string) => {
    const response = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    const data = (response.result as { data?: unknown } | undefined)?.data;
    assert.equal(typeof data, "string", "Chrome did not return screenshot evidence.");
    const directory = resolve(root, "docs", "phase-9-evidence");
    mkdirSync(directory, { recursive: true });
    const imagePath = join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.png`);
    writeFileSync(imagePath, Buffer.from(data as string, "base64"), { flag: "wx" });
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Log.enable");
  for (const { name, value } of cookiePairs(treasurerCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await navigate(`${baseUrl}/app/bendahara/tunai`, browserViewports[0]!);
  assert.equal(await evaluate<boolean>("document.querySelector('#cash-house-search') !== null"), true);
  await evaluate(`(() => {
    const input = document.querySelector('#cash-house-search');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(mainHouse)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(`[...document.querySelectorAll('.cash-household-option')].some(item => item.innerText.includes(${JSON.stringify(`Rumah ${mainHouse}`)}))`, "Main cash household search returned no matching house.");
  await evaluate(`([...document.querySelectorAll('.cash-household-option')].find(item => item.innerText.includes(${JSON.stringify(`Rumah ${mainHouse}`)}))).click()`);
  await waitFor("document.querySelector('#cash-target-period') !== null", "Household dues were not shown in the cash payment flow.");
  await evaluate(`(() => {
    const select = document.querySelector('#cash-target-period');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(targetPeriod)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.cash-preview') !== null", "The cash payment preview did not render.");

  const viewportEvidence: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{
      overflow: boolean;
      houseVisible: boolean;
      monthsVisible: boolean;
      totalVisible: boolean;
      rawIdentifier: boolean;
      technicalCopy: boolean;
      actionHeight: number;
    }>(`(() => {
      const text = document.body.innerText.replace(/\\s+/g, ' ');
      const action = document.querySelector('.cash-primary-button');
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        houseVisible: text.includes(${JSON.stringify(`Rumah ${mainHouse}`)}),
        monthsVisible: text.includes('April 2026') && text.includes('Mei 2026') && text.includes('Februari 2027'),
        totalVisible: text.includes('62.000'),
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
        technicalCopy: /SQLSTATE|internal server error|undefined|null/i.test(text),
        actionHeight: action ? Math.round(action.getBoundingClientRect().height) : 0,
      };
    })()`);
    assert.equal(view.overflow, false, `Cash preview has horizontal overflow at ${viewport.width}px.`);
    assert.equal(view.houseVisible, true, `Cash preview does not show the selected house at ${viewport.width}px.`);
    assert.equal(view.monthsVisible, true, `Cash preview omits older unpaid months at ${viewport.width}px.`);
    assert.equal(view.totalVisible, true, `Cash preview total is incorrect at ${viewport.width}px.`);
    assert.equal(view.rawIdentifier, false, `A raw identifier is visible at ${viewport.width}px.`);
    assert.equal(view.technicalCopy, false, `Technical error text is visible at ${viewport.width}px.`);
    assert.ok(view.actionHeight >= 44, `Cash preview action is below 44px at ${viewport.width}px.`);
    viewportEvidence.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("cash-preview-390x844");
  }

  await setViewport({ width: 390, height: 844 });
  await evaluate("document.querySelector('.cash-preview .cash-primary-button').click()");
  await waitFor("document.querySelector('.cash-confirmation') !== null", "Cash confirmation screen did not render.");
  const confirmation = await evaluate<{ method: boolean; total: boolean; house: boolean; actionHeight: number }>(`(() => {
    const text = document.querySelector('.cash-confirmation').innerText;
    const action = [...document.querySelectorAll('.cash-confirmation .cash-primary-button')]
      .find(button => button.textContent.includes('Konfirmasi pembayaran tunai'));
    return {
      method: text.includes('Tunai'),
      total: text.includes('62.000'),
      house: text.includes(${JSON.stringify(`Rumah ${mainHouse}`)}),
      actionHeight: action ? Math.round(action.getBoundingClientRect().height) : 0,
    };
  })()`);
  assert.deepEqual(confirmation, { method: true, total: true, house: true, actionHeight: confirmation.actionHeight });
  assert.ok(confirmation.actionHeight >= 44);
  await capture("cash-confirmation-390x844");
  const requestCountBefore = cashPostUrls.length;
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.cash-confirmation .cash-primary-button')]
      .find(item => item.textContent.includes('Konfirmasi pembayaran tunai'));
    button.click();
    button.click();
  })()`);
  await waitFor("document.querySelector('.cash-payment-success') !== null", "Cash payment did not reach a clear success state.");
  await delay(300);
  assert.equal(cashPostUrls.length - requestCountBefore, 1, "Cash double-click sent more than one mutation.");
  const success = await evaluate<{ paid: boolean; total: boolean; overflow: boolean }>(`(() => {
    const text = document.querySelector('.cash-payment-success').innerText;
    return {
      paid: text.includes('Pembayaran tunai tercatat'),
      total: text.includes('62.000'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
  assert.deepEqual(success, { paid: true, total: true, overflow: false });
  await capture("cash-success-390x844");

  await evaluate("document.querySelector('.cash-quiet-button').click()");
  await evaluate(`(() => {
    const input = document.querySelector('#cash-house-search');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(pendingHouse)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(`[...document.querySelectorAll('.cash-household-option')].some(item => item.innerText.includes(${JSON.stringify(`Rumah ${pendingHouse}`)}))`, "Pending-conflict household search returned no match.");
  await evaluate(`([...document.querySelectorAll('.cash-household-option')].find(item => item.innerText.includes(${JSON.stringify(`Rumah ${pendingHouse}`)}))).click()`);
  await waitFor("document.querySelector('#cash-target-period') !== null", "Pending household dues were not shown.");
  await evaluate(`(() => {
    const select = document.querySelector('#cash-target-period');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(pendingPeriod)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.cash-preview') !== null", "Pending-conflict preview did not render.");
  const pendingView = await evaluate<{ warning: boolean; blocked: boolean; overflow: boolean }>(`(() => ({
    warning: document.querySelector('.cash-pending-conflict')?.innerText.includes('masih menunggu') ?? false,
    blocked: document.querySelector('.cash-preview .cash-primary-button') === null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  assert.deepEqual(pendingView, { warning: true, blocked: true, overflow: false });
  await capture("cash-pending-conflict-390x844");

  for (const { name, value } of cookiePairs(residentCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await evaluate(`(() => { try { localStorage.setItem('karturt:resident-tab', 'card'); } catch {} })()`);
  const residentUrl = `${baseUrl}/app`;
  await navigate(residentUrl, { width: 390, height: 844 });
  await waitFor("document.querySelector('.resident-summary') !== null", "Resident card did not render after cash payment.");
  const residentCard = await evaluate<{ paidMonths: number; paidLabel: boolean; overflow: boolean }>(`(() => ({
    paidMonths: document.querySelectorAll('.due-status.status-paid').length,
    paidLabel: [...document.querySelectorAll('.due-status.status-paid')].some(item => item.innerText.includes('Sudah bayar')),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  assert.ok(residentCard.paidMonths >= 2, "Resident card did not show the cash-paid months as Sudah bayar.");
  assert.equal(residentCard.paidLabel, true);
  assert.equal(residentCard.overflow, false);
  await capture("resident-paid-card-390x844");
  await evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Riwayat'))?.click()`);
  await waitFor("document.querySelector('.dues-history') !== null", "Resident paid history did not render.");
  const residentView = await evaluate<{ paidMonths: number; overflow: boolean }>(`(() => ({
    paidMonths: [...document.querySelectorAll('.dues-history li')]
      .filter(item => item.innerText.includes('Sudah bayar')).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  assert.ok(residentView.paidMonths >= 2, "Resident history did not show cash-paid months as Sudah bayar.");
  assert.equal(residentView.overflow, false);
  await capture("resident-paid-history-390x844");

  for (const { name, value } of cookiePairs(treasurerCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await navigate(`${baseUrl}/app`, { width: 390, height: 844 });
  await waitFor("document.querySelector('a[href=\"/app/bendahara/riwayat\"]') !== null", "Treasurer dashboard did not expose the transaction history entry.");
  await navigate(`${baseUrl}/app/bendahara/riwayat`, { width: 390, height: 844 });
  await waitFor("document.querySelector('.payment-history-card') !== null", "Treasurer transaction history did not render.");
  const findBrowserCard = `([...document.querySelectorAll('.payment-history-card')].find(item => item.innerText.includes(${JSON.stringify(`Rumah ${mainHouse}`)})))`;
  const activeViewports: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{
      found: boolean;
      activeLabel: boolean;
      method: boolean;
      periods: boolean;
      total: boolean;
      overflow: boolean;
      actionHeight: number;
      rawIdentifier: boolean;
    }>(`(() => {
      const card = ${findBrowserCard};
      const text = card?.innerText.replace(/\\s+/g, ' ') ?? '';
      const action = card?.querySelector('.payment-history-actions > button');
      return {
        found: Boolean(card),
        activeLabel: text.includes('Aktif'),
        method: text.includes('Tunai'),
        periods: text.includes('April 2026') && text.includes('Mei 2026') && text.includes('Februari 2027'),
        total: text.includes('62.000'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        actionHeight: action ? Math.round(action.getBoundingClientRect().height) : 0,
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
      };
    })()`);
    assert.equal(view.found, true, `Browser payment history omitted the active household at ${viewport.width}px.`);
    assert.equal(view.activeLabel, true, `Active status is not clear at ${viewport.width}px.`);
    assert.equal(view.method, true, `Payment method is not clear at ${viewport.width}px.`);
    assert.equal(view.periods, true, `Payment periods are not clear at ${viewport.width}px.`);
    assert.equal(view.total, true, `Payment total is not clear at ${viewport.width}px.`);
    assert.equal(view.overflow, false, `Treasurer payment history overflows at ${viewport.width}px.`);
    assert.equal(view.rawIdentifier, false, `A raw identifier is visible at ${viewport.width}px.`);
    assert.ok(view.actionHeight >= 44, `Reversal action is below 44px at ${viewport.width}px.`);
    activeViewports.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("treasurer-payment-active-390x844");
  }

  await setViewport({ width: 390, height: 844 });
  await evaluate(`(${findBrowserCard}).querySelector('.payment-history-actions > button').click()`);
  await waitFor("document.querySelector('.payment-history-card textarea') !== null", "Reversal reason form did not render.");
  const confirmationViewports: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{
      clear: boolean;
      reasonLabel: boolean;
      textareaHeight: number;
      confirmHeight: number;
      overflow: boolean;
    }>(`(() => {
      const card = ${findBrowserCard};
      const text = card.innerText;
      const textarea = card.querySelector('textarea');
      const confirm = [...card.querySelectorAll('button')].find(button => button.textContent.includes('Konfirmasi pembatalan'));
      return {
        clear: text.includes('Histori pembayaran tetap tersimpan') && text.includes('Belum bayar'),
        reasonLabel: text.includes('Alasan pembatalan'),
        textareaHeight: textarea ? Math.round(textarea.getBoundingClientRect().height) : 0,
        confirmHeight: confirm ? Math.round(confirm.getBoundingClientRect().height) : 0,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`);
    assert.equal(view.clear, true, `Whole-payment reversal confirmation is unclear at ${viewport.width}px.`);
    assert.equal(view.reasonLabel, true, `Mandatory reason label is missing at ${viewport.width}px.`);
    assert.ok(view.textareaHeight >= 80, `Reversal reason field is too small at ${viewport.width}px.`);
    assert.ok(view.confirmHeight >= 44, `Reversal confirmation action is below 44px at ${viewport.width}px.`);
    assert.equal(view.overflow, false, `Reversal confirmation overflows at ${viewport.width}px.`);
    confirmationViewports.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("treasurer-payment-reversal-confirmation-390x844");
  }
  const confirmationView = confirmationViewports.find((view) => view.width === 390)!;
  await setViewport({ width: 390, height: 844 });
  await evaluate(`(() => {
    const card = ${findBrowserCard};
    const textarea = card.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, 'Koreksi melalui browser');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(`!(${findBrowserCard}).querySelector('button[type="submit"]').disabled`, "Reversal confirmation remained disabled after entering the required reason.");
  const reversalRequestCount = reversalPostUrls.length;
  await evaluate(`(() => {
    const button = ${findBrowserCard}.querySelector('button[type="submit"]');
    button.click();
    button.click();
  })()`);
  await waitFor(`${findBrowserCard}.classList.contains('payment-history-card--reversed')`, "Browser reversal did not reach a reversed history state.");
  await delay(300);
  assert.equal(reversalPostUrls.length - reversalRequestCount, 1, "Browser double-click sent more than one reversal mutation.");
  const reversedViewports: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{
      label: boolean;
      reason: boolean;
      noAction: boolean;
      reversedStyle: boolean;
      overflow: boolean;
      rawIdentifier: boolean;
    }>(`(() => {
      const card = ${findBrowserCard};
      const text = card.innerText;
      return {
        label: text.includes('Dibatalkan'),
        reason: text.includes('Koreksi melalui browser'),
        noAction: card.querySelector('.payment-history-actions') === null,
        reversedStyle: card.classList.contains('payment-history-card--reversed'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
      };
    })()`);
    assert.equal(view.label, true, `Reversed status is unclear at ${viewport.width}px.`);
    assert.equal(view.reason, true, `Treasurer reversal reason is missing at ${viewport.width}px.`);
    assert.equal(view.noAction, true, `A reversed payment still offers the reversal action at ${viewport.width}px.`);
    assert.equal(view.reversedStyle, true, `Reversed payment styling is missing at ${viewport.width}px.`);
    assert.equal(view.overflow, false, `Reversed payment history overflows at ${viewport.width}px.`);
    assert.equal(view.rawIdentifier, false, `A raw payment identifier is visible at ${viewport.width}px.`);
    reversedViewports.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("treasurer-payment-reversed-390x844");
  }
  const reversedView = reversedViewports.find((view) => view.width === 390)!;

  for (const { name, value } of cookiePairs(residentCookie)) {
    await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
  }
  await evaluate(`(() => { try { localStorage.setItem('karturt:resident-tab', 'card'); } catch {} })()`);
  await navigate(`${baseUrl}/app`, { width: 390, height: 844 });
  await waitFor("document.querySelector('.resident-summary') !== null", "Resident dues card did not refresh after reversal.");
  const reversedResidentCard = await evaluate<{ unpaidMonths: number; paidMonths: number; overflow: boolean }>(`(() => ({
    unpaidMonths: document.querySelectorAll('.due-status.status-unpaid').length,
    paidMonths: document.querySelectorAll('.due-status.status-paid').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  assert.ok(reversedResidentCard.unpaidMonths >= 2, "Resident card did not return the 2026 reversal months to Belum bayar.");
  assert.equal(reversedResidentCard.paidMonths, 0);
  assert.equal(reversedResidentCard.overflow, false);
  await evaluate(`(() => {
    const select = document.querySelector('.resident-year select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '2027');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelector('.resident-year select')?.value === '2027' && document.querySelector('.dues-grid')?.innerText.includes('Februari') && document.querySelector('.dues-grid')?.innerText.includes('Belum bayar')`,
    "Resident card did not show the 2027 reversed month as Belum bayar.",
  );
  const reversedFutureViewports: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{ unpaidMonth: boolean; unpaidCount: number; paidCount: number; overflow: boolean }>(`(() => ({
      unpaidMonth: document.querySelector('.dues-grid')?.innerText.includes('Februari') && document.querySelector('.dues-grid')?.innerText.includes('Belum bayar'),
      unpaidCount: document.querySelectorAll('.due-status.status-unpaid').length,
      paidCount: document.querySelectorAll('.due-status.status-paid').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))()`);
    assert.equal(view.unpaidMonth, true, `Reversed February 2027 due is not shown as unpaid at ${viewport.width}px.`);
    assert.ok(view.unpaidCount >= 1);
    assert.equal(view.paidCount, 0);
    assert.equal(view.overflow, false, `Resident dues card overflows at ${viewport.width}px.`);
    reversedFutureViewports.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("resident-payment-reversed-card-390x844");
  }
  const reversedFutureDue = reversedFutureViewports.find((view) => view.width === 390)!;
  await evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Riwayat'))?.click()`);
  await waitFor(
    `document.querySelector('.resident-payment-history')?.innerText.includes('Pembayaran dibatalkan') && document.querySelector('.resident-payment-history')?.innerText.includes('April 2026') && document.querySelector('.resident-payment-history')?.innerText.includes('Februari 2027')`,
    "Resident payment history did not load the reversed payment after reversal.",
  );
  const reversedResidentViewports: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{ explains: boolean; overflow: boolean; rawIdentifier: boolean }>(`(() => {
      const text = document.querySelector('.resident-payment-history').innerText;
      return {
        explains: text.includes('Pembayaran dibatalkan') && text.includes('April 2026') && text.includes('Mei 2026') && text.includes('Februari 2027'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
      };
    })()`);
    assert.equal(view.explains, true, `Resident history does not explain the reversed payment at ${viewport.width}px.`);
    assert.equal(view.overflow, false, `Resident payment history overflows at ${viewport.width}px.`);
    assert.equal(view.rawIdentifier, false, `A raw payment identifier is visible to residents at ${viewport.width}px.`);
    reversedResidentViewports.push({ width: viewport.width, ...view });
    if (viewport.width === 390) await capture("resident-payment-reversed-history-390x844");
  }
  const reversedResidentHistory = reversedResidentViewports.find((view) => view.width === 390)!;
  assert.deepEqual(pageErrors, [], "The browser reported a page or console error during the smoke.");
  devtoolsSocket.close();
  devtoolsSocket = undefined;
  return {
    viewports: viewportEvidence,
    confirmation,
    doubleClickRequests: 1,
    pendingView,
    residentCard,
    residentView,
    treasurerHistoryViewports: activeViewports,
    reversalConfirmation: confirmationView,
    reversalConfirmationViewports: confirmationViewports,
    reversalBrowserRequests: reversalPostUrls.length - reversalRequestCount,
    reversedView,
    reversedTreasurerViewports: reversedViewports,
    reversedResidentCard: { year2026: reversedResidentCard, year2027: reversedFutureDue },
    reversedResidentCardViewports: reversedFutureViewports,
    reversedResidentHistory,
    reversedResidentHistoryViewports: reversedResidentViewports,
    pageErrors: pageErrors.length,
  };
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${expectedPort}`;
  loadEnvConfig(root);
  const { baseUrl, databaseHost } = assertDevelopmentTarget();
  currentSmokeStage = "starting local Next server";
  await startNext(baseUrl);
  const db = getDb();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const [unit] = await db.insert(rtUnits).values({
    code: `P9-${suffix}`,
    rwCode: `P9-${suffix}`,
    name: `Phase 9 synthetic unit ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  const rtUnitId = unit!.id;
  await db.insert(rtSettings).values({ rtUnitId });

  const treasurer = await createPerson(db, rtUnitId, {
    houseNumber: `P9T-${suffix}`,
    accountType: "official",
    name: `Phase 9 smoke Treasurer ${suffix}`,
  });
  await db.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: treasurer.accountId,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const mainResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9A-${suffix}`,
    accountType: "resident",
    name: `Phase 9 smoke resident ${suffix}`,
  });
  const pendingResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9B-${suffix}`,
    accountType: "resident",
    name: `Phase 9 pending resident ${suffix}`,
  });
  const raceResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9C-${suffix}`,
    accountType: "resident",
    name: `Phase 9 race resident ${suffix}`,
  });
  const cashRaceResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9D-${suffix}`,
    accountType: "resident",
    name: `Phase 9 concurrent cash resident ${suffix}`,
  });
  const verifyRaceResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9E-${suffix}`,
    accountType: "resident",
    name: `Phase 9 transfer race resident ${suffix}`,
  });
  const browserResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9F-${suffix}`,
    accountType: "resident",
    name: `Phase 9 browser resident ${suffix}`,
  });
  const transferResident = await createPerson(db, rtUnitId, {
    houseNumber: `P9G-${suffix}`,
    accountType: "resident",
    name: `Phase 9 transfer resident ${suffix}`,
  });

  const yearIds = new Map<number, { billingYearId: string; feeRateId: string; amount: number }>();
  for (const [index, year] of [2026, 2027].entries()) {
    const [billingYear] = await db.insert(billingYears).values({
      rtUnitId,
      year,
      status: index === 0 ? "open" : "closed",
    }).returning({ id: billingYears.id });
    const amount = year === 2026 ? 18000 : 26000;
    const [feeRate] = await db.insert(feeRates).values({
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: amount,
    }).returning({ id: feeRates.id });
    yearIds.set(year, { billingYearId: billingYear!.id, feeRateId: feeRate!.id, amount });
  }
  const mainDueIds = await addDues(db, rtUnitId, mainResident.householdId, yearIds, ["2026-04", "2026-05", "2027-02"]);
  await addDues(db, rtUnitId, pendingResident.householdId, yearIds, ["2026-07", "2026-08"]);
  const raceDueIds = await addDues(db, rtUnitId, raceResident.householdId, yearIds, ["2026-09"]);
  const cashRaceDueIds = await addDues(db, rtUnitId, cashRaceResident.householdId, yearIds, ["2026-10"]);
  await addDues(db, rtUnitId, verifyRaceResident.householdId, yearIds, ["2026-11"]);
  const browserDueIds = await addDues(db, rtUnitId, browserResident.householdId, yearIds, ["2026-04", "2026-05", "2027-02"]);
  const transferDueIds = await addDues(db, rtUnitId, transferResident.householdId, yearIds, ["2026-04", "2026-05", "2027-02"]);

  currentSmokeStage = "normal Treasurer and resident sign-in";
  const treasurerCookie = await signIn(baseUrl, "official", treasurer);
  const secondTreasurerCookie = await signIn(baseUrl, "official", treasurer);
  const mainResidentCookie = await signIn(baseUrl, "resident", mainResident);
  const pendingResidentCookie = await signIn(baseUrl, "resident", pendingResident);
  const raceResidentCookie = await signIn(baseUrl, "resident", raceResident);
  const verifyRaceResidentCookie = await signIn(baseUrl, "resident", verifyRaceResident);
  const browserResidentCookie = await signIn(baseUrl, "resident", browserResident);
  const transferResidentCookie = await signIn(baseUrl, "resident", transferResident);

  currentSmokeStage = "cash household search and server preview";
  const search = await getJson<{ households: Array<{ householdId: string; houseNumber: string; residentNames: string[]; isActive: boolean }> }>(
    `${baseUrl}/api/treasurer/cash-payments/households?search=${encodeURIComponent(mainResident.houseNumber)}`,
    treasurerCookie,
  );
  assert.equal(search.households.length, 1);
  assert.equal(search.households[0]!.houseNumber, mainResident.houseNumber);
  assert.equal(search.households[0]!.isActive, true);
  const preview = await getJson<{ items: Array<{ period: string; amount: number; pendingConflict: boolean }>; totalAmount: number; hasPendingConflict: boolean }>(
    `${baseUrl}/api/treasurer/cash-payments/households/${mainResident.householdId}?period=2027-02`,
    treasurerCookie,
  );
  assert.deepEqual(preview.items.map((item) => item.period), ["2026-04", "2026-05", "2027-02"]);
  assert.equal(preview.totalAmount, 62000);
  assert.equal(preview.hasPendingConflict, false);

  currentSmokeStage = "multi-month cash recording and idempotent replay";
  const mainKey = randomUUID();
  const mainBody = { householdId: mainResident.householdId, period: "2027-02" };
  const cashResponse = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, mainBody, mainKey);
  assert.equal(cashResponse.status, 200);
  const cashResult = await readPostJson<{ periods: string[]; itemCount: number; totalAmount: number; replayed: boolean }>(cashResponse);
  assert.deepEqual(cashResult.periods, ["2026-04", "2026-05", "2027-02"]);
  assert.equal(cashResult.itemCount, 3);
  assert.equal(cashResult.totalAmount, 62000);
  assert.equal(cashResult.replayed, false);

  const replayResponse = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, mainBody, mainKey);
  assert.equal(replayResponse.status, 200);
  const replayResult = await readPostJson<{ replayed: boolean }>(replayResponse);
  assert.equal(replayResult.replayed, true);
  const keyConflict = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
    ...mainBody,
    period: "2026-05",
  }, mainKey);
  assert.equal(keyConflict.status, 409);
  assert.equal((await readPostJson(keyConflict)).code, "idempotency_conflict");

  const [mainPayment] = await db.select().from(payments).where(and(
    eq(payments.rtUnitId, rtUnitId),
    eq(payments.householdId, mainResident.householdId),
    eq(payments.method, "cash"),
  ));
  assert.ok(mainPayment);
  const mainAllocations = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, mainPayment.id));
  const mainAudit = await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment.cash_recorded"),
    eq(auditEvents.entityId, mainPayment.id),
  ));
  assert.equal(mainPayment.paymentRequestId, null);
  assert.equal(mainAllocations.length, 3);
  assert.ok(mainAllocations.every((allocation) => allocation.paymentRequestId === null));
  assert.equal(mainAllocations.reduce((total, allocation) => total + allocation.amount, 0), 62000);
  assert.equal(mainAudit.length, 1);
  const mainDuesAfter = await db.select().from(monthlyDues).where(inArray(monthlyDues.id, mainDueIds.map((due) => due.id)));
  assert.ok(mainDuesAfter.every((due) => due.status === "paid"));
  const residentRead = await getJson<{ dues: Array<{ month: number; billingYear: number; status: string; paymentRequestStatus: string | null }> }>(
    `${baseUrl}/api/resident/monthly-dues`, mainResidentCookie,
  );
  assert.ok(residentRead.dues.filter((due) => due.status === "paid").length === 3);
  assert.ok(residentRead.dues.every((due) => due.paymentRequestStatus !== "pending"));

  currentSmokeStage = "pending request conflict and cash after rejection";
  const requestKey = randomUUID();
  const requestResponse = await postJson(`${baseUrl}/api/resident/payment-requests`, pendingResidentCookie, baseUrl, {
    period: "2026-08",
  }, requestKey);
  assert.equal(requestResponse.status, 200);
  const requestResult = await readPostJson<{ requestCode: string; periods: string[]; totalAmount: number }>(requestResponse);
  assert.deepEqual(requestResult.periods, ["2026-07", "2026-08"]);
  const pendingPreview = await getJson<{ hasPendingConflict: boolean; items: Array<{ pendingConflict: boolean }> }>(
    `${baseUrl}/api/treasurer/cash-payments/households/${pendingResident.householdId}?period=2026-08`,
    treasurerCookie,
  );
  assert.equal(pendingPreview.hasPendingConflict, true);
  assert.ok(pendingPreview.items.some((item) => item.pendingConflict));
  const blockedCash = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
    householdId: pendingResident.householdId,
    period: "2026-08",
  }, randomUUID());
  assert.equal(blockedCash.status, 409);
  assert.equal((await readPostJson(blockedCash)).code, "pending_request_conflict");
  const [pendingRequest] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, requestResult.requestCode));
  const claimsBeforeReject = await db.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.requestId, pendingRequest!.id));
  assert.equal(claimsBeforeReject.length, 2);
  assert.equal(pendingRequest!.status, "pending");
  const rejectResponse = await postJson(
    `${baseUrl}/api/treasurer/payment-requests/${requestResult.requestCode}/reject`,
    treasurerCookie,
    baseUrl,
    { reason: "Pembayaran diterima tunai." },
  );
  assert.equal(rejectResponse.status, 200);
  const afterRejectCash = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
    householdId: pendingResident.householdId,
    period: "2026-08",
  }, randomUUID());
  assert.equal(afterRejectCash.status, 200);
  const [terminalRequest] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.id, pendingRequest!.id));
  assert.equal(terminalRequest!.status, "rejected");
  assert.equal(await db.select().from(payments)
    .where(eq(payments.paymentRequestId, pendingRequest!.id)).then((rows) => rows.length), 0);
  assert.equal(await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentRequestId, pendingRequest!.id)).then((rows) => rows.length), 0);

  await addDues(db, rtUnitId, pendingResident.householdId, yearIds, ["2026-12"]);
  const pendingBrowserRequest = await postJson(`${baseUrl}/api/resident/payment-requests`, pendingResidentCookie, baseUrl, {
    period: "2026-12",
  }, randomUUID());
  assert.equal(pendingBrowserRequest.status, 200);

  currentSmokeStage = "resident request versus cash race";
  const requestRaceKey = randomUUID();
  const cashRaceKey = randomUUID();
  const [cashRace, requestRace] = await Promise.all([
    postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
      householdId: raceResident.householdId,
      period: "2026-09",
    }, cashRaceKey),
    postJson(`${baseUrl}/api/resident/payment-requests`, raceResidentCookie, baseUrl, {
      period: "2026-09",
    }, requestRaceKey),
  ]);
  const [raceRequestResult] = await Promise.all([
    readPostJson<{ requestCode?: string }>(requestRace),
    cashRace.clone().json().catch(() => ({})),
  ]);
  assert.ok(([200, 409] as number[]).includes(cashRace.status));
  assert.ok(([200, 409] as number[]).includes(requestRace.status));
  assert.notEqual(cashRace.status === 200, requestRace.status === 200, "Exactly one ownership path may win the race.");
  const raceClaims = await db.select().from(paymentRequestClaims)
    .where(inArray(paymentRequestClaims.monthlyDueId, raceDueIds.map((due) => due.id)));
  const [raceDue] = await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, raceDueIds.map((due) => due.id)));
  if (cashRace.status === 200) {
    assert.equal(raceDue!.status, "paid");
    assert.equal(raceClaims.length, 0);
  } else {
    assert.equal(requestRace.status, 200);
    assert.equal(raceDue!.status, "unpaid");
    assert.equal(raceClaims.length, 1);
    assert.ok(raceRequestResult.requestCode);
  }

  currentSmokeStage = "concurrent cash and verify race";
  const verifyRaceCreate = await postJson(`${baseUrl}/api/resident/payment-requests`, verifyRaceResidentCookie, baseUrl, {
    period: "2026-11",
  }, randomUUID());
  assert.equal(verifyRaceCreate.status, 200);
  const verifyRequestBody = await readPostJson<{ requestCode: string }>(verifyRaceCreate);
  const [cashAgainstPending, verifyPending] = await Promise.all([
    postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
      householdId: verifyRaceResident.householdId,
      period: "2026-11",
    }, randomUUID()),
    postJson(`${baseUrl}/api/treasurer/payment-requests/${verifyRequestBody.requestCode}/verify`, treasurerCookie, baseUrl, {}),
  ]);
  assert.equal(cashAgainstPending.status, 409);
  const cashAgainstPendingBody = await readPostJson(cashAgainstPending);
  assert.ok(
    ["pending_request_conflict", "dues_changed"].includes(cashAgainstPendingBody.code ?? ""),
    `Cash loses safely whether it observes the pending claim or the verified paid due: ${cashAgainstPendingBody.code ?? "missing code"}`,
  );
  assert.equal(verifyPending.status, 200);
  const [verifiedRequest] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, verifyRequestBody.requestCode));
  assert.equal(verifiedRequest!.status, "verified");
  assert.equal(await db.select().from(payments)
    .where(eq(payments.householdId, verifyRaceResident.householdId)).then((rows) => rows.filter((row) => row.method === "cash").length), 0);

  currentSmokeStage = "different-key concurrent cash race";
  const [firstCash, secondCash] = await Promise.all([
    postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
      householdId: cashRaceResident.householdId,
      period: "2026-10",
    }, randomUUID()),
    postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
      householdId: cashRaceResident.householdId,
      period: "2026-10",
    }, randomUUID()),
  ]);
  assert.deepEqual([firstCash.status, secondCash.status].sort(), [200, 409]);
  assert.equal(await db.select().from(payments)
    .where(and(eq(payments.householdId, cashRaceResident.householdId), eq(payments.method, "cash")))
    .then((rows) => rows.length), 1);
  assert.ok(await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, cashRaceDueIds.map((due) => due.id)))
    .then((rows) => rows.every((row) => row.status === "paid")));

  currentSmokeStage = "cash reversal with two normal Treasurer sessions and re-payment";
  const cashAllocationsBeforeReversal = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, mainPayment.id));
  const forbiddenResidentReversal = await postJson(
    `${baseUrl}/api/treasurer/payments/${mainPayment.id}/reverse`,
    mainResidentCookie,
    baseUrl,
    { reason: "Permintaan warga" },
  );
  assert.equal(forbiddenResidentReversal.status, 403);
  const massAssignmentReversal = await postJson(
    `${baseUrl}/api/treasurer/payments/${mainPayment.id}/reverse`,
    treasurerCookie,
    baseUrl,
    { reason: "Alasan valid", actorId: treasurer.accountId, amount: 1 },
  );
  assert.equal(massAssignmentReversal.status, 400);
  const badOriginReversal = await fetch(`${baseUrl}/api/treasurer/payments/${mainPayment.id}/reverse`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.invalid", cookie: treasurerCookie },
    body: JSON.stringify({ reason: "Permintaan lintas origin" }),
  });
  assert.equal(badOriginReversal.status, 403);
  const [foreignPayment] = await db.select({ id: payments.id }).from(payments)
    .where(ne(payments.rtUnitId, rtUnitId)).limit(1);
  if (foreignPayment) {
    const crossRtReversal = await postJson(
      `${baseUrl}/api/treasurer/payments/${foreignPayment.id}/reverse`,
      treasurerCookie,
      baseUrl,
      { reason: "Pembayaran RT lain" },
    );
    assert.equal(crossRtReversal.status, 404);
  }
  const [firstReversal, secondReversal] = await Promise.all([
    postJson(`${baseUrl}/api/treasurer/payments/${mainPayment.id}/reverse`, treasurerCookie, baseUrl, {
      reason: "Koreksi pencatatan tunai multi-bulan",
    }),
    postJson(`${baseUrl}/api/treasurer/payments/${mainPayment.id}/reverse`, secondTreasurerCookie, baseUrl, {
      reason: "Koreksi pencatatan tunai sesi kedua",
    }),
  ]);
  assert.deepEqual([firstReversal.status, secondReversal.status].sort(), [200, 409]);
  const cashReversalResponse = firstReversal.status === 200 ? firstReversal : secondReversal;
  const cashReversalResult = await readPostJson<{ status: string; message: string }>(cashReversalResponse);
  assert.equal(cashReversalResult.status, "reversed");
  const cashReversalRows = await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, mainPayment.id));
  const cashReversalAudits = await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment.reversed"),
    eq(auditEvents.entityId, mainPayment.id),
  ));
  const cashOwnersAfterReversal = await db.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.paymentId, mainPayment.id));
  assert.equal(cashReversalRows.length, 1);
  assert.equal(cashReversalAudits.length, 1);
  assert.equal(cashOwnersAfterReversal.length, 0);
  assert.deepEqual(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, mainPayment.id)), cashAllocationsBeforeReversal);
  assert.ok(await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, mainDueIds.map((due) => due.id)))
    .then((rows) => rows.every((row) => row.status === "unpaid")));
  const cashResidentAfterReversal = await getJson<{ dues: Array<{ status: string }> }>(
    `${baseUrl}/api/resident/monthly-dues`, mainResidentCookie,
  );
  assert.ok(cashResidentAfterReversal.dues.every((due) => due.status === "unpaid"));
  const cashResidentHistory = await getJson<{ payments: Array<{ lifecycle: string; method: string }> }>(
    `${baseUrl}/api/resident/payment-history`, mainResidentCookie,
  );
  assert.equal(cashResidentHistory.payments[0]?.lifecycle, "reversed");
  assert.equal(cashResidentHistory.payments[0]?.method, "cash");
  const cashTreasurerHistory = await getJson<{ transactions: Array<{ paymentId: string; lifecycle: string; reversalReason: string | null }> }>(
    `${baseUrl}/api/treasurer/payments`, treasurerCookie,
  );
  assert.ok(cashTreasurerHistory.transactions.some((item) => item.paymentId === mainPayment.id && item.lifecycle === "reversed" && item.reversalReason));

  const newCashKey = randomUUID();
  const cashRePaymentResponse = await postJson(
    `${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, mainBody, newCashKey,
  );
  assert.equal(cashRePaymentResponse.status, 200);
  const cashRePaymentResult = await readPostJson<{ periods: string[]; totalAmount: number; replayed: boolean }>(cashRePaymentResponse);
  assert.deepEqual(cashRePaymentResult.periods, ["2026-04", "2026-05", "2027-02"]);
  assert.equal(cashRePaymentResult.totalAmount, 62000);
  assert.equal(cashRePaymentResult.replayed, false);
  const [newCashPayment] = await db.select().from(payments).where(eq(payments.cashIdempotencyKey, newCashKey));
  assert.ok(newCashPayment);
  const activeCashOwners = await db.select().from(activeDueSettlements)
    .where(inArray(activeDueSettlements.monthlyDueId, mainDueIds.map((due) => due.id)));
  assert.equal(activeCashOwners.length, 3);
  assert.ok(activeCashOwners.every((owner) => owner.paymentId === newCashPayment.id));

  currentSmokeStage = "cancel request then cash and reversal history";
  const pendingBrowserResult = await readPostJson<{ requestCode: string }>(pendingBrowserRequest);
  const cancelPendingResponse = await postJson(
    `${baseUrl}/api/resident/payment-requests/${pendingBrowserResult.requestCode}/cancel`,
    pendingResidentCookie,
    baseUrl,
    {},
  );
  assert.equal(cancelPendingResponse.status, 200);
  const cancelledRequestResult = await readPostJson<{ status: string }>(cancelPendingResponse);
  assert.equal(cancelledRequestResult.status, "cancelled");
  const cancelledCashKey = randomUUID();
  const cancelledCashResponse = await postJson(`${baseUrl}/api/treasurer/cash-payments`, treasurerCookie, baseUrl, {
    householdId: pendingResident.householdId,
    period: "2026-12",
  }, cancelledCashKey);
  assert.equal(cancelledCashResponse.status, 200);
  const [cancelledCashPayment] = await db.select().from(payments)
    .where(eq(payments.cashIdempotencyKey, cancelledCashKey));
  assert.ok(cancelledCashPayment);
  assert.equal(cancelledCashPayment.paymentRequestId, null);
  assert.equal(await db.select().from(payments)
    .where(eq(payments.paymentRequestId, pendingRequest!.id)).then((rows) => rows.length), 0);
  const cancelledCashReverseResponse = await postJson(
    `${baseUrl}/api/treasurer/payments/${cancelledCashPayment.id}/reverse`,
    treasurerCookie,
    baseUrl,
    { reason: "Pembatalan pencatatan setelah permintaan warga dibatalkan" },
  );
  assert.equal(cancelledCashReverseResponse.status, 200);
  const [cancelledRequestAfterCash] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, pendingBrowserResult.requestCode));
  assert.equal(cancelledRequestAfterCash!.status, "cancelled");
  const [rejectedRequestAfterCash] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.id, pendingRequest!.id));
  assert.equal(rejectedRequestAfterCash!.status, "rejected");
  assert.equal(await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, cancelledCashPayment.id)).then((rows) => rows.length), 1);
  assert.ok(await db.select().from(monthlyDues)
    .where(eq(monthlyDues.householdId, pendingResident.householdId))
    .then((rows) => rows.find((due) => due.month === 12)?.status === "unpaid"));

  currentSmokeStage = "transfer reversal and replacement request/payment";
  const transferRequestResponse = await postJson(
    `${baseUrl}/api/resident/payment-requests`, transferResidentCookie, baseUrl,
    { period: "2027-02" }, randomUUID(),
  );
  assert.equal(transferRequestResponse.status, 200);
  const transferRequestResult = await readPostJson<{ requestCode: string; periods: string[]; totalAmount: number }>(transferRequestResponse);
  assert.deepEqual(transferRequestResult.periods, ["2026-04", "2026-05", "2027-02"]);
  assert.equal(transferRequestResult.totalAmount, 62000);
  const verifyTransferResponse = await postJson(
    `${baseUrl}/api/treasurer/payment-requests/${transferRequestResult.requestCode}/verify`,
    treasurerCookie,
    baseUrl,
    {},
  );
  assert.equal(verifyTransferResponse.status, 200);
  const [originalTransferRequest] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, transferRequestResult.requestCode));
  const [originalTransferPayment] = await db.select().from(payments)
    .where(eq(payments.paymentRequestId, originalTransferRequest!.id));
  assert.ok(originalTransferPayment);
  const originalTransferAllocations = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, originalTransferPayment.id));
  assert.equal(originalTransferAllocations.length, 3);
  const transferReverseResponse = await postJson(
    `${baseUrl}/api/treasurer/payments/${originalTransferPayment.id}/reverse`,
    treasurerCookie,
    baseUrl,
    { reason: "Koreksi pencatatan transfer" },
  );
  assert.equal(transferReverseResponse.status, 200);
  const transferReversedRequest = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.id, originalTransferRequest!.id));
  assert.equal(transferReversedRequest[0]!.status, "verified");
  assert.deepEqual(await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, originalTransferPayment.id)), originalTransferAllocations);
  assert.equal(await db.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.paymentId, originalTransferPayment.id)).then((rows) => rows.length), 0);
  assert.ok(await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, transferDueIds.map((due) => due.id)))
    .then((rows) => rows.every((row) => row.status === "unpaid")));
  const replacementRequestResponse = await postJson(
    `${baseUrl}/api/resident/payment-requests`, transferResidentCookie, baseUrl,
    { period: "2027-02" }, randomUUID(),
  );
  assert.equal(replacementRequestResponse.status, 200);
  const replacementRequestResult = await readPostJson<{ requestCode: string }>(replacementRequestResponse);
  const replacementVerifyResponse = await postJson(
    `${baseUrl}/api/treasurer/payment-requests/${replacementRequestResult.requestCode}/verify`,
    treasurerCookie,
    baseUrl,
    {},
  );
  assert.equal(replacementVerifyResponse.status, 200);
  const [replacementRequest] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, replacementRequestResult.requestCode));
  const [replacementTransferPayment] = await db.select().from(payments)
    .where(eq(payments.paymentRequestId, replacementRequest!.id));
  const activeTransferOwners = await db.select().from(activeDueSettlements)
    .where(inArray(activeDueSettlements.monthlyDueId, transferDueIds.map((due) => due.id)));
  assert.ok(replacementTransferPayment);
  assert.notEqual(replacementTransferPayment.id, originalTransferPayment.id);
  assert.equal(activeTransferOwners.length, 3);
  assert.ok(activeTransferOwners.every((owner) => owner.paymentId === replacementTransferPayment.id));

  const residentTransferHistory = await getJson<{ payments: Array<{ lifecycle: string; method: string }> }>(
    `${baseUrl}/api/resident/payment-history`, transferResidentCookie,
  );
  assert.equal(residentTransferHistory.payments[0]?.lifecycle, "active");
  assert.ok(residentTransferHistory.payments.some((item) => item.lifecycle === "reversed" && item.method === "transfer"));

  currentSmokeStage = "concurrent transfer reversal and resident request";
  const [transferRaceReversal, transferRaceRequest] = await Promise.all([
    postJson(
      `${baseUrl}/api/treasurer/payments/${replacementTransferPayment.id}/reverse`,
      treasurerCookie,
      baseUrl,
      { reason: "Uji urutan reversal transfer dan pengajuan warga" },
    ),
    postJson(
      `${baseUrl}/api/resident/payment-requests`,
      transferResidentCookie,
      baseUrl,
      { period: "2027-02" },
      randomUUID(),
    ),
  ]);
  assert.equal(transferRaceReversal.status, 200);
  assert.ok(([200, 409] as number[]).includes(transferRaceRequest.status));
  const [transferReplacementRequestAfterRace] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.id, replacementRequest!.id));
  assert.equal(transferReplacementRequestAfterRace!.status, "verified");
  const transferRequestRaceOwners = await db.select().from(activeDueSettlements)
    .where(inArray(activeDueSettlements.monthlyDueId, transferDueIds.map((due) => due.id)));
  assert.equal(transferRequestRaceOwners.length, 0);
  const transferDuesAfterRace = await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, transferDueIds.map((due) => due.id)));
  assert.ok(transferDuesAfterRace.every((due) => due.status === "unpaid"));
  const transferClaimsAfterRace = await db.select().from(paymentRequestClaims)
    .where(inArray(paymentRequestClaims.monthlyDueId, transferDueIds.map((due) => due.id)));
  if (transferRaceRequest.status === 200) {
    const transferRaceRequestResult = await readPostJson<{ requestCode: string }>(transferRaceRequest);
    const [acceptedTransferRaceRequest] = await db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, transferRaceRequestResult.requestCode));
    assert.equal(acceptedTransferRaceRequest!.status, "pending");
    assert.equal(transferClaimsAfterRace.length, 3);
  } else {
    assert.equal(transferClaimsAfterRace.length, 0);
  }
  assert.equal(await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, replacementTransferPayment.id)).then((rows) => rows.length), 1);
  assert.equal(await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment.reversed"),
    eq(auditEvents.entityId, replacementTransferPayment.id),
  )).then((rows) => rows.length), 1);

  currentSmokeStage = "resident request after cash reversal for browser conflict view";
  const browserPendingRequest = await postJson(
    `${baseUrl}/api/resident/payment-requests`,
    pendingResidentCookie,
    baseUrl,
    { period: "2026-12" },
    randomUUID(),
  );
  assert.equal(browserPendingRequest.status, 200);
  const browserPendingRequestResult = await readPostJson<{ requestCode: string }>(browserPendingRequest);
  const [browserPendingRequestRow] = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, browserPendingRequestResult.requestCode));
  assert.equal(browserPendingRequestRow!.status, "pending");

  currentSmokeStage = "responsive real-browser cash and payment reversal";

  const browser = await testBrowserFlow(
    baseUrl,
    treasurerCookie,
    browserResidentCookie,
    browserResident.houseNumber,
    pendingResident.houseNumber,
    "2027-02",
    "2026-12",
  );
  const browserRows = await db.select().from(payments).where(and(
    eq(payments.rtUnitId, rtUnitId),
    eq(payments.householdId, browserResident.householdId),
    eq(payments.method, "cash"),
  ));
  assert.equal(browserRows.length, 1);
  const [browserPayment] = browserRows;
  assert.equal(browserPayment!.amount, 62000);
  assert.equal(await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, browserPayment!.id)).then((rows) => rows.length), 3);
  assert.equal(await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, browserPayment!.id)).then((rows) => rows.length), 1);
  assert.equal(await db.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.paymentId, browserPayment!.id)).then((rows) => rows.length), 0);
  assert.ok(await db.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, browserDueIds.map((due) => due.id)))
    .then((rows) => rows.every((row) => row.status === "unpaid")));

  console.info(JSON.stringify({
    event: "phase9.cash-payment.development-smoke.pass",
    target: { project: target.projectId, branch: target.branchId, database: target.databaseName, directEndpointVerified: databaseHost.startsWith(target.endpointId) },
    multiMonthCash: { periods: cashResult.periods, totalAmount: cashResult.totalAmount, allocations: mainAllocations.length, audits: mainAudit.length },
    idempotency: { sameKeyReplay: replayResult.replayed, changedFingerprintStatus: keyConflict.status },
    pendingConflict: { blockedStatus: blockedCash.status, terminalHistory: terminalRequest!.status, replacementCash: afterRejectCash.status },
    races: { requestVersusCash: [cashRace.status, requestRace.status], cashVersusVerify: [cashAgainstPending.status, verifyPending.status], distinctCashKeys: [firstCash.status, secondCash.status] },
    reversalVersusRequest: { reversal: transferRaceReversal.status, request: transferRaceRequest.status, finalDueStatus: transferDuesAfterRace.map((due) => due.status), activeOwners: transferRequestRaceOwners.length, pendingClaims: transferClaimsAfterRace.length },
    resident: { paidDues: residentRead.dues.filter((due) => due.status === "paid").length },
    browser: {
      viewports: browser.viewports,
      treasurerHistoryViewports: browser.treasurerHistoryViewports,
      confirmation: browser.confirmation,
      reversalConfirmationViewports: browser.reversalConfirmationViewports,
      doubleClickRequests: browser.doubleClickRequests,
      pendingConflict: browser.pendingView,
      residentCard: browser.residentCard,
      residentHistory: browser.residentView,
      reversedTreasurerViewports: browser.reversedTreasurerViewports,
      reversedResidentCardViewports: browser.reversedResidentCardViewports,
      reversedResidentHistoryViewports: browser.reversedResidentHistoryViewports,
      pageErrors: browser.pageErrors,
    },
    syntheticFinancialFixtures: "Retained only on karturt-development; normal login sessions are removed.",
  }));
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), delay(2000)]);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected Phase 9 smoke failure.";
    console.error(`Phase 9 development smoke failed during ${currentSmokeStage}: ${message}`);
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
        // Keep synthetic domain and financial fixtures; only smoke login sessions are removed.
      }
    }
    await closeDb();
    if (browserProfile) {
      const tempRoot = resolve(tmpdir());
      const resolvedProfile = resolve(browserProfile);
      if (resolvedProfile.startsWith(`${tempRoot}${sep}`) && resolvedProfile.includes("karturt-phase-9-chrome-")) {
        rmSync(resolvedProfile, { recursive: true, force: true });
      }
    }
  });
